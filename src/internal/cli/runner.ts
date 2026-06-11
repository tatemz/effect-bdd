import * as Arr from "effect/Array"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import { pipe } from "effect/Function"
import * as Option from "effect/Option"
import type * as Path from "effect/Path"
import type * as Bdd from "../../Bdd.ts"
import type { ParseError } from "../../Errors.ts"
import * as Parser from "../parser.ts"
import * as CoreRunner from "../runner.ts"
import { DiscoveryError, type ModuleLoadError } from "./errors.ts"
import type { GlobResolver } from "./glob.ts"
import { loadFeatureDefinitions, loadFeatureSources } from "./loaders.ts"
import type {
  CliDiagnostic,
  CliOptions,
  CliRunResult,
  FeatureSource,
  RunSummary,
  ScenarioResult,
  ScenarioTask
} from "./models.ts"
import type { ModuleLoader } from "./moduleLoader.ts"
import * as TagExpression from "./tagExpression.ts"

interface BuiltScenarios {
  readonly tasks: ReadonlyArray<ScenarioTask>
  readonly diagnostics: ReadonlyArray<CliDiagnostic>
  readonly matchedFeatureNames: ReadonlyArray<string>
}

/** @internal */
export const run: (
  options: CliOptions
) => Effect.Effect<
  CliRunResult,
  CliRunError,
  FileSystem.FileSystem | GlobResolver | ModuleLoader | Path.Path | Parser.GherkinCompiler
> = Effect.fnUntraced(function*(options: CliOptions) {
  const startedAt = yield* Clock.currentTimeMillis
  const sources = yield* loadFeatureSources(options.features)
  const definitions = yield* loadFeatureDefinitions(options.steps)
  const built = yield* pipe(
    sources,
    Effect.forEach((source) => buildScenarioTasks(source, definitions)),
    Effect.map(combineBuiltScenarios)
  )
  const filteredTasks = yield* filterTasks(options, built.tasks)
  const results = yield* runScenarios(options, filteredTasks)
  const finishedAt = yield* Clock.currentTimeMillis
  const diagnostics: ReadonlyArray<CliDiagnostic> = pipe(
    built.diagnostics,
    Arr.appendAll(unusedFeatureDefinitions(definitions, built.matchedFeatureNames))
  )
  return {
    results,
    diagnostics,
    summary: summarize(sources.length, results, finishedAt - startedAt)
  } satisfies CliRunResult
})

const buildScenarioTasks: (
  source: FeatureSource,
  definitions: ReadonlyArray<Bdd.Feature<unknown, never>>
) => Effect.Effect<BuiltScenarios, DiscoveryError | ParseError, Parser.GherkinCompiler> = Effect.fnUntraced(function*(
  source: FeatureSource,
  definitions: ReadonlyArray<Bdd.Feature<unknown, never>>
) {
  const parsed = yield* Parser.parse(source.source, source.path)
  const matches = Arr.filter(definitions, (definition) => definition.name === parsed.name)
  if (matches.length > 1) {
    return yield* Effect.fail(
      new DiscoveryError({
        message: `Multiple feature definitions matched "${parsed.name}"`
      })
    )
  }
  const definition = matches[0]
  if (definition === undefined) {
    return {
      tasks: [],
      diagnostics: pipe(
        [
          {
            _tag: "UnmatchedFeature",
            featurePath: source.path,
            featureName: parsed.name,
            line: parsed.line,
            message: `Feature file has no matching Bdd.feature export: ${parsed.name}`
          } satisfies CliDiagnostic
        ],
        Arr.appendAll(Arr.map(parsed.pickles, (pickle): CliDiagnostic => ({
          _tag: "UnmatchedScenario",
          featurePath: source.path,
          featureName: parsed.name,
          scenarioName: pickle.name,
          scenarioLine: pickle.location?.line ?? parsed.line,
          message: `Scenario cannot run because no feature definition matched "${parsed.name}"`
        })))
      ),
      matchedFeatureNames: []
    }
  }
  const duplicateScenario = duplicateScenarioDefinition(definition)
  if (duplicateScenario !== undefined) {
    return yield* Effect.fail(
      new DiscoveryError({
        message: `Duplicate scenario chain name in "${definition.name}": ${duplicateScenario}`
      })
    )
  }

  const scenarioDefinitions = new Map(Arr.map(definition.scenarios, (scenario) => [scenario.name, scenario] as const))
  const tasks: Array<ScenarioTask> = []
  const diagnostics: Array<CliDiagnostic> = []
  const usedScenarioNames: Array<string> = []

  for (const [scenarioIndex, pickle] of parsed.pickles.entries()) {
    const sourceScenario = Parser.findScenario(pickle, parsed.source)
    const scenarioName = pipe(
      sourceScenario,
      Option.map(({ scenario }) => scenario.name),
      Option.getOrElse(() => pickle.name)
    )
    const scenarioLine = pickle.location?.line ?? pipe(
      sourceScenario,
      Option.map(({ scenario }) => scenario.location.line),
      Option.getOrElse(() => parsed.line)
    )
    const scenarioDefinition = scenarioDefinitions.get(scenarioName)
    if (scenarioDefinition === undefined) {
      diagnostics.push({
        _tag: "UnmatchedScenario",
        featurePath: source.path,
        featureName: parsed.name,
        scenarioName,
        scenarioLine,
        message: `Scenario has no matching Bdd.scenario chain: ${scenarioName}`
      })
      continue
    }
    usedScenarioNames.push(scenarioName)
    const rule = pipe(
      sourceScenario,
      Option.map(({ rule }) => rule),
      Option.getOrUndefined
    )
    tasks.push({
      featurePath: source.path,
      core: {
        featureDefinition: definition,
        scenarioDefinition,
        featureName: parsed.name,
        scenarioName: pickle.name,
        sourceScenarioName: scenarioName,
        scenarioIndex,
        scenarioLine,
        ...(rule === undefined ? {} : {
          ruleName: rule.name,
          ruleLine: rule.location.line
        }),
        tags: pickle.tags.map((tag) => tag.name),
        pickle,
        source: parsed.source
      }
    })
  }

  for (const scenario of definition.scenarios) {
    if (!Arr.contains(scenario.name)(usedScenarioNames)) {
      diagnostics.push({
        _tag: "UnusedScenarioDefinition",
        featureName: definition.name,
        scenarioName: scenario.name,
        message: `Scenario chain exported but no source scenario matched: ${definition.name} / ${scenario.name}`
      })
    }
  }

  return {
    tasks,
    diagnostics,
    matchedFeatureNames: [definition.name]
  }
})

const runScenario = Effect.fnUntraced(function*(task: ScenarioTask) {
  const startedAt = yield* Clock.currentTimeMillis
  const result = yield* Effect.result(CoreRunner.runScenarioTask(task.core))
  const finishedAt = yield* Clock.currentTimeMillis
  return {
    task,
    outcome: result._tag === "Success"
      ? { _tag: "Passed", steps: result.success.steps }
      : { _tag: "Failed", error: result.failure },
    durationMillis: finishedAt - startedAt
  } satisfies ScenarioResult
})

const runScenarios = (
  options: CliOptions,
  tasks: ReadonlyArray<ScenarioTask>
): Effect.Effect<ReadonlyArray<ScenarioResult>, never, never> =>
  options.filters.failFast
    ? runScenariosFailFast(tasks)
    : Effect.forEach(tasks, runScenario, { concurrency: options.parallel })

const runScenariosFailFast: (
  tasks: ReadonlyArray<ScenarioTask>
) => Effect.Effect<ReadonlyArray<ScenarioResult>, never, never> = Effect.fnUntraced(function*(
  tasks: ReadonlyArray<ScenarioTask>
) {
  const results: Array<ScenarioResult> = []
  for (const task of tasks) {
    const result = yield* runScenario(task)
    results.push(result)
    if (result.outcome._tag === "Failed") {
      break
    }
  }
  return results
})

const filterTasks = (
  options: CliOptions,
  tasks: ReadonlyArray<ScenarioTask>
): Effect.Effect<ReadonlyArray<ScenarioTask>, DiscoveryError> =>
  pipe(
    TagExpression.compileAll(options.filters.tags),
    Effect.map((tagPredicate) => {
      const filtered = Arr.filter(tasks, (task) =>
        tagPredicate(task.core.tags) && matchesNameFilter(options.filters.names, task))
      return filtered
    }),
    Effect.flatMap((filtered) =>
      tasks.length > 0 && filtered.length === 0
        ? Effect.fail(new DiscoveryError({ message: "No scenarios matched the provided filters" }))
        : Effect.succeed(filtered)
    )
  )

const matchesNameFilter = (patterns: ReadonlyArray<string>, task: ScenarioTask): boolean =>
  patterns.length === 0 ||
  Arr.some(patterns, (pattern) => `${task.core.featureName} / ${task.core.scenarioName}`.includes(pattern))

const summarize = (features: number, results: ReadonlyArray<ScenarioResult>, durationMillis: number): RunSummary => {
  const failed = Arr.filter(results, (result) => result.outcome._tag === "Failed").length
  return {
    features,
    total: results.length,
    passed: results.length - failed,
    failed,
    durationMillis
  }
}

const combineBuiltScenarios = (built: ReadonlyArray<BuiltScenarios>): BuiltScenarios => ({
  tasks: pipe(built, Arr.flatMap((item) => item.tasks)),
  diagnostics: pipe(built, Arr.flatMap((item) => item.diagnostics)),
  matchedFeatureNames: pipe(
    built,
    Arr.flatMap((item) => item.matchedFeatureNames),
    Arr.dedupe
  )
})

const unusedFeatureDefinitions = (
  definitions: ReadonlyArray<Bdd.Feature<unknown, never>>,
  matchedFeatureNames: ReadonlyArray<string>
): ReadonlyArray<CliDiagnostic> =>
  pipe(
    definitions,
    Arr.filter((definition) => !Arr.contains(definition.name)(matchedFeatureNames)),
    Arr.map((definition): CliDiagnostic => ({
      _tag: "UnusedFeatureDefinition",
      featureName: definition.name,
      message: `Feature definition exported but no feature file matched: ${definition.name}`
    }))
  )

const duplicateScenarioDefinition = (definition: Bdd.Feature<unknown, never>): string | undefined => {
  const seen = new Set<string>()
  for (const scenario of definition.scenarios) {
    if (seen.has(scenario.name)) {
      return scenario.name
    }
    seen.add(scenario.name)
  }
  return undefined
}

/** @internal */
export type CliRunError = DiscoveryError | ModuleLoadError | ParseError
