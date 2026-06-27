import type { PickleStep } from "@cucumber/messages";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import * as Fn from "effect/Function";
import * as Layer from "effect/Layer";
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
import * as Discovery from "./discovery.ts";
import * as Parser from "./parser.ts";

/** @internal */
export type DataTableInput = Discovery.DataTableInput;

/** @internal */
export type DocStringInput = Discovery.DocStringInput;

/** @internal */
type ConcreteStepKind = Discovery.ConcreteStepKind;

type RunError = ParseError | MatchError | ScenarioSetupError | StepError | ScenarioTeardownError;

type TableArg<A> = Discovery.TableArg<A>;
type DocStringArg<A> = Discovery.DocStringArg<A>;
type StepArg<A> = Discovery.StepArg<A>;
type AnyStep<R = unknown> = Discovery.AnyStep<R>;
type FeatureDefinition<E, R> = Discovery.FeatureDefinition<E, R>;

interface Report {
  readonly feature: string;
  readonly scenarios: ReadonlyArray<ScenarioReport>;
}

/** @internal */
export interface RunOptions {
  readonly stepTimeout?: Duration.Duration;
}

/** @internal */
export type ScenarioTask<E, R> = Discovery.ScenarioTask<E, R>;

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
const buildScenarioTasks = <E, R>(
  featureDefinition: FeatureDefinition<E, R>,
  feature: Parser.CompiledFeature,
): Effect.Effect<ReadonlyArray<ScenarioTask<E, R>>, MatchError> =>
  Fn.pipe(Discovery.buildScenarioTasks(featureDefinition, feature), (result) =>
    Fn.pipe(
      Arr.head(result.issues),
      Option.match({
        onNone: () => Effect.succeed(result.tasks),
        onSome: (issue) => matchErrorFromDiscoveryIssue(issue, feature),
      }),
    ),
  );

/** @internal */
export const runScenarioTask = <E, R>(
  task: ScenarioTask<E, R>,
  options: RunOptions = {},
): Effect.Effect<ScenarioReport, RunError, Exclude<R, Scope.Scope>> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Fn.pipe(
      buildScenarioProviders(task, scope),
      Scope.provide(scope),
      Effect.mapError((error) => scenarioSetupError(task, error)),
    );
    const program = Fn.pipe(
      runSteps(task, options),
      provideScenarioContext(context),
      Effect.mapError((error) => (isRunError(error) ? error : scenarioSetupError(task, error))),
      Scope.provide(scope),
    );
    const stepExit = yield* Effect.exit(program);
    const closeExit = yield* Effect.exit(closeScenarioScope(task, scope, stepExit, options));
    if (closeExit._tag === "Failure") {
      return yield* Effect.fail(scenarioTeardownErrorFromCause(task, stepExit, closeExit.cause));
    }
    yield* stepExit;
    return {
      title: task.scenarioTitle,
      steps: task.pickle.steps.length,
      tags: task.tags,
    };
  });

const buildScenarioProviders = <R>(
  task: ScenarioTask<unknown, R>,
  scope: Scope.Scope,
): Effect.Effect<Option.Option<Context.Context<unknown>>, unknown, R> =>
  Arr.matchLeft(task.scenarioDefinition.providers, {
    onEmpty: () => Effect.succeed(Option.none()),
    onNonEmpty: (first, rest) =>
      Fn.pipe(
        Layer.buildWithScope(first, scope),
        Effect.flatMap((context) => {
          const initial: Effect.Effect<Context.Context<unknown>, unknown, R> = Effect.succeed(
            context,
          );
          return Arr.reduce(rest, initial, (current, provider) =>
            Effect.flatMap(current, (context) =>
              Effect.map(Layer.buildWithScope(provider, scope), (provided) =>
                Context.merge(context, provided),
              ),
            ),
          );
        }),
        Effect.map(Option.some),
      ),
  });

const provideScenarioContext =
  (context: Option.Option<Context.Context<unknown>>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Option.isSome(context) ? Effect.provide(effect, context.value) : effect;

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
  stepExit: Exit.Exit<unknown, unknown>,
  cause: Cause.Cause<ScenarioTeardownError>,
): ScenarioTeardownError =>
  Fn.pipe(combineStepAndTeardownCause(stepExit, cause), (cause) =>
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
    ),
  );

const combineStepAndTeardownCause = (
  stepExit: Exit.Exit<unknown, unknown>,
  teardownCause: Cause.Cause<ScenarioTeardownError>,
): Cause.Cause<unknown> =>
  stepExit._tag === "Failure" ? Cause.combine(stepExit.cause, teardownCause) : teardownCause;

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
  if (stepDefinition.expression.matchDetailed !== undefined) {
    return verifyStepMatchResult(
      task,
      stepDefinition.expression.matchDetailed(step.text),
      stepDefinition.expression.source,
      step,
      index,
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

const verifyStepMatchResult = (
  task: ScenarioTask<unknown, unknown>,
  result: Discovery.MatchResult<unknown>,
  expressionSource: string,
  step: PickleStep,
  index: number,
): Effect.Effect<unknown, MatchError> => {
  switch (result._tag) {
    case "Matched": {
      return Effect.succeed(result.value);
    }
    case "TextMismatch": {
      return failStep(
        `Step ${index + 1} text mismatch: source says "${step.text}", chain expects "${expressionSource}"`,
        task.sourceScenarioTitle,
        step,
        task.source,
        [expressionSource],
      );
    }
    case "DecodeMismatch": {
      return failStep(
        `Could not decode capture "${result.capture}" from "${result.raw}" for step "${step.text}"`,
        task.sourceScenarioTitle,
        step,
        task.source,
        [expressionSource],
        result.cause,
      );
    }
  }
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

// oxlint-disable-next-line complexity
const matchErrorFromDiscoveryIssue = (
  issue: Discovery.DiscoveryIssue,
  feature: Parser.CompiledFeature,
): Effect.Effect<never, MatchError> => {
  switch (issue._tag) {
    case "FeatureTitleMismatch": {
      return matchErrorEffect({
        message: `Feature definition "${issue.definitionTitle}" does not match Gherkin feature "${issue.featureTitle}"`,
        scenario: "",
        step: issue.featureTitle,
        line: issue.line,
        candidates: [issue.definitionTitle],
      });
    }
    case "DuplicateScenarioDefinition": {
      return matchErrorEffect({
        message: `Duplicate scenario chain title: ${issue.scenarioTitle}`,
        scenario: issue.scenarioTitle,
        step: issue.scenarioTitle,
        line: 1,
        candidates: [issue.scenarioTitle],
      });
    }
    case "DuplicateSourceScenario": {
      return matchErrorEffect({
        message: `Duplicate scenario title in Gherkin feature: ${issue.scenarioTitle}`,
        scenario: issue.scenarioTitle,
        step: issue.scenarioTitle,
        line: issue.scenarioLine,
        candidates: [issue.scenarioTitle],
      });
    }
    case "UnmatchedScenario": {
      return matchErrorEffect({
        message: `No scenario chain matched source scenario "${issue.scenarioTitle}"`,
        scenario: issue.scenarioTitle,
        step: issue.scenarioTitle,
        line: issue.scenarioLine,
        candidates: issue.candidates,
      });
    }
    case "UnusedScenarioDefinition": {
      return matchErrorEffect({
        message: `Scenario chain has no matching source scenario: ${issue.scenarioTitle}`,
        scenario: issue.scenarioTitle,
        step: issue.scenarioTitle,
        line: feature.line,
        candidates: issue.candidates,
      });
    }
  }
};

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
