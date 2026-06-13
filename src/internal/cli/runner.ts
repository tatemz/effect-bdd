import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Fn from "effect/Function";
import * as Option from "effect/Option";
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
  FeatureSource,
  RunSummary,
  ScenarioResult,
  ScenarioTask,
} from "./models.ts";
import type { ModuleLoader } from "./moduleLoader.ts";
import * as TagExpression from "./tagExpression.ts";

interface BuiltScenarios {
  readonly tasks: ReadonlyArray<ScenarioTask>;
  readonly diagnostics: ReadonlyArray<CliDiagnostic>;
  readonly matchedFeatureNames: ReadonlyArray<string>;
}

/** @internal */
export const run: (
  options: CliOptions,
) => Effect.Effect<
  CliRunResult,
  CliRunError,
  FileSystem.FileSystem | GlobResolver | ModuleLoader | Path.Path | Parser.GherkinCompiler
> = Effect.fnUntraced(function* (options: CliOptions) {
  const startedAt = yield* Clock.currentTimeMillis;
  const sources = yield* loadFeatureSources(options.features);
  const definitions = yield* loadFeatureDefinitions(options.steps);
  const built = yield* Fn.pipe(
    sources,
    Effect.forEach((source) => buildScenarioTasks(source, definitions)),
    Effect.map(combineBuiltScenarios),
  );
  const filteredTasks = yield* filterTasks(options, built.tasks);
  const results = yield* runScenarios(options, filteredTasks);
  const finishedAt = yield* Clock.currentTimeMillis;
  const diagnostics: ReadonlyArray<CliDiagnostic> = Fn.pipe(
    built.diagnostics,
    Arr.appendAll(unusedFeatureDefinitions(definitions, built.matchedFeatureNames)),
  );
  return {
    results,
    diagnostics,
    summary: summarize(sources.length, results, finishedAt - startedAt),
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
    const matches = Arr.filter(definitions, (definition) => definition.name === parsed.name);
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
              featureName: parsed.name,
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
                featureName: parsed.name,
                scenarioName: pickle.name,
                scenarioLine: pickle.location?.line ?? parsed.line,
                message: `Scenario cannot run because no feature definition matched "${parsed.name}"`,
              }),
            ),
          ),
        ),
        matchedFeatureNames: [],
      };
    }
    const duplicateScenario = duplicateScenarioDefinition(definition);
    if (duplicateScenario !== undefined) {
      return yield* Effect.fail(
        new DiscoveryError({
          message: `Duplicate scenario chain name in "${definition.name}": ${duplicateScenario}`,
        }),
      );
    }

    const scenarioDefinitions = new Map(
      Arr.map(definition.scenarios, (scenario) => [scenario.name, scenario] as const),
    );
    const built = Arr.map(parsed.pickles, (pickle, scenarioIndex) =>
      buildScenarioTask(source, parsed, definition, scenarioDefinitions, pickle, scenarioIndex),
    );
    const tasks = Arr.filterMap(built, (item) =>
      item._tag === "Task" ? Result.succeed(item.task) : Result.fail(undefined),
    );
    const usedScenarioNames = Arr.map(tasks, (task) => task.core.sourceScenarioName);
    const unmatched = Arr.filterMap(built, (item) =>
      item._tag === "Diagnostic" ? Result.succeed(item.diagnostic) : Result.fail(undefined),
    );
    const unused = Fn.pipe(
      definition.scenarios,
      Arr.filter((scenario) => !Arr.contains(scenario.name)(usedScenarioNames)),
      Arr.map(
        (scenario): CliDiagnostic => ({
          _tag: "UnusedScenarioDefinition",
          featureName: definition.name,
          scenarioName: scenario.name,
          message: `Scenario chain exported but no source scenario matched: ${definition.name} / ${scenario.name}`,
        }),
      ),
    );

    return {
      tasks,
      diagnostics: Arr.appendAll(unmatched, unused),
      matchedFeatureNames: [definition.name],
    };
  });

type BuiltScenario =
  | { readonly _tag: "Task"; readonly task: ScenarioTask }
  | { readonly _tag: "Diagnostic"; readonly diagnostic: CliDiagnostic };

const buildScenarioTask = (
  source: FeatureSource,
  parsed: Parser.CompiledFeature,
  definition: Bdd.Feature<unknown, never>,
  scenarioDefinitions: ReadonlyMap<string, Bdd.Feature<unknown, never>["scenarios"][number]>,
  pickle: Parser.CompiledFeature["pickles"][number],
  scenarioIndex: number,
): BuiltScenario => {
  const sourceScenario = Parser.findScenario(pickle, parsed.source);
  const scenarioName = Fn.pipe(
    sourceScenario,
    Option.map(({ scenario }) => scenario.name),
    Option.getOrElse(() => pickle.name),
  );
  const scenarioLine =
    pickle.location?.line ??
    Fn.pipe(
      sourceScenario,
      Option.map(({ scenario }) => scenario.location.line),
      Option.getOrElse(() => parsed.line),
    );
  const scenarioDefinition = scenarioDefinitions.get(scenarioName);
  if (scenarioDefinition === undefined) {
    return {
      _tag: "Diagnostic",
      diagnostic: {
        _tag: "UnmatchedScenario",
        featurePath: source.path,
        featureName: parsed.name,
        scenarioName,
        scenarioLine,
        message: `Scenario has no matching Bdd.scenario chain: ${scenarioName}`,
      },
    };
  }
  const rule = Fn.pipe(
    sourceScenario,
    Option.map(({ rule }) => rule),
    Option.getOrUndefined,
  );
  return {
    _tag: "Task",
    task: {
      featurePath: source.path,
      core: {
        featureDefinition: definition,
        scenarioDefinition,
        featureName: parsed.name,
        scenarioName: pickle.name,
        sourceScenarioName: scenarioName,
        scenarioIndex,
        scenarioLine,
        ...(rule === undefined
          ? {}
          : {
              ruleName: rule.name,
              ruleLine: rule.location.line,
            }),
        tags: Arr.map(pickle.tags, (tag) => tag.name),
        pickle,
        source: parsed.source,
      },
    },
  };
};

const runScenario = Effect.fnUntraced(function* (task: ScenarioTask) {
  const startedAt = yield* Clock.currentTimeMillis;
  const result = yield* Effect.result(CoreRunner.runScenarioTask(task.core));
  const finishedAt = yield* Clock.currentTimeMillis;
  return {
    task,
    outcome:
      result._tag === "Success"
        ? { _tag: "Passed", steps: result.success.steps }
        : { _tag: "Failed", error: result.failure },
    durationMillis: finishedAt - startedAt,
  } satisfies ScenarioResult;
});

const runScenarios = (
  options: CliOptions,
  tasks: ReadonlyArray<ScenarioTask>,
): Effect.Effect<ReadonlyArray<ScenarioResult>, never, never> =>
  options.filters.failFast
    ? runScenariosFailFast(tasks)
    : Effect.forEach(tasks, runScenario, { concurrency: options.parallel });

const runScenariosFailFast = (
  tasks: ReadonlyArray<ScenarioTask>,
): Effect.Effect<ReadonlyArray<ScenarioResult>, never, never> =>
  Fn.pipe(
    tasks,
    Arr.matchLeft({
      onEmpty: () => Effect.succeed<ReadonlyArray<ScenarioResult>>([]),
      onNonEmpty: (task, rest) =>
        Effect.flatMap(runScenario(task), (result) =>
          result.outcome._tag === "Failed"
            ? Effect.succeed([result])
            : Effect.map(runScenariosFailFast(rest), Arr.prepend(result)),
        ),
    }),
  );

const filterTasks = (
  options: CliOptions,
  tasks: ReadonlyArray<ScenarioTask>,
): Effect.Effect<ReadonlyArray<ScenarioTask>, DiscoveryError> =>
  Fn.pipe(
    TagExpression.compileAll(options.filters.tags),
    Effect.map((tagPredicate) => {
      const filtered = Arr.filter(
        tasks,
        (task) => tagPredicate(task.core.tags) && matchesNameFilter(options.filters.names, task),
      );
      return filtered;
    }),
    Effect.flatMap((filtered) =>
      tasks.length > 0 && filtered.length === 0
        ? Effect.fail(new DiscoveryError({ message: "No scenarios matched the provided filters" }))
        : Effect.succeed(filtered),
    ),
  );

const matchesNameFilter = (patterns: ReadonlyArray<string>, task: ScenarioTask): boolean =>
  patterns.length === 0 ||
  Arr.some(patterns, (pattern) =>
    Fn.pipe(`${task.core.featureName} / ${task.core.scenarioName}`, Str.includes(pattern)),
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

const combineBuiltScenarios = (built: ReadonlyArray<BuiltScenarios>): BuiltScenarios => ({
  tasks: Fn.pipe(
    built,
    Arr.flatMap((item) => item.tasks),
  ),
  diagnostics: Fn.pipe(
    built,
    Arr.flatMap((item) => item.diagnostics),
  ),
  matchedFeatureNames: Fn.pipe(
    built,
    Arr.flatMap((item) => item.matchedFeatureNames),
    Arr.dedupe,
  ),
});

const unusedFeatureDefinitions = (
  definitions: ReadonlyArray<Bdd.Feature<unknown, never>>,
  matchedFeatureNames: ReadonlyArray<string>,
): ReadonlyArray<CliDiagnostic> =>
  Fn.pipe(
    definitions,
    Arr.filter((definition) => !Arr.contains(definition.name)(matchedFeatureNames)),
    Arr.map(
      (definition): CliDiagnostic => ({
        _tag: "UnusedFeatureDefinition",
        featureName: definition.name,
        message: `Feature definition exported but no feature file matched: ${definition.name}`,
      }),
    ),
  );

const duplicateScenarioDefinition = (definition: Bdd.Feature<unknown, never>): string | undefined =>
  Fn.pipe(
    Arr.map(definition.scenarios, (scenario) => scenario.name),
    CoreRunner.firstDuplicateName,
    Option.getOrUndefined,
  );

/** @internal */
export type CliRunError = DiscoveryError | ModuleLoadError | ParseError;
