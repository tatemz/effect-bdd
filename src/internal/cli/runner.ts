import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Fn from "effect/Function";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import type * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Str from "effect/String";
import type * as Bdd from "../../Bdd.ts";
import type { ParseError } from "../../Errors.ts";
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
  readonly byTitle: Record.ReadonlyRecord<string, ReadonlyArray<Bdd.Feature<unknown, never>>>;
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
  Effect.fnUntraced(function* (source: FeatureSource, definitions: FeatureDefinitionIndex) {
    const parsed = yield* Parser.parse(source.source, source.path);
    const matches = Fn.pipe(
      Record.get(definitions.byTitle, parsed.name),
      Option.getOrElse((): ReadonlyArray<Bdd.Feature<unknown, never>> => []),
    );
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
    yield* validateDuplicateScenarioDefinition(definition);
    const resolved = Arr.map(parsed.pickles, resolvePickle(parsed));
    yield* validateDuplicateSourceScenario(parsed, resolved);

    const scenarioDefinitions = Fn.pipe(
      definition.scenarios,
      Arr.map((scenario) => [scenario.title, scenario] as const),
      Record.fromEntries,
    );
    const built = Arr.map(resolved, (entry) =>
      buildScenarioTask(source, parsed, definition, scenarioDefinitions, entry),
    );
    const tasks = Arr.filterMap(built, (item) =>
      item._tag === "Task" ? Result.succeed(item.task) : Result.fail(undefined),
    );
    const hasUsedScenarioTitle = titleMatcher(
      Arr.map(tasks, (task) => task.core.sourceScenarioTitle),
    );
    const unmatched = Arr.filterMap(built, (item) =>
      item._tag === "Diagnostic" ? Result.succeed(item.diagnostic) : Result.fail(undefined),
    );
    const unused = Fn.pipe(
      definition.scenarios,
      Arr.filter((scenario) => !hasUsedScenarioTitle(scenario.title)),
      Arr.map(
        (scenario): CliDiagnostic => ({
          _tag: "UnusedScenarioDefinition",
          featureTitle: definition.title,
          scenarioTitle: scenario.title,
          message: `Scenario chain exported but no source scenario matched: ${definition.title} / ${scenario.title}`,
        }),
      ),
    );

    return {
      tasks,
      diagnostics: Arr.appendAll(unmatched, unused),
      matchedFeatureTitles: [definition.title],
    };
  });

const featureDefinitionIndex = (
  definitions: ReadonlyArray<Bdd.Feature<unknown, never>>,
): FeatureDefinitionIndex => {
  const emptyIndex: Record.ReadonlyRecord<string, ReadonlyArray<Bdd.Feature<unknown, never>>> = {};
  const byTitle = Arr.reduce(definitions, emptyIndex, (index, definition) =>
    Record.set(index, definition.title, appendDefinition(index, definition)),
  );
  return { byTitle };
};

const appendDefinition = (
  index: Record.ReadonlyRecord<string, ReadonlyArray<Bdd.Feature<unknown, never>>>,
  definition: Bdd.Feature<unknown, never>,
): ReadonlyArray<Bdd.Feature<unknown, never>> =>
  Fn.pipe(
    Record.get(index, definition.title),
    Option.match({
      onNone: () => [definition],
      onSome: Arr.append(definition),
    }),
  );

const validateDuplicateScenarioDefinition = (
  definition: Bdd.Feature<unknown, never>,
): Effect.Effect<void, DiscoveryError> => {
  const duplicateScenario = duplicateScenarioDefinition(definition);
  return duplicateScenario === undefined
    ? Effect.void
    : Effect.fail(
        new DiscoveryError({
          message: `Duplicate scenario chain title in "${definition.title}": ${duplicateScenario}`,
        }),
      );
};

const validateDuplicateSourceScenario = (
  parsed: Parser.CompiledFeature,
  resolved: ReadonlyArray<ResolvedPickle>,
): Effect.Effect<void, DiscoveryError> => {
  const duplicateSourceScenario = duplicateSourceScenarioTitle(resolved);
  return duplicateSourceScenario === undefined
    ? Effect.void
    : Effect.fail(
        new DiscoveryError({
          message: `Duplicate scenario title in Gherkin feature "${parsed.name}": ${duplicateSourceScenario}`,
        }),
      );
};

const duplicateSourceScenarioTitle = (
  resolved: ReadonlyArray<ResolvedPickle>,
): string | undefined =>
  Fn.pipe(
    CoreRunner.firstDuplicateSourceScenarioTitle(
      Arr.map(resolved, ({ scenarioTitle, sourceScenarioId }) => ({
        scenarioTitle,
        sourceScenarioId,
      })),
    ),
    Option.getOrUndefined,
  );

type BuiltScenario =
  | { readonly _tag: "Task"; readonly task: ScenarioTask }
  | { readonly _tag: "Diagnostic"; readonly diagnostic: CliDiagnostic };

interface ResolvedPickle {
  readonly pickle: Parser.CompiledFeature["pickles"][number];
  readonly scenarioIndex: number;
  readonly sourceScenario: ReturnType<typeof Parser.findScenario>;
  readonly scenarioTitle: string;
  readonly scenarioLine: number;
  readonly sourceScenarioId: string;
}

const resolvePickle =
  (parsed: Parser.CompiledFeature) =>
  (pickle: Parser.CompiledFeature["pickles"][number], scenarioIndex: number): ResolvedPickle => {
    const sourceScenario = Parser.findScenario(pickle, parsed.source);
    return {
      pickle,
      scenarioIndex,
      sourceScenario,
      scenarioTitle: Fn.pipe(
        sourceScenario,
        Option.map(({ scenario }) => scenario.name),
        Option.getOrElse(() => pickle.name),
      ),
      scenarioLine: sourceScenarioLine(pickle, sourceScenario, parsed.line),
      sourceScenarioId: Fn.pipe(
        sourceScenario,
        Option.map(({ scenario }) => scenario.id),
        Option.getOrElse(() => pickle.id),
      ),
    };
  };

const buildScenarioTask = (
  source: FeatureSource,
  parsed: Parser.CompiledFeature,
  definition: Bdd.Feature<unknown, never>,
  scenarioDefinitions: Record.ReadonlyRecord<
    string,
    Bdd.Feature<unknown, never>["scenarios"][number]
  >,
  entry: ResolvedPickle,
): BuiltScenario => {
  const scenarioDefinition = Record.get(scenarioDefinitions, entry.scenarioTitle);
  if (Option.isNone(scenarioDefinition)) {
    return {
      _tag: "Diagnostic",
      diagnostic: {
        _tag: "UnmatchedScenario",
        featurePath: source.path,
        featureTitle: parsed.name,
        scenarioTitle: entry.scenarioTitle,
        scenarioLine: entry.scenarioLine,
        message: `Scenario has no matching Bdd.scenario chain: ${entry.scenarioTitle}`,
      },
    };
  }
  return {
    _tag: "Task",
    task: {
      featurePath: source.path,
      core: {
        featureDefinition: definition,
        scenarioDefinition: scenarioDefinition.value,
        featureTitle: parsed.name,
        scenarioTitle: entry.pickle.name,
        sourceScenarioTitle: entry.scenarioTitle,
        scenarioIndex: entry.scenarioIndex,
        scenarioLine: entry.scenarioLine,
        ...sourceScenarioRuleFields(entry.sourceScenario),
        tags: Arr.map(entry.pickle.tags, (tag) => tag.name),
        pickle: entry.pickle,
        source: parsed.source,
      },
    },
  };
};

const sourceScenarioLine = (
  pickle: Parser.CompiledFeature["pickles"][number],
  sourceScenario: ReturnType<typeof Parser.findScenario>,
  fallbackLine: number,
): number =>
  pickle.location?.line ??
  Fn.pipe(
    sourceScenario,
    Option.map(({ scenario }) => scenario.location.line),
    Option.getOrElse(() => fallbackLine),
  );

const sourceScenarioRuleFields = (
  sourceScenario: ReturnType<typeof Parser.findScenario>,
): { readonly ruleTitle: string; readonly ruleLine: number } | {} =>
  Fn.pipe(
    sourceScenario,
    Option.map(({ rule }) => ruleFields(rule)),
    Option.getOrElse(() => ({})),
  );

type SourceScenarioEntry = Parser.SourceIndex["scenarios"][string];

type SourceScenarioRule = SourceScenarioEntry extends { readonly rule: infer Rule } ? Rule : never;

const ruleFields = (
  rule: SourceScenarioRule,
): { readonly ruleTitle: string; readonly ruleLine: number } | {} =>
  rule === undefined
    ? {}
    : {
        ruleTitle: rule.name,
        ruleLine: rule.location.line,
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

const duplicateScenarioDefinition = (definition: Bdd.Feature<unknown, never>): string | undefined =>
  Fn.pipe(
    Arr.map(definition.scenarios, (scenario) => scenario.title),
    CoreRunner.firstDuplicateTitle,
    Option.getOrUndefined,
  );

interface TitleIndex {
  [title: string]: true | undefined;
}

type TitleMatcher = (title: string) => boolean;

const indexedTitleThreshold = 64;

const titleMatcher = (titles: ReadonlyArray<string>): TitleMatcher => {
  if (titles.length < indexedTitleThreshold) {
    return (title) => Arr.contains(title)(titles);
  }
  const index = titleIndex(titles);
  return (title) => hasTitle(index, title);
};

const emptyTitleIndex = (): TitleIndex => Object.create(null);

const titleIndex = (titles: ReadonlyArray<string>): TitleIndex =>
  Fn.pipe(
    titles,
    Arr.reduce(emptyTitleIndex(), (index, title) => indexTitle(index, title)),
  );

const hasTitle = (index: TitleIndex, title: string): boolean => index[title] === true;

const indexTitle = (index: TitleIndex, title: string): TitleIndex => {
  index[title] = true;
  return index;
};

/** @internal */
export type CliRunError = DiscoveryError | ModuleLoadError | ParseError;
