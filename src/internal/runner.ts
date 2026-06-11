import type { Pickle, PickleStep } from "@cucumber/messages"
import { PickleStepType } from "@cucumber/messages"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import { pipe } from "effect/Function"
import * as Option from "effect/Option"
import * as Record from "effect/Record"
import * as Schema from "effect/Schema"
import type * as Bdd from "../Bdd.ts"
import { MatchError, ParseError, StepError } from "../Errors.ts"
import * as Parser from "./parser.ts"

/** @internal */
export interface DataTableInput {
  readonly rows: ReadonlyArray<{
    readonly cells: ReadonlyArray<{
      readonly value: string
    }>
  }>
}

/** @internal */
export interface DocStringInput {
  readonly content: string
}

/** @internal */
export type ConcreteStepKind = "Given" | "When" | "Then"

/** @internal */
export interface ScenarioTask<E, R> {
  readonly featureDefinition: Bdd.Feature<E, R>
  readonly scenarioDefinition: Bdd.Scenario<any, any, any>
  readonly featureName: string
  readonly scenarioName: string
  readonly sourceScenarioName: string
  readonly scenarioIndex: number
  readonly scenarioLine: number
  readonly ruleName?: string
  readonly ruleLine?: number
  readonly tags: ReadonlyArray<string>
  readonly pickle: Pickle
  readonly source: Parser.SourceIndex
}

/** @internal */
export type ScenarioReport = Bdd.Report["scenarios"][number]

/** @internal */
export const decodeTable = <S extends Schema.Decoder<unknown, never>>(row: S) => {
  const decode = Schema.decodeUnknownEffect(row)
  return (table: DataTableInput): Effect.Effect<ReadonlyArray<S["Type"]>, unknown> => {
    const [headers, ...rows] = table.rows.map((row) => row.cells.map((cell) => cell.value))
    if (headers === undefined) {
      return Effect.succeed([])
    }
    return Effect.forEach(rows, (cells: ReadonlyArray<string>) => decode(rowObject(headers, cells)))
  }
}

/** @internal */
export const decodeDocString = <S extends Schema.Decoder<unknown, never>>(schema: S) => {
  const decode = Schema.decodeUnknownEffect(schema)
  return (docString: DocStringInput): Effect.Effect<S["Type"], unknown> => decode(docString.content)
}

/** @internal */
export const run = <E, R>(
  featureDefinition: Bdd.Feature<E, R>,
  source: string
): Effect.Effect<Bdd.Report, Bdd.RunError, R | Parser.GherkinCompiler> =>
  pipe(
    Parser.parse(source),
    Effect.flatMap((feature) =>
      pipe(
        buildScenarioTasks(featureDefinition, feature),
        Effect.flatMap((tasks) => Effect.forEach(tasks, runScenarioTask)),
        Effect.map((scenarios): Bdd.Report => ({
          feature: feature.name,
          scenarios
        }))
      )
    )
  )

/** @internal */
export const buildScenarioTasks = <E, R>(
  featureDefinition: Bdd.Feature<E, R>,
  feature: Parser.CompiledFeature
): Effect.Effect<ReadonlyArray<ScenarioTask<E, R>>, MatchError> =>
  Effect.gen(function*() {
    yield* validateFeatureDefinition(featureDefinition, feature)
    yield* validateUniqueScenarioDefinitions(featureDefinition)

    const scenarioDefinitions = scenarioDefinitionMap(featureDefinition)
    const tasks: Array<ScenarioTask<E, R>> = []
    const usedScenarioNames: Array<string> = []
    const seenSourceScenarios = new Map<string, string>()

    for (const [scenarioIndex, pickle] of feature.pickles.entries()) {
      const source = Parser.findScenario(pickle, feature.source)
      const scenarioName = pipe(
        source,
        Option.map(({ scenario }) => scenario.name),
        Option.getOrElse(() => pickle.name)
      )
      const scenarioLine = pickle.location?.line ?? pipe(
        source,
        Option.map(({ scenario }) => scenario.location.line),
        Option.getOrElse(() => feature.line)
      )
      const sourceScenarioId = pipe(
        source,
        Option.map(({ scenario }) => scenario.id),
        Option.getOrElse(() => pickle.id)
      )
      const previouslySeenId = seenSourceScenarios.get(scenarioName)
      if (previouslySeenId !== undefined && previouslySeenId !== sourceScenarioId) {
        return yield* matchErrorEffect({
          message: `Duplicate scenario name in Gherkin feature: ${scenarioName}`,
          scenario: scenarioName,
          step: scenarioName,
          line: scenarioLine,
          candidates: [scenarioName]
        })
      }
      seenSourceScenarios.set(scenarioName, sourceScenarioId)

      const scenarioDefinition = scenarioDefinitions.get(scenarioName)
      if (scenarioDefinition === undefined) {
        return yield* matchErrorEffect({
          message: `No scenario chain matched source scenario "${scenarioName}"`,
          scenario: scenarioName,
          step: scenarioName,
          line: scenarioLine,
          candidates: Arr.map(featureDefinition.scenarios, (scenario) => scenario.name)
        })
      }
      usedScenarioNames.push(scenarioName)

      const rule = pipe(
        source,
        Option.map(({ rule }) => rule),
        Option.getOrUndefined
      )
      tasks.push({
        featureDefinition,
        scenarioDefinition,
        featureName: feature.name,
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
        source: feature.source
      })
    }

    const unused = Arr.filter(featureDefinition.scenarios, (scenario) => !Arr.contains(scenario.name)(usedScenarioNames))
    if (unused.length > 0) {
      const scenario = unused[0]
      return yield* matchErrorEffect({
        message: `Scenario chain has no matching source scenario: ${scenario.name}`,
        scenario: scenario.name,
        step: scenario.name,
        line: feature.line,
        candidates: Arr.map(feature.pickles, (pickle) =>
          pipe(
            Parser.findScenario(pickle, feature.source),
            Option.map(({ scenario }) => scenario.name),
            Option.getOrElse(() => pickle.name)
          ))
      })
    }

    return tasks
  })

/** @internal */
export const runScenarioTask = <E, R>(
  task: ScenarioTask<E, R>
): Effect.Effect<ScenarioReport, Bdd.RunError, R> =>
  pipe(
    runSteps(task),
    Effect.as({
      name: task.scenarioName,
      steps: task.pickle.steps.length,
      tags: task.tags
    })
  )

const runSteps: <E, R>(task: ScenarioTask<E, R>) => Effect.Effect<unknown, Bdd.RunError, R> = Effect.fnUntraced(
  function*<E, R>(task: ScenarioTask<E, R>) {
    const steps = task.pickle.steps
    const definitions = task.scenarioDefinition.steps
    if (steps.length !== definitions.length) {
      return yield* matchErrorEffect({
        message: `Scenario "${task.sourceScenarioName}" has ${steps.length} source step(s), but its chain has ${definitions.length} step(s)`,
        scenario: task.sourceScenarioName,
        step: task.sourceScenarioName,
        line: task.scenarioLine,
        candidates: Arr.map(definitions, (step) => step.expression.source)
      })
    }

    let state: unknown = undefined
    for (let index = 0; index < steps.length; index++) {
      state = yield* runStep(task, definitions[index], steps[index], index, state)
    }
    return state
  }
)

const runStep = <E, R>(
  task: ScenarioTask<E, R>,
  stepDefinition: Bdd.AnyStep,
  step: PickleStep,
  index: number,
  state: unknown
): Effect.Effect<unknown, Bdd.RunError, R> =>
  pipe(
    stepKind(step, task.source),
    Effect.flatMap((kind) =>
      pipe(
        verifyStep(task, stepDefinition, step, kind, index),
        Effect.flatMap((captures) =>
          pipe(
            decodeArgument(stepDefinition, task.sourceScenarioName, step, task.source),
            Effect.flatMap((argument) =>
              pipe(
                stepDefinition.run(captures, argument, state),
                Effect.mapError((cause) =>
                  new StepError({
                    message: `Step failed: ${step.text}`,
                    scenario: task.sourceScenarioName,
                    step: step.text,
                    line: Parser.stepLine(step, task.source),
                    cause
                  })
                )
              )
            )
          )
        )
      )
    )
  )

const verifyStep = (
  task: ScenarioTask<unknown, unknown>,
  stepDefinition: Bdd.AnyStep,
  step: PickleStep,
  kind: ConcreteStepKind,
  index: number
): Effect.Effect<unknown, MatchError> => {
  const keywordMatches = stepDefinition.kind === "Step" || stepDefinition.kind === kind
  if (!keywordMatches) {
    return failStep(
      `Step ${index + 1} keyword mismatch: source is ${kind}, chain expects ${stepDefinition.kind}`,
      task.sourceScenarioName,
      step,
      task.source,
      [stepDefinition.expression.source]
    )
  }
  return pipe(
    stepDefinition.expression.match(step.text),
    Option.match({
      onNone: () =>
        failStep(
          `Step ${index + 1} text mismatch: source says "${step.text}", chain expects "${stepDefinition.expression.source}"`,
          task.sourceScenarioName,
          step,
          task.source,
          [stepDefinition.expression.source]
        ),
      onSome: Effect.succeed
    })
  )
}

const decodeArgument = (
  stepDefinition: Bdd.AnyStep,
  scenario: string,
  step: PickleStep,
  source: Parser.SourceIndex
): Effect.Effect<unknown, MatchError> => {
  const candidates = [stepDefinition.expression.source]
  if (stepDefinition.argument === undefined) {
    return hasStepArgument(step)
      ? failStep(`Step "${step.text}" has an unexpected argument`, scenario, step, source, candidates)
      : Effect.succeed(undefined)
  }

  if (stepDefinition.argument._tag === "TableArg") {
    return step.argument?.dataTable === undefined
      ? failStep(`Step "${step.text}" requires a DataTable`, scenario, step, source, candidates)
      : pipe(
        stepDefinition.argument.decode(step.argument.dataTable),
        Effect.mapError((cause) =>
          matchError(`Could not decode DataTable for step "${step.text}"`, scenario, step, source, candidates, cause)
        )
      )
  }

  return step.argument?.docString === undefined
    ? failStep(`Step "${step.text}" requires a DocString`, scenario, step, source, candidates)
    : pipe(
      stepDefinition.argument.decode(step.argument.docString),
      Effect.mapError((cause) =>
        matchError(`Could not decode DocString for step "${step.text}"`, scenario, step, source, candidates, cause)
      )
    )
}

const validateFeatureDefinition = <E, R>(
  featureDefinition: Bdd.Feature<E, R>,
  feature: Parser.CompiledFeature
): Effect.Effect<void, MatchError> =>
  featureDefinition.name === feature.name
    ? Effect.void
    : matchErrorEffect({
      message: `Feature definition "${featureDefinition.name}" does not match Gherkin feature "${feature.name}"`,
      scenario: "",
      step: feature.name,
      line: feature.line,
      candidates: [featureDefinition.name]
    })

const validateUniqueScenarioDefinitions = <E, R>(featureDefinition: Bdd.Feature<E, R>) => {
  const seen = new Set<string>()
  for (const scenario of featureDefinition.scenarios) {
    if (seen.has(scenario.name)) {
      return matchErrorEffect({
        message: `Duplicate scenario chain name: ${scenario.name}`,
        scenario: scenario.name,
        step: scenario.name,
        line: 1,
        candidates: [scenario.name]
      })
    }
    seen.add(scenario.name)
  }
  return Effect.void
}

const scenarioDefinitionMap = <E, R>(featureDefinition: Bdd.Feature<E, R>): ReadonlyMap<string, Bdd.Scenario<any, any, any>> =>
  new Map(Arr.map(featureDefinition.scenarios, (scenario) => [scenario.name, scenario] as const))

/** @internal */
export const concreteStepKind = (step: PickleStep): Option.Option<ConcreteStepKind> => {
  switch (step.type) {
    case PickleStepType.CONTEXT: {
      return Option.some("Given")
    }
    case PickleStepType.ACTION: {
      return Option.some("When")
    }
    case PickleStepType.OUTCOME: {
      return Option.some("Then")
    }
    default: {
      return Option.none()
    }
  }
}

const rowObject = (
  headers: ReadonlyArray<string>,
  cells: ReadonlyArray<string>
): Record<string, string> =>
  pipe(
    headers,
    Arr.map((header, index) => [header, cells[index] ?? ""] as const),
    Record.fromEntries
  )

const hasStepArgument = (step: PickleStep): boolean => step.argument !== undefined

const stepKind = (
  step: PickleStep,
  source: Parser.SourceIndex
): Effect.Effect<ConcreteStepKind, ParseError> =>
  pipe(
    concreteStepKind(step),
    Option.match({
      onNone: () =>
        Effect.fail(
          new ParseError({
            message: `${Parser.stepKeyword(step, source)} found before a Given, When, or Then step`,
            line: Parser.stepLine(step, source),
            column: 1
          })
        ),
      onSome: Effect.succeed
    })
  )

const failStep = (
  message: string,
  scenario: string,
  step: PickleStep,
  source: Parser.SourceIndex,
  candidates: ReadonlyArray<string>,
  cause?: unknown
): Effect.Effect<never, MatchError> => Effect.fail(matchError(message, scenario, step, source, candidates, cause))

const matchError = (
  message: string,
  scenario: string,
  step: PickleStep,
  source: Parser.SourceIndex,
  candidates: ReadonlyArray<string>,
  cause?: unknown
): MatchError =>
  new MatchError({
    message,
    scenario,
    step: step.text,
    line: Parser.stepLine(step, source),
    candidates,
    ...(cause === undefined ? {} : { cause })
  })

const matchErrorEffect = (options: {
  readonly message: string
  readonly scenario: string
  readonly step: string
  readonly line: number
  readonly candidates: ReadonlyArray<string>
  readonly cause?: unknown
}): Effect.Effect<never, MatchError> => Effect.fail(new MatchError(options))
