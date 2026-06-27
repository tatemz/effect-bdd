import type { Pickle, PickleStep } from "@cucumber/messages";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import * as Fn from "effect/Function";
import type * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import {
  MatchError,
  ParseError,
  ScenarioSetupError,
  ScenarioTeardownError,
  StepError,
  StepTimeoutError,
} from "../Errors.ts";
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

type RunError = ParseError | MatchError | ScenarioSetupError | StepError | ScenarioTeardownError;

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
  readonly timeout?: Duration.Duration;
  readonly run: (
    captures: unknown,
    argument: unknown,
    state: unknown,
  ) => Effect.Effect<unknown, unknown, R>;
}

interface ScenarioDefinition<R = unknown> {
  readonly title: string;
  readonly steps: ReadonlyArray<AnyStep<R>>;
  readonly providers: ReadonlyArray<Layer.Layer<unknown, unknown, R>>;
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
  readonly stepTimeout?: Duration.Duration;
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
export const decodeTable = <S extends Schema.ConstraintDecoder<unknown, never>>(row: S) => {
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
export const decodeDocString = <S extends Schema.ConstraintDecoder<unknown, never>>(schema: S) => {
  const decode = Schema.decodeUnknownEffect(schema);
  return (docString: DocStringInput): Effect.Effect<S["Type"], unknown> =>
    decode(docString.content);
};

/** @internal */
export const run = <E, R>(
  featureDefinition: FeatureDefinition<E, R>,
  source: string,
  options: RunOptions = {},
): Effect.Effect<Report, RunError, Exclude<R, Scope.Scope> | Parser.GherkinCompiler> =>
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
        const scenarioDefinition = Record.get(scenarioDefinitions, entry.scenarioTitle);
        if (Option.isNone(scenarioDefinition)) {
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
          scenarioDefinition: scenarioDefinition.value,
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
): Effect.Effect<ScenarioReport, RunError, Exclude<R, Scope.Scope>> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const program = Fn.pipe(
      runSteps(task, options),
      provideScenarioProviders(task),
      Effect.mapError((error) => (isRunError(error) ? error : scenarioSetupError(task, error))),
      Scope.provide(scope),
    );
    const stepExit = yield* Effect.exit(program);
    const closeExit = yield* Effect.exit(closeScenarioScope(task, scope, stepExit, options));
    if (closeExit._tag === "Failure") {
      return yield* Effect.fail(scenarioTeardownErrorFromCause(task, closeExit.cause));
    }
    yield* stepExit;
    return {
      title: task.scenarioTitle,
      steps: task.pickle.steps.length,
      tags: task.tags,
    };
  });

const provideScenarioProviders =
  <R>(task: ScenarioTask<unknown, R>) =>
  <A, E>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | unknown, R> => {
    const initial: Effect.Effect<A, E | unknown, R> = effect;
    return Arr.reduce(task.scenarioDefinition.providers, initial, (current, provider) =>
      Effect.provide(current, provider),
    );
  };

const closeScenarioScope = <A, E>(
  _task: ScenarioTask<unknown, unknown>,
  scope: Scope.Closeable,
  exit: Exit.Exit<A, E>,
  _options: RunOptions,
): Effect.Effect<void, ScenarioTeardownError> => Scope.close(scope, exit);

const isRunError = (u: unknown): u is RunError => isDiscoveryRunError(u) || isExecutionRunError(u);

const isDiscoveryRunError = (u: unknown): u is ParseError | MatchError | ScenarioSetupError =>
  u instanceof ParseError || u instanceof MatchError || u instanceof ScenarioSetupError;

const isExecutionRunError = (u: unknown): u is StepError | ScenarioTeardownError =>
  u instanceof StepError || u instanceof ScenarioTeardownError;

const scenarioSetupError = (
  task: ScenarioTask<unknown, unknown>,
  cause: unknown,
): ScenarioSetupError =>
  new ScenarioSetupError({
    message: `Scenario setup failed: ${task.sourceScenarioTitle}`,
    scenario: task.sourceScenarioTitle,
    line: task.scenarioLine,
    cause,
  });

const scenarioTeardownErrorFromCause = (
  task: ScenarioTask<unknown, unknown>,
  cause: Cause.Cause<ScenarioTeardownError>,
): ScenarioTeardownError =>
  Fn.pipe(
    Cause.findErrorOption(cause),
    Option.filter(
      (error): error is ScenarioTeardownError => error instanceof ScenarioTeardownError,
    ),
    Option.getOrElse(
      () =>
        new ScenarioTeardownError({
          message: `Scenario teardown failed: ${task.sourceScenarioTitle}`,
          scenario: task.sourceScenarioTitle,
          line: task.scenarioLine,
          cause,
        }),
    ),
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

  const initialState: Effect.Effect<unknown, RunError, R> = Effect.succeed(undefined);
  return yield* Fn.pipe(
    Arr.zip(definitions, steps),
    Arr.reduce(initialState, (state, [definition, step], index) =>
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
  const timeout = stepDefinition.timeout ?? options.stepTimeout;
  if (timeout === undefined) {
    return yield* stepEffect;
  }
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
  const argument = stepDefinition.argument;
  return argument === undefined
    ? decodeNoArgument(scenario, step, source, candidates)
    : decodeExpectedArgument(argument, scenario, step, source, candidates);
};

const decodeNoArgument = (
  scenario: string,
  step: PickleStep,
  source: Parser.SourceIndex,
  candidates: ReadonlyArray<string>,
): Effect.Effect<unknown, MatchError> =>
  hasStepArgument(step)
    ? failStep(`Step "${step.text}" has an unexpected argument`, scenario, step, source, candidates)
    : Effect.succeed(undefined);

const decodeExpectedArgument = (
  argument: StepArg<unknown>,
  scenario: string,
  step: PickleStep,
  source: Parser.SourceIndex,
  candidates: ReadonlyArray<string>,
): Effect.Effect<unknown, MatchError> =>
  argument._tag === "TableArg"
    ? decodeTableArgument(argument, scenario, step, source, candidates)
    : decodeDocStringArgument(argument, scenario, step, source, candidates);

const decodeTableArgument = (
  argument: TableArg<unknown>,
  scenario: string,
  step: PickleStep,
  source: Parser.SourceIndex,
  candidates: ReadonlyArray<string>,
): Effect.Effect<unknown, MatchError> =>
  step.argument?.dataTable === undefined
    ? failStep(`Step "${step.text}" requires a DataTable`, scenario, step, source, candidates)
    : mapArgumentDecodeError(
        argument.decode(step.argument.dataTable),
        `Could not decode DataTable for step "${step.text}"`,
        scenario,
        step,
        source,
        candidates,
      );

const decodeDocStringArgument = (
  argument: DocStringArg<unknown>,
  scenario: string,
  step: PickleStep,
  source: Parser.SourceIndex,
  candidates: ReadonlyArray<string>,
): Effect.Effect<unknown, MatchError> =>
  step.argument?.docString === undefined
    ? failStep(`Step "${step.text}" requires a DocString`, scenario, step, source, candidates)
    : mapArgumentDecodeError(
        argument.decode(step.argument.docString),
        `Could not decode DocString for step "${step.text}"`,
        scenario,
        step,
        source,
        candidates,
      );

const mapArgumentDecodeError = (
  effect: Effect.Effect<unknown, unknown>,
  message: string,
  scenario: string,
  step: PickleStep,
  source: Parser.SourceIndex,
  candidates: ReadonlyArray<string>,
): Effect.Effect<unknown, MatchError> =>
  Fn.pipe(
    effect,
    Effect.mapError((cause) => matchError(message, scenario, step, source, candidates, cause)),
  );

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
export const firstDuplicateTitle = (titles: ReadonlyArray<string>): Option.Option<string> =>
  Fn.pipe(
    titles,
    Arr.findFirst((title, index) => Arr.contains(title)(Arr.take(titles, index))),
  );

const validateUniqueScenarioDefinitions = <E, R>(featureDefinition: FeatureDefinition<E, R>) =>
  Fn.pipe(
    Arr.map(featureDefinition.scenarios, (scenario) => scenario.title),
    firstDuplicateTitle,
    Option.match({
      onNone: () => Effect.void,
      onSome: (title) =>
        matchErrorEffect({
          message: `Duplicate scenario chain title: ${title}`,
          scenario: title,
          step: title,
          line: 1,
          candidates: [title],
        }),
    }),
  );

const scenarioDefinitionMap = <E, R>(
  featureDefinition: FeatureDefinition<E, R>,
): Record.ReadonlyRecord<string, ScenarioDefinition<R>> =>
  Fn.pipe(
    featureDefinition.scenarios,
    Arr.map((scenario) => [scenario.title, scenario] as const),
    Record.fromEntries,
  );

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
