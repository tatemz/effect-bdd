import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Fn from "effect/Function";
import type * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Str from "effect/String";
import type * as Bdd from "../../Bdd.ts";
import type { ParseError } from "../../Errors.ts";
import * as Discovery from "../discovery.ts";
import * as Parser from "../parser.ts";
import * as CoreRunner from "../runner.ts";
import { DiscoveryError, type ModuleLoadError } from "./errors.ts";
import type { GlobResolver } from "./glob.ts";
import { loadFeatureDefinitions, loadFeatureSources } from "./loaders.ts";
import type {
  CliDiagnostic,
  CliOptions,
  CliRunResult,
  DiscoverySummary,
  FeatureSource,
  RunPhaseDurations,
  RunEvent,
  RunSummary,
  ScenarioResult,
  ScenarioTask,
} from "./models.ts";
import type { ModuleLoader } from "./moduleLoader.ts";
import * as TagExpression from "./tagExpression.ts";

interface BuiltScenarios {
  readonly tasks: ReadonlyArray<ScenarioTask>;
  readonly diagnostics: ReadonlyArray<CliDiagnostic>;
  readonly matchedFeatureTitles: ReadonlyArray<string>;
}

interface FeatureDefinitionIndex {
  readonly byTitle: FeatureDefinitionTitleIndex;
}

interface FeatureDefinitionTitleIndex {
  [title: string]: ReadonlyArray<Bdd.Feature<unknown, never>> | undefined;
}

interface RunEvents {
  readonly onEvent?: (event: RunEvent) => Effect.Effect<void, never, any>;
}

/** @internal */
export const run: (
  options: CliOptions,
  events?: RunEvents,
) => Effect.Effect<
  CliRunResult,
  CliRunError,
  FileSystem.FileSystem | GlobResolver | ModuleLoader | Path.Path | Parser.GherkinCompiler
> = Effect.fnUntraced(function* (options: CliOptions, events?: RunEvents) {
  const startedAt = yield* Clock.currentTimeMillis;
  const sourcesTimed = yield* timed(loadFeatureSources(options.features));
  const sources = sourcesTimed.value;
  const loadedDefinitionsTimed = yield* timed(loadFeatureDefinitions(options.steps));
  const loadedDefinitions = loadedDefinitionsTimed.value;
  const definitions = loadedDefinitions.definitions;
  const definitionIndex = featureDefinitionIndex(definitions);
  const builtTimed = yield* timed(
    Fn.pipe(
      sources,
      Effect.forEach((source) => buildScenarioTasks(source, definitionIndex)),
      Effect.map(combineBuiltScenarios),
    ),
  );
  const built = builtTimed.value;
  const filteredTimed = yield* timed(filterTasks(options, built.tasks));
  const filteredTasks = filteredTimed.value;
  const resultsTimed = yield* timed(runScenarios(options, filteredTasks, events));
  const results = resultsTimed.value;
  const finishedAt = yield* Clock.currentTimeMillis;
  const diagnostics: ReadonlyArray<CliDiagnostic> = Fn.pipe(
    built.diagnostics,
    Arr.appendAll(unusedFeatureDefinitions(definitions, built.matchedFeatureTitles)),
  );
  return {
    results,
    diagnostics,
    summary: summarize(sources.length, results, finishedAt - startedAt, {
      featureDiscoveryMillis: sourcesTimed.durationMillis,
      stepModuleLoadMillis: loadedDefinitionsTimed.durationMillis,
      taskBuildMillis: builtTimed.durationMillis,
      filteringMillis: filteredTimed.durationMillis,
      executionMillis: resultsTimed.durationMillis,
    }),
    discovery: summarizeDiscovery(
      options,
      sources,
      loadedDefinitions.paths,
      definitions,
      built,
      filteredTasks,
    ),
  } satisfies CliRunResult;
});

interface Timed<A> {
  readonly value: A;
  readonly durationMillis: number;
}

const timed: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<Timed<A>, E, R> =
  Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
    const startedAt = yield* Clock.currentTimeMillis;
    const value = yield* effect;
    const finishedAt = yield* Clock.currentTimeMillis;
    return { value, durationMillis: finishedAt - startedAt };
  });

const buildScenarioTasks: (
  source: FeatureSource,
  definitions: FeatureDefinitionIndex,
) => Effect.Effect<BuiltScenarios, DiscoveryError | ParseError, Parser.GherkinCompiler> =
  // oxlint-disable-next-line complexity
  Effect.fnUntraced(function* (source: FeatureSource, definitions: FeatureDefinitionIndex) {
    const parsed = yield* Parser.parse(source.source, source.path);
    const matches = definitions.byTitle[parsed.name] ?? [];
    if (matches.length > 1) {
      return yield* Effect.fail(
        new DiscoveryError({
          message: `Multiple feature definitions matched "${parsed.name}"`,
        }),
      );
    }
    const definition = matches[0];
    if (definition === undefined) {
      return {
        tasks: [],
        diagnostics: Fn.pipe(
          [
            {
              _tag: "UnmatchedFeature",
              featurePath: source.path,
              featureTitle: parsed.name,
              line: parsed.line,
              message: `Feature file has no matching Bdd.feature export: ${parsed.name}`,
            } satisfies CliDiagnostic,
          ],
          Arr.appendAll(
            Arr.map(
              parsed.pickles,
              (pickle): CliDiagnostic => ({
                _tag: "UnmatchedScenario",
                featurePath: source.path,
                featureTitle: parsed.name,
                scenarioTitle: pickle.name,
                scenarioLine: pickle.location?.line ?? parsed.line,
                message: `Scenario cannot run because no feature definition matched "${parsed.name}"`,
              }),
            ),
          ),
        ),
        matchedFeatureTitles: [],
      };
    }
    const discovered = Discovery.buildScenarioTasks(definition, parsed);
    const fatalIssue = Arr.findFirst(discovered.issues, isFatalDiscoveryIssue);
    if (fatalIssue._tag === "Some") {
      return yield* Effect.fail(
        new DiscoveryError({
          message: discoveryIssueMessage(fatalIssue.value, definition.title),
        }),
      );
    }
    const diagnostics = Arr.filterMap(discovered.issues, (issue) =>
      discoveryIssueDiagnostic(source, parsed, definition, issue),
    );

    return {
      tasks: Arr.map(
        discovered.tasks,
        (task): ScenarioTask => ({ featurePath: source.path, core: task }),
      ),
      diagnostics,
      matchedFeatureTitles: [definition.title],
    };
  });

const featureDefinitionIndex = (
  definitions: ReadonlyArray<Bdd.Feature<unknown, never>>,
): FeatureDefinitionIndex => ({
  byTitle: Arr.reduce(definitions, emptyFeatureDefinitionTitleIndex(), (index, definition) => {
    const existing = index[definition.title];
    index[definition.title] =
      existing === undefined ? [definition] : Fn.pipe(existing, Arr.append(definition));
    return index;
  }),
});

// This mutable index is scoped to one CLI run and is not shared across fibers.
const emptyFeatureDefinitionTitleIndex = (): FeatureDefinitionTitleIndex => Object.create(null);

const isFatalDiscoveryIssue = (issue: Discovery.DiscoveryIssue): boolean =>
  issue._tag === "FeatureTitleMismatch" ||
  issue._tag === "DuplicateScenarioDefinition" ||
  issue._tag === "DuplicateSourceScenario";

// oxlint-disable-next-line complexity
const discoveryIssueMessage = (issue: Discovery.DiscoveryIssue, featureTitle: string): string => {
  switch (issue._tag) {
    case "FeatureTitleMismatch": {
      return `Feature definition "${issue.definitionTitle}" does not match Gherkin feature "${issue.featureTitle}"`;
    }
    case "DuplicateScenarioDefinition": {
      return `Duplicate scenario chain title in "${featureTitle}": ${issue.scenarioTitle}`;
    }
    case "DuplicateSourceScenario": {
      return `Duplicate scenario title in Gherkin feature "${featureTitle}": ${issue.scenarioTitle}`;
    }
    case "UnmatchedScenario": {
      return `Scenario has no matching Bdd.scenario chain: ${issue.scenarioTitle}`;
    }
    case "UnusedScenarioDefinition": {
      return `Scenario chain exported but no source scenario matched: ${featureTitle} / ${issue.scenarioTitle}`;
    }
  }
};

// oxlint-disable-next-line complexity
const discoveryIssueDiagnostic = (
  source: FeatureSource,
  parsed: Parser.CompiledFeature,
  definition: Bdd.Feature<unknown, never>,
  issue: Discovery.DiscoveryIssue,
): Result.Result<CliDiagnostic, undefined> => {
  switch (issue._tag) {
    case "UnmatchedScenario": {
      return Result.succeed({
        _tag: "UnmatchedScenario",
        featurePath: source.path,
        featureTitle: parsed.name,
        scenarioTitle: issue.scenarioTitle,
        scenarioLine: issue.scenarioLine,
        message: discoveryIssueMessage(issue, definition.title),
      });
    }
    case "UnusedScenarioDefinition": {
      return Result.succeed({
        _tag: "UnusedScenarioDefinition",
        featureTitle: definition.title,
        scenarioTitle: issue.scenarioTitle,
        message: discoveryIssueMessage(issue, definition.title),
      });
    }
    case "FeatureTitleMismatch":
    case "DuplicateScenarioDefinition":
    case "DuplicateSourceScenario": {
      return Result.fail(undefined);
    }
  }
};

const runScenario = Effect.fnUntraced(function* (
  options: CliOptions,
  task: ScenarioTask,
  events?: RunEvents,
) {
  yield* emitRunEvent(events, { _tag: "ScenarioStarted", task });
  const startedAt = yield* Clock.currentTimeMillis;
  const result = yield* Effect.result(CoreRunner.runScenarioTask(task.core, runOptions(options)));
  const finishedAt = yield* Clock.currentTimeMillis;
  const scenarioResult = {
    task,
    outcome:
      result._tag === "Success"
        ? { _tag: "Passed", steps: result.success.steps }
        : { _tag: "Failed", error: result.failure },
    durationMillis: finishedAt - startedAt,
  } satisfies ScenarioResult;
  yield* emitRunEvent(events, { _tag: "ScenarioFinished", result: scenarioResult });
  return scenarioResult;
});

const runScenarios = (
  options: CliOptions,
  tasks: ReadonlyArray<ScenarioTask>,
  events?: RunEvents,
): Effect.Effect<ReadonlyArray<ScenarioResult>, never, any> =>
  options.filters.failFast
    ? runScenariosFailFast(options, tasks, events)
    : Effect.forEach(tasks, (task) => runScenario(options, task, events), {
        concurrency: options.parallel,
      });

const runScenariosFailFast = (
  options: CliOptions,
  tasks: ReadonlyArray<ScenarioTask>,
  events?: RunEvents,
): Effect.Effect<ReadonlyArray<ScenarioResult>, never, any> =>
  Fn.pipe(
    tasks,
    Arr.matchLeft({
      onEmpty: () => Effect.succeed<ReadonlyArray<ScenarioResult>>([]),
      onNonEmpty: (task, rest) =>
        Effect.flatMap(runScenario(options, task, events), (result) =>
          result.outcome._tag === "Failed"
            ? Effect.succeed([result])
            : Effect.map(runScenariosFailFast(options, rest, events), Arr.prepend(result)),
        ),
    }),
  );

const runOptions = (options: CliOptions): CoreRunner.RunOptions =>
  options.stepTimeout === undefined ? {} : { stepTimeout: options.stepTimeout };

const emitRunEvent = (
  events: RunEvents | undefined,
  event: RunEvent,
): Effect.Effect<void, never, any> =>
  events?.onEvent === undefined ? Effect.void : events.onEvent(event);

const filterTasks = (
  options: CliOptions,
  tasks: ReadonlyArray<ScenarioTask>,
): Effect.Effect<ReadonlyArray<ScenarioTask>, DiscoveryError> =>
  Fn.pipe(
    TagExpression.compileAll(options.filters.tags),
    Effect.map((tagPredicate) => {
      const filtered = Arr.filter(
        tasks,
        (task) => tagPredicate(task.core.tags) && matchesTitleFilter(options.filters.titles, task),
      );
      return filtered;
    }),
    Effect.flatMap((filtered) =>
      tasks.length > 0 && filtered.length === 0
        ? Effect.fail(new DiscoveryError({ message: "No scenarios matched the provided filters" }))
        : Effect.succeed(filtered),
    ),
  );

const matchesTitleFilter = (patterns: ReadonlyArray<string>, task: ScenarioTask): boolean =>
  patterns.length === 0 ||
  Arr.some(patterns, (pattern) =>
    Fn.pipe(`${task.core.featureTitle} / ${task.core.scenarioTitle}`, Str.includes(pattern)),
  );

const summarize = (
  features: number,
  results: ReadonlyArray<ScenarioResult>,
  durationMillis: number,
  phases: RunPhaseDurations,
): RunSummary => {
  const failed = Arr.filter(results, (result) => result.outcome._tag === "Failed").length;
  return {
    features,
    total: results.length,
    passed: results.length - failed,
    failed,
    durationMillis,
    phases,
  };
};

const summarizeDiscovery = (
  options: CliOptions,
  sources: ReadonlyArray<FeatureSource>,
  stepModulePaths: ReadonlyArray<string>,
  definitions: ReadonlyArray<Bdd.Feature<unknown, never>>,
  built: BuiltScenarios,
  selectedTasks: ReadonlyArray<ScenarioTask>,
): DiscoverySummary => ({
  featurePatterns: options.features,
  featurePaths: Arr.map(sources, (source) => source.path),
  stepPatterns: options.steps,
  stepModulePaths,
  featureDefinitions: Arr.map(definitions, (definition) => definition.title),
  scenariosDiscovered: built.tasks.length,
  scenariosSelected: selectedTasks.length,
  selectedScenarios: Arr.map(selectedTasks, discoveredScenario),
});

const discoveredScenario = (task: ScenarioTask): DiscoverySummary["selectedScenarios"][number] => ({
  featurePath: task.featurePath,
  featureTitle: task.core.featureTitle,
  scenarioTitle: task.core.scenarioTitle,
  scenarioLine: task.core.scenarioLine,
});

const combineBuiltScenarios = (built: ReadonlyArray<BuiltScenarios>): BuiltScenarios => ({
  tasks: Fn.pipe(
    built,
    Arr.flatMap((item) => item.tasks),
  ),
  diagnostics: Fn.pipe(
    built,
    Arr.flatMap((item) => item.diagnostics),
  ),
  matchedFeatureTitles: Fn.pipe(
    built,
    Arr.flatMap((item) => item.matchedFeatureTitles),
    Arr.dedupe,
  ),
});

const unusedFeatureDefinitions = (
  definitions: ReadonlyArray<Bdd.Feature<unknown, never>>,
  matchedFeatureTitles: ReadonlyArray<string>,
): ReadonlyArray<CliDiagnostic> =>
  Fn.pipe(
    definitions,
    Arr.filter((definition) => !Arr.contains(definition.title)(matchedFeatureTitles)),
    Arr.map(
      (definition): CliDiagnostic => ({
        _tag: "UnusedFeatureDefinition",
        featureTitle: definition.title,
        message: `Feature definition exported but no feature file matched: ${definition.title}`,
      }),
    ),
  );

/** @internal */
export type CliRunError = DiscoveryError | ModuleLoadError | ParseError;
