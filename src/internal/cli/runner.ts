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
  const sources = yield* loadFeatureSources(options.features);
  const loadedDefinitions = yield* loadFeatureDefinitions(options.steps);
  const definitions = loadedDefinitions.definitions;
  const built = yield* Fn.pipe(
    sources,
    Effect.forEach((source) => buildScenarioTasks(source, definitions)),
    Effect.map(combineBuiltScenarios),
  );
  const filteredTasks = yield* filterTasks(options, built.tasks);
  const results = yield* runScenarios(options, filteredTasks, events);
  const finishedAt = yield* Clock.currentTimeMillis;
  const diagnostics: ReadonlyArray<CliDiagnostic> = Fn.pipe(
    built.diagnostics,
    Arr.appendAll(unusedFeatureDefinitions(definitions, built.matchedFeatureTitles)),
  );
  return {
    results,
    diagnostics,
    summary: summarize(sources.length, results, finishedAt - startedAt),
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

const buildScenarioTasks: (
  source: FeatureSource,
  definitions: ReadonlyArray<Bdd.Feature<unknown, never>>,
) => Effect.Effect<BuiltScenarios, DiscoveryError | ParseError, Parser.GherkinCompiler> =
  Effect.fnUntraced(function* (
    source: FeatureSource,
    definitions: ReadonlyArray<Bdd.Feature<unknown, never>>,
  ) {
    const parsed = yield* Parser.parse(source.source, source.path);
    const matches = Arr.filter(definitions, (definition) => definition.title === parsed.name);
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
    const duplicateScenario = duplicateScenarioDefinition(definition);
    if (duplicateScenario !== undefined) {
      return yield* Effect.fail(
        new DiscoveryError({
          message: `Duplicate scenario chain title in "${definition.title}": ${duplicateScenario}`,
        }),
      );
    }

    const scenarioDefinitions = Fn.pipe(
      definition.scenarios,
      Arr.map((scenario) => [scenario.title, scenario] as const),
      Record.fromEntries,
    );
    const built = Arr.map(parsed.pickles, (pickle, scenarioIndex) =>
      buildScenarioTask(source, parsed, definition, scenarioDefinitions, pickle, scenarioIndex),
    );
    const tasks = Arr.filterMap(built, (item) =>
      item._tag === "Task" ? Result.succeed(item.task) : Result.fail(undefined),
    );
    const usedScenarioTitles = Arr.map(tasks, (task) => task.core.sourceScenarioTitle);
    const unmatched = Arr.filterMap(built, (item) =>
      item._tag === "Diagnostic" ? Result.succeed(item.diagnostic) : Result.fail(undefined),
    );
    const unused = Fn.pipe(
      definition.scenarios,
      Arr.filter((scenario) => !Arr.contains(scenario.title)(usedScenarioTitles)),
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

type BuiltScenario =
  | { readonly _tag: "Task"; readonly task: ScenarioTask }
  | { readonly _tag: "Diagnostic"; readonly diagnostic: CliDiagnostic };

const buildScenarioTask = (
  source: FeatureSource,
  parsed: Parser.CompiledFeature,
  definition: Bdd.Feature<unknown, never>,
  scenarioDefinitions: Record.ReadonlyRecord<
    string,
    Bdd.Feature<unknown, never>["scenarios"][number]
  >,
  pickle: Parser.CompiledFeature["pickles"][number],
  scenarioIndex: number,
): BuiltScenario => {
  const sourceScenario = Parser.findScenario(pickle, parsed.source);
  const scenarioTitle = Fn.pipe(
    sourceScenario,
    Option.map(({ scenario }) => scenario.name),
    Option.getOrElse(() => pickle.name),
  );
  const scenarioLine = sourceScenarioLine(pickle, sourceScenario, parsed.line);
  const scenarioDefinition = Record.get(scenarioDefinitions, scenarioTitle);
  if (Option.isNone(scenarioDefinition)) {
    return {
      _tag: "Diagnostic",
      diagnostic: {
        _tag: "UnmatchedScenario",
        featurePath: source.path,
        featureTitle: parsed.name,
        scenarioTitle,
        scenarioLine,
        message: `Scenario has no matching Bdd.scenario chain: ${scenarioTitle}`,
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
        scenarioTitle: pickle.name,
        sourceScenarioTitle: scenarioTitle,
        scenarioIndex,
        scenarioLine,
        ...sourceScenarioRuleFields(sourceScenario),
        tags: Arr.map(pickle.tags, (tag) => tag.name),
        pickle,
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
): RunSummary => {
  const failed = Arr.filter(results, (result) => result.outcome._tag === "Failed").length;
  return {
    features,
    total: results.length,
    passed: results.length - failed,
    failed,
    durationMillis,
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

/** @internal */
export type CliRunError = DiscoveryError | ModuleLoadError | ParseError;
