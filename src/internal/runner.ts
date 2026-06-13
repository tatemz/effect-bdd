import type { Pickle, PickleStep } from "@cucumber/messages";
import { PickleStepType } from "@cucumber/messages";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Fn from "effect/Function";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import * as Schema from "effect/Schema";
import type * as Bdd from "../Bdd.ts";
import { MatchError, ParseError, StepError } from "../Errors.ts";
import * as Parser from "./parser.ts";

/** @internal */
export interface DataTableInput {
  readonly rows: ReadonlyArray<{
    readonly cells: ReadonlyArray<{
      readonly value: string;
    }>;
  }>;
}

/** @internal */
export interface DocStringInput {
  readonly content: string;
}

/** @internal */
export type ConcreteStepKind = "Given" | "When" | "Then";

/** @internal */
export interface ScenarioTask<E, R> {
  readonly featureDefinition: Bdd.Feature<E, R>;
  readonly scenarioDefinition: Bdd.Scenario<any, any, any>;
  readonly featureName: string;
  readonly scenarioName: string;
  readonly sourceScenarioName: string;
  readonly scenarioIndex: number;
  readonly scenarioLine: number;
  readonly ruleName?: string;
  readonly ruleLine?: number;
  readonly tags: ReadonlyArray<string>;
  readonly pickle: Pickle;
  readonly source: Parser.SourceIndex;
}

/** @internal */
export type ScenarioReport = Bdd.Report["scenarios"][number];

/** @internal */
export const decodeTable = <S extends Schema.Decoder<unknown, never>>(row: S) => {
  const decode = Schema.decodeUnknownEffect(row);
  return (table: DataTableInput): Effect.Effect<ReadonlyArray<S["Type"]>, unknown> =>
    Fn.pipe(
      table.rows,
      Arr.map((row) => Arr.map(row.cells, (cell) => cell.value)),
      Arr.matchLeft({
        onEmpty: () => Effect.succeed([]),
        onNonEmpty: (headers, rows) =>
          Effect.forEach(rows, (cells) => decode(rowObject(headers, cells))),
      }),
    );
};

/** @internal */
export const decodeDocString = <S extends Schema.Decoder<unknown, never>>(schema: S) => {
  const decode = Schema.decodeUnknownEffect(schema);
  return (docString: DocStringInput): Effect.Effect<S["Type"], unknown> =>
    decode(docString.content);
};

/** @internal */
export const run = <E, R>(
  featureDefinition: Bdd.Feature<E, R>,
  source: string,
): Effect.Effect<Bdd.Report, Bdd.RunError, R | Parser.GherkinCompiler> =>
  Fn.pipe(
    Parser.parse(source),
    Effect.flatMap((feature) =>
      Fn.pipe(
        buildScenarioTasks(featureDefinition, feature),
        Effect.flatMap((tasks) => Effect.forEach(tasks, runScenarioTask)),
        Effect.map(
          (scenarios): Bdd.Report => ({
            feature: feature.name,
            scenarios,
          }),
        ),
      ),
    ),
  );

/** @internal */
interface ResolvedPickle {
  readonly pickle: Pickle;
  readonly scenarioIndex: number;
  readonly scenarioName: string;
  readonly scenarioLine: number;
  readonly sourceScenarioId: string;
  readonly rule: ReturnType<typeof resolveRule>;
}

const resolvePickle =
  (feature: Parser.CompiledFeature) =>
  (pickle: Pickle, scenarioIndex: number): ResolvedPickle => {
    const source = Parser.findScenario(pickle, feature.source);
    return {
      pickle,
      scenarioIndex,
      scenarioName: Fn.pipe(
        source,
        Option.map(({ scenario }) => scenario.name),
        Option.getOrElse(() => pickle.name),
      ),
      scenarioLine:
        pickle.location?.line ??
        Fn.pipe(
          source,
          Option.map(({ scenario }) => scenario.location.line),
          Option.getOrElse(() => feature.line),
        ),
      sourceScenarioId: Fn.pipe(
        source,
        Option.map(({ scenario }) => scenario.id),
        Option.getOrElse(() => pickle.id),
      ),
      rule: resolveRule(source),
    };
  };

const resolveRule = (
  source: Option.Option<{
    readonly rule:
      | { readonly name: string; readonly location: { readonly line: number } }
      | undefined;
  }>,
) =>
  Fn.pipe(
    source,
    Option.map(({ rule }) => rule),
    Option.getOrUndefined,
  );

const duplicateSourceScenario = (
  resolved: ReadonlyArray<ResolvedPickle>,
  entry: ResolvedPickle,
): boolean =>
  Fn.pipe(
    Arr.take(resolved, entry.scenarioIndex),
    Arr.some(
      (previous) =>
        previous.scenarioName === entry.scenarioName &&
        previous.sourceScenarioId !== entry.sourceScenarioId,
    ),
  );

/** @internal */
export const buildScenarioTasks = <E, R>(
  featureDefinition: Bdd.Feature<E, R>,
  feature: Parser.CompiledFeature,
): Effect.Effect<ReadonlyArray<ScenarioTask<E, R>>, MatchError> =>
  Effect.gen(function* () {
    yield* validateFeatureDefinition(featureDefinition, feature);
    yield* validateUniqueScenarioDefinitions(featureDefinition);

    const scenarioDefinitions = scenarioDefinitionMap(featureDefinition);
    const resolved = Arr.map(feature.pickles, resolvePickle(feature));

    const tasks = yield* Effect.forEach(
      resolved,
      (entry): Effect.Effect<ScenarioTask<E, R>, MatchError> => {
        if (duplicateSourceScenario(resolved, entry)) {
          return matchErrorEffect({
            message: `Duplicate scenario name in Gherkin feature: ${entry.scenarioName}`,
            scenario: entry.scenarioName,
            step: entry.scenarioName,
            line: entry.scenarioLine,
            candidates: [entry.scenarioName],
          });
        }
        const scenarioDefinition = scenarioDefinitions.get(entry.scenarioName);
        if (scenarioDefinition === undefined) {
          return matchErrorEffect({
            message: `No scenario chain matched source scenario "${entry.scenarioName}"`,
            scenario: entry.scenarioName,
            step: entry.scenarioName,
            line: entry.scenarioLine,
            candidates: Arr.map(featureDefinition.scenarios, (scenario) => scenario.name),
          });
        }
        return Effect.succeed({
          featureDefinition,
          scenarioDefinition,
          featureName: feature.name,
          scenarioName: entry.pickle.name,
          sourceScenarioName: entry.scenarioName,
          scenarioIndex: entry.scenarioIndex,
          scenarioLine: entry.scenarioLine,
          ...(entry.rule === undefined
            ? {}
            : {
                ruleName: entry.rule.name,
                ruleLine: entry.rule.location.line,
              }),
          tags: Arr.map(entry.pickle.tags, (tag) => tag.name),
          pickle: entry.pickle,
          source: feature.source,
        });
      },
    );

    const usedScenarioNames = Arr.map(resolved, (entry) => entry.scenarioName);
    const unused = Arr.filter(
      featureDefinition.scenarios,
      (scenario) => !Arr.contains(scenario.name)(usedScenarioNames),
    );
    return yield* Fn.pipe(
      Arr.head(unused),
      Option.match({
        onNone: () => Effect.succeed(tasks),
        onSome: (scenario) =>
          matchErrorEffect({
            message: `Scenario chain has no matching source scenario: ${scenario.name}`,
            scenario: scenario.name,
            step: scenario.name,
            line: feature.line,
            candidates: Arr.map(resolved, (entry) => entry.scenarioName),
          }),
      }),
    );
  });

/** @internal */
export const runScenarioTask = <E, R>(
  task: ScenarioTask<E, R>,
): Effect.Effect<ScenarioReport, Bdd.RunError, R> =>
  Fn.pipe(
    runSteps(task),
    Effect.as({
      name: task.scenarioName,
      steps: task.pickle.steps.length,
      tags: task.tags,
    }),
  );

const runSteps: <E, R>(task: ScenarioTask<E, R>) => Effect.Effect<unknown, Bdd.RunError, R> =
  Effect.fnUntraced(function* <E, R>(task: ScenarioTask<E, R>) {
    const steps = task.pickle.steps;
    const definitions = task.scenarioDefinition.steps;
    if (steps.length !== definitions.length) {
      return yield* matchErrorEffect({
        message: `Scenario "${task.sourceScenarioName}" has ${steps.length} source step(s), but its chain has ${definitions.length} step(s)`,
        scenario: task.sourceScenarioName,
        step: task.sourceScenarioName,
        line: task.scenarioLine,
        candidates: Arr.map(definitions, (step) => step.expression.source),
      });
    }

    return yield* Fn.pipe(
      Arr.zip(definitions, steps),
      Arr.reduce(
        Effect.succeed<unknown>(undefined) as Effect.Effect<unknown, Bdd.RunError, R>,
        (state, [definition, step], index) =>
          Effect.flatMap(state, (previous) => runStep(task, definition, step, index, previous)),
      ),
    );
  });

const runStep: <E, R>(
  task: ScenarioTask<E, R>,
  stepDefinition: Bdd.AnyStep,
  step: PickleStep,
  index: number,
  state: unknown,
) => Effect.Effect<unknown, Bdd.RunError, R> = Effect.fnUntraced(function* <E, R>(
  task: ScenarioTask<E, R>,
  stepDefinition: Bdd.AnyStep,
  step: PickleStep,
  index: number,
  state: unknown,
) {
  const kind = yield* stepKind(step, task.source);
  const captures = yield* verifyStep(task, stepDefinition, step, kind, index);
  const argument = yield* decodeArgument(
    stepDefinition,
    task.sourceScenarioName,
    step,
    task.source,
  );
  return yield* Fn.pipe(
    stepDefinition.run(captures, argument, state),
    Effect.mapError(
      (cause) =>
        new StepError({
          message: `Step failed: ${step.text}`,
          scenario: task.sourceScenarioName,
          step: step.text,
          line: Parser.stepLine(step, task.source),
          cause,
        }),
    ),
  );
});

const verifyStep = (
  task: ScenarioTask<unknown, unknown>,
  stepDefinition: Bdd.AnyStep,
  step: PickleStep,
  kind: ConcreteStepKind,
  index: number,
): Effect.Effect<unknown, MatchError> => {
  const keywordMatches = stepDefinition.kind === "Step" || stepDefinition.kind === kind;
  if (!keywordMatches) {
    return failStep(
      `Step ${index + 1} keyword mismatch: source is ${kind}, chain expects ${stepDefinition.kind}`,
      task.sourceScenarioName,
      step,
      task.source,
      [stepDefinition.expression.source],
    );
  }
  return Fn.pipe(
    stepDefinition.expression.match(step.text),
    Option.match({
      onNone: () =>
        failStep(
          `Step ${index + 1} text mismatch: source says "${step.text}", chain expects "${stepDefinition.expression.source}"`,
          task.sourceScenarioName,
          step,
          task.source,
          [stepDefinition.expression.source],
        ),
      onSome: Effect.succeed,
    }),
  );
};

const decodeArgument = (
  stepDefinition: Bdd.AnyStep,
  scenario: string,
  step: PickleStep,
  source: Parser.SourceIndex,
): Effect.Effect<unknown, MatchError> => {
  const candidates = [stepDefinition.expression.source];
  if (stepDefinition.argument === undefined) {
    return hasStepArgument(step)
      ? failStep(
          `Step "${step.text}" has an unexpected argument`,
          scenario,
          step,
          source,
          candidates,
        )
      : Effect.succeed(undefined);
  }

  if (stepDefinition.argument._tag === "TableArg") {
    return step.argument?.dataTable === undefined
      ? failStep(`Step "${step.text}" requires a DataTable`, scenario, step, source, candidates)
      : Fn.pipe(
          stepDefinition.argument.decode(step.argument.dataTable),
          Effect.mapError((cause) =>
            matchError(
              `Could not decode DataTable for step "${step.text}"`,
              scenario,
              step,
              source,
              candidates,
              cause,
            ),
          ),
        );
  }

  return step.argument?.docString === undefined
    ? failStep(`Step "${step.text}" requires a DocString`, scenario, step, source, candidates)
    : Fn.pipe(
        stepDefinition.argument.decode(step.argument.docString),
        Effect.mapError((cause) =>
          matchError(
            `Could not decode DocString for step "${step.text}"`,
            scenario,
            step,
            source,
            candidates,
            cause,
          ),
        ),
      );
};

const validateFeatureDefinition = <E, R>(
  featureDefinition: Bdd.Feature<E, R>,
  feature: Parser.CompiledFeature,
): Effect.Effect<void, MatchError> =>
  featureDefinition.name === feature.name
    ? Effect.void
    : matchErrorEffect({
        message: `Feature definition "${featureDefinition.name}" does not match Gherkin feature "${feature.name}"`,
        scenario: "",
        step: feature.name,
        line: feature.line,
        candidates: [featureDefinition.name],
      });

/** @internal */
export const firstDuplicateName = (names: ReadonlyArray<string>): Option.Option<string> =>
  Fn.pipe(
    names,
    Arr.findFirst((name, index) => Arr.contains(name)(Arr.take(names, index))),
  );

const validateUniqueScenarioDefinitions = <E, R>(featureDefinition: Bdd.Feature<E, R>) =>
  Fn.pipe(
    Arr.map(featureDefinition.scenarios, (scenario) => scenario.name),
    firstDuplicateName,
    Option.match({
      onNone: () => Effect.void,
      onSome: (name) =>
        matchErrorEffect({
          message: `Duplicate scenario chain name: ${name}`,
          scenario: name,
          step: name,
          line: 1,
          candidates: [name],
        }),
    }),
  );

const scenarioDefinitionMap = <E, R>(
  featureDefinition: Bdd.Feature<E, R>,
): ReadonlyMap<string, Bdd.Scenario<any, any, any>> =>
  new Map(Arr.map(featureDefinition.scenarios, (scenario) => [scenario.name, scenario] as const));

/** @internal */
export const concreteStepKind = (step: PickleStep): Option.Option<ConcreteStepKind> => {
  switch (step.type) {
    case PickleStepType.CONTEXT: {
      return Option.some("Given");
    }
    case PickleStepType.ACTION: {
      return Option.some("When");
    }
    case PickleStepType.OUTCOME: {
      return Option.some("Then");
    }
    default: {
      return Option.none();
    }
  }
};

const rowObject = (
  headers: ReadonlyArray<string>,
  cells: ReadonlyArray<string>,
): Record<string, string> =>
  Fn.pipe(
    headers,
    Arr.map((header, index) => [header, cells[index] ?? ""] as const),
    Record.fromEntries,
  );

const hasStepArgument = (step: PickleStep): boolean => step.argument !== undefined;

const stepKind = (
  step: PickleStep,
  source: Parser.SourceIndex,
): Effect.Effect<ConcreteStepKind, ParseError> =>
  Fn.pipe(
    concreteStepKind(step),
    Option.match({
      onNone: () =>
        Effect.fail(
          new ParseError({
            message: `${Parser.stepKeyword(step, source)} found before a Given, When, or Then step`,
            line: Parser.stepLine(step, source),
            column: 1,
          }),
        ),
      onSome: Effect.succeed,
    }),
  );

const failStep = (
  message: string,
  scenario: string,
  step: PickleStep,
  source: Parser.SourceIndex,
  candidates: ReadonlyArray<string>,
  cause?: unknown,
): Effect.Effect<never, MatchError> =>
  Effect.fail(matchError(message, scenario, step, source, candidates, cause));

const matchError = (
  message: string,
  scenario: string,
  step: PickleStep,
  source: Parser.SourceIndex,
  candidates: ReadonlyArray<string>,
  cause?: unknown,
): MatchError =>
  new MatchError({
    message,
    scenario,
    step: step.text,
    line: Parser.stepLine(step, source),
    candidates,
    ...(cause === undefined ? {} : { cause }),
  });

const matchErrorEffect = (options: {
  readonly message: string;
  readonly scenario: string;
  readonly step: string;
  readonly line: number;
  readonly candidates: ReadonlyArray<string>;
  readonly cause?: unknown;
}): Effect.Effect<never, MatchError> => Effect.fail(new MatchError(options));
