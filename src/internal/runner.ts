import type { Pickle, PickleStep } from "@cucumber/messages";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fn from "effect/Function";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import * as Schema from "effect/Schema";
import { MatchError, ParseError, StepError, StepTimeoutError } from "../Errors.ts";
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
type ConcreteStepKind = "Given" | "When" | "Then";

type RunError = ParseError | MatchError | StepError;

interface Expression<A> {
  readonly source: string;
  readonly match: (text: string) => Option.Option<A>;
}

interface TableArg<A> {
  readonly _tag: "TableArg";
  readonly decode: (table: DataTableInput) => Effect.Effect<A, unknown>;
}

interface DocStringArg<A> {
  readonly _tag: "DocStringArg";
  readonly decode: (docString: DocStringInput) => Effect.Effect<A, unknown>;
}

type StepArg<A> = TableArg<A> | DocStringArg<A>;

interface AnyStep<R = unknown> {
  readonly kind: "Step" | ConcreteStepKind;
  readonly expression: Expression<unknown>;
  readonly argument?: StepArg<unknown>;
  readonly timeout?: Duration.Input;
  readonly run: (
    captures: unknown,
    argument: unknown,
    state: unknown,
  ) => Effect.Effect<unknown, unknown, R>;
}

interface ScenarioDefinition<R = unknown> {
  readonly title: string;
  readonly steps: ReadonlyArray<AnyStep<R>>;
}

interface FeatureDefinition<E, R> {
  readonly title: string;
  readonly scenarios: ReadonlyArray<ScenarioDefinition<R>>;
  readonly _E?: E;
  readonly _R?: R;
}

interface Report {
  readonly feature: string;
  readonly scenarios: ReadonlyArray<ScenarioReport>;
}

/** @internal */
export interface RunOptions {
  readonly stepTimeout?: Duration.Input;
}

/** @internal */
export interface ScenarioTask<E, R> {
  readonly featureDefinition: FeatureDefinition<E, R>;
  readonly scenarioDefinition: ScenarioDefinition<R>;
  readonly featureTitle: string;
  readonly scenarioTitle: string;
  readonly sourceScenarioTitle: string;
  readonly scenarioIndex: number;
  readonly scenarioLine: number;
  readonly ruleTitle?: string;
  readonly ruleLine?: number;
  readonly tags: ReadonlyArray<string>;
  readonly pickle: Pickle;
  readonly source: Parser.SourceIndex;
}

/** @internal */
export interface ScenarioReport {
  readonly title: string;
  readonly steps: number;
  readonly tags: ReadonlyArray<string>;
}

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
  featureDefinition: FeatureDefinition<E, R>,
  source: string,
  options: RunOptions = {},
): Effect.Effect<Report, RunError, R | Parser.GherkinCompiler> =>
  Fn.pipe(
    Parser.parse(source),
    Effect.flatMap((feature) =>
      Fn.pipe(
        buildScenarioTasks(featureDefinition, feature),
        Effect.flatMap((tasks) => Effect.forEach(tasks, (task) => runScenarioTask(task, options))),
        Effect.map(
          (scenarios): Report => ({
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
  readonly scenarioTitle: string;
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
      scenarioTitle: Fn.pipe(
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
        previous.scenarioTitle === entry.scenarioTitle &&
        previous.sourceScenarioId !== entry.sourceScenarioId,
    ),
  );

/** @internal */
const buildScenarioTasks = <E, R>(
  featureDefinition: FeatureDefinition<E, R>,
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
            message: `Duplicate scenario title in Gherkin feature: ${entry.scenarioTitle}`,
            scenario: entry.scenarioTitle,
            step: entry.scenarioTitle,
            line: entry.scenarioLine,
            candidates: [entry.scenarioTitle],
          });
        }
        const scenarioDefinition = scenarioDefinitions.get(entry.scenarioTitle);
        if (scenarioDefinition === undefined) {
          return matchErrorEffect({
            message: `No scenario chain matched source scenario "${entry.scenarioTitle}"`,
            scenario: entry.scenarioTitle,
            step: entry.scenarioTitle,
            line: entry.scenarioLine,
            candidates: Arr.map(featureDefinition.scenarios, (scenario) => scenario.title),
          });
        }
        return Effect.succeed({
          featureDefinition,
          scenarioDefinition,
          featureTitle: feature.name,
          scenarioTitle: entry.pickle.name,
          sourceScenarioTitle: entry.scenarioTitle,
          scenarioIndex: entry.scenarioIndex,
          scenarioLine: entry.scenarioLine,
          ...(entry.rule === undefined
            ? {}
            : {
                ruleTitle: entry.rule.name,
                ruleLine: entry.rule.location.line,
              }),
          tags: Arr.map(entry.pickle.tags, (tag) => tag.name),
          pickle: entry.pickle,
          source: feature.source,
        });
      },
    );

    const usedScenarioTitles = Arr.map(resolved, (entry) => entry.scenarioTitle);
    const unused = Arr.filter(
      featureDefinition.scenarios,
      (scenario) => !Arr.contains(scenario.title)(usedScenarioTitles),
    );
    return yield* Fn.pipe(
      Arr.head(unused),
      Option.match({
        onNone: () => Effect.succeed(tasks),
        onSome: (scenario) =>
          matchErrorEffect({
            message: `Scenario chain has no matching source scenario: ${scenario.title}`,
            scenario: scenario.title,
            step: scenario.title,
            line: feature.line,
            candidates: Arr.map(resolved, (entry) => entry.scenarioTitle),
          }),
      }),
    );
  });

/** @internal */
export const runScenarioTask = <E, R>(
  task: ScenarioTask<E, R>,
  options: RunOptions = {},
): Effect.Effect<ScenarioReport, RunError, R> =>
  Fn.pipe(
    runSteps(task, options),
    Effect.as({
      title: task.scenarioTitle,
      steps: task.pickle.steps.length,
      tags: task.tags,
    }),
  );

const runSteps: <E, R>(
  task: ScenarioTask<E, R>,
  options: RunOptions,
) => Effect.Effect<unknown, RunError, R> = Effect.fnUntraced(function* <E, R>(
  task: ScenarioTask<E, R>,
  options: RunOptions,
) {
  const steps = task.pickle.steps;
  const definitions = task.scenarioDefinition.steps;
  if (steps.length !== definitions.length) {
    return yield* matchErrorEffect({
      message: `Scenario "${task.sourceScenarioTitle}" has ${steps.length} source step(s), but its chain has ${definitions.length} step(s)`,
      scenario: task.sourceScenarioTitle,
      step: task.sourceScenarioTitle,
      line: task.scenarioLine,
      candidates: Arr.map(definitions, (step) => step.expression.source),
    });
  }

  return yield* Fn.pipe(
    Arr.zip(definitions, steps),
    Arr.reduce(
      Effect.succeed<unknown>(undefined) as Effect.Effect<unknown, RunError, R>,
      (state, [definition, step], index) =>
        Effect.flatMap(state, (previous) =>
          runStep(task, definition, step, index, previous, options),
        ),
    ),
  );
});

const runStep: <E, R>(
  task: ScenarioTask<E, R>,
  stepDefinition: AnyStep<R>,
  step: PickleStep,
  index: number,
  state: unknown,
  options: RunOptions,
) => Effect.Effect<unknown, RunError, R> = Effect.fnUntraced(function* <E, R>(
  task: ScenarioTask<E, R>,
  stepDefinition: AnyStep<R>,
  step: PickleStep,
  index: number,
  state: unknown,
  options: RunOptions,
) {
  const kind = yield* stepKind(step, task.source);
  const captures = yield* verifyStep(task, stepDefinition, step, kind, index);
  const argument = yield* decodeArgument(
    stepDefinition,
    task.sourceScenarioTitle,
    step,
    task.source,
  );
  const line = Parser.stepLine(step, task.source);
  const stepEffect = Fn.pipe(
    stepDefinition.run(captures, argument, state),
    Effect.mapError(
      (cause) =>
        new StepError({
          message: `Step failed: ${step.text}`,
          scenario: task.sourceScenarioTitle,
          step: step.text,
          line,
          cause,
        }),
    ),
  );
  const timeoutInput = stepDefinition.timeout ?? options.stepTimeout;
  if (timeoutInput === undefined) {
    return yield* stepEffect;
  }
  const timeout = Duration.fromInputUnsafe(timeoutInput);
  return yield* Fn.pipe(
    stepEffect,
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () =>
        Effect.fail(
          new StepError({
            message: `Step timed out after ${formatDuration(timeout)}: ${step.text}`,
            scenario: task.sourceScenarioTitle,
            step: step.text,
            line,
            cause: new StepTimeoutError({
              message: `Timed out after ${formatDuration(timeout)}`,
              timeout,
            }),
          }),
        ),
    }),
  );
});

const formatDuration = (duration: Duration.Duration): string => Duration.format(duration);

const verifyStep = (
  task: ScenarioTask<unknown, unknown>,
  stepDefinition: AnyStep,
  step: PickleStep,
  kind: ConcreteStepKind,
  index: number,
): Effect.Effect<unknown, MatchError> => {
  const keywordMatches = stepDefinition.kind === "Step" || stepDefinition.kind === kind;
  if (!keywordMatches) {
    return failStep(
      `Step ${index + 1} keyword mismatch: source is ${kind}, chain expects ${stepDefinition.kind}`,
      task.sourceScenarioTitle,
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
          task.sourceScenarioTitle,
          step,
          task.source,
          [stepDefinition.expression.source],
        ),
      onSome: Effect.succeed,
    }),
  );
};

const decodeArgument = (
  stepDefinition: AnyStep,
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
  featureDefinition: FeatureDefinition<E, R>,
  feature: Parser.CompiledFeature,
): Effect.Effect<void, MatchError> =>
  featureDefinition.title === feature.name
    ? Effect.void
    : matchErrorEffect({
        message: `Feature definition "${featureDefinition.title}" does not match Gherkin feature "${feature.name}"`,
        scenario: "",
        step: feature.name,
        line: feature.line,
        candidates: [featureDefinition.title],
      });

/** @internal */
export const firstDuplicateName = (names: ReadonlyArray<string>): Option.Option<string> =>
  Fn.pipe(
    names,
    Arr.findFirst((name, index) => Arr.contains(name)(Arr.take(names, index))),
  );

const validateUniqueScenarioDefinitions = <E, R>(featureDefinition: FeatureDefinition<E, R>) =>
  Fn.pipe(
    Arr.map(featureDefinition.scenarios, (scenario) => scenario.title),
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
  featureDefinition: FeatureDefinition<E, R>,
): ReadonlyMap<string, ScenarioDefinition<R>> =>
  new Map(Arr.map(featureDefinition.scenarios, (scenario) => [scenario.title, scenario] as const));

/** @internal */
const concreteStepKind = (step: PickleStep): Option.Option<ConcreteStepKind> => {
  switch (step.type) {
    case "Context": {
      return Option.some("Given");
    }
    case "Action": {
      return Option.some("When");
    }
    case "Outcome": {
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
