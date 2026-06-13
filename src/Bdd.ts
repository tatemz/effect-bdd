/**
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import type * as Duration from "effect/Duration";
import type * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import type * as Option from "effect/Option";
import type { Pipeable } from "effect/Pipeable";
import * as PipeableRuntime from "effect/Pipeable";
import * as Predicate from "effect/Predicate";
import type * as Schema from "effect/Schema";
import { MatchError, ParseError, StepError, StepTimeoutError } from "./Errors.ts";
import * as cucumberCompiler from "./internal/cucumberCompiler.ts";
import * as expression from "./internal/expression.ts";
import * as parser from "./internal/parser.ts";
import * as runner from "./internal/runner.ts";

const FeatureTypeId = "~effect-bdd/Bdd/Feature";
const ScenarioTypeId = "~effect-bdd/Bdd/Scenario";
const StepTypeId = "~effect-bdd/Bdd/Step";

/**
 * Error type returned by `Bdd.run`.
 *
 * @category errors
 * @since 0.1.0
 */
export type RunError = ParseError | MatchError | StepError;

/**
 * Service used to compile Gherkin source into executable scenarios.
 *
 * @category services
 * @since 0.1.0
 */
export const GherkinCompiler = parser.GherkinCompiler;

/**
 * Service used to compile Gherkin source into executable scenarios.
 *
 * @category services
 * @since 0.1.0
 */
export type GherkinCompiler = parser.GherkinCompiler;

/**
 * A {@link GherkinCompiler} layer backed by Cucumber's parser and Pickle
 * compiler.
 *
 * @category layers
 * @since 0.2.0
 */
export const layerCucumber: Layer.Layer<GherkinCompiler> = cucumberCompiler.layerCucumber;

/**
 * Gherkin step keyword metadata attached to a step definition.
 *
 * @category models
 * @since 0.1.0
 */
export type StepKind = "Step" | "Given" | "When" | "Then";

/**
 * A named capture decoded from step text with a Schema.
 *
 * @category models
 * @since 0.1.0
 */
export interface Capture<Name extends string, A> {
  readonly _tag: "Capture";
  readonly name: Name;
  readonly schema: Schema.Codec<A, string>;
}

/**
 * Maps capture definitions to their decoded handler shape.
 *
 * @category type-level
 * @since 0.1.0
 */
export type CapturesOf<Captures extends ReadonlyArray<Capture<string, any>>> = {
  readonly [C in Captures[number] as C["name"]]: C extends Capture<string, infer A> ? A : never;
};

type EmptyCaptures<Captures> = keyof Captures extends never ? true : false;

/**
 * A compiled step expression.
 *
 * @category models
 * @since 0.1.0
 */
export interface Expression<A> {
  readonly source: string;
  readonly match: (text: string) => Option.Option<A>;
}

/**
 * The cell structure of a Gherkin DataTable supplied to a {@link TableArg}
 * decoder.
 *
 * @category models
 * @since 0.2.0
 */
export interface DataTable {
  readonly rows: ReadonlyArray<{
    readonly cells: ReadonlyArray<{
      readonly value: string;
    }>;
  }>;
}

/**
 * The content of a Gherkin DocString supplied to a {@link DocStringArg}
 * decoder.
 *
 * @category models
 * @since 0.2.0
 */
export interface DocString {
  readonly content: string;
}

/**
 * A decoded DataTable argument.
 *
 * @category models
 * @since 0.1.0
 */
export interface TableArg<A> {
  readonly _tag: "TableArg";
  readonly decode: (table: DataTable) => Effect.Effect<A, unknown>;
}

/**
 * A decoded DocString argument.
 *
 * @category models
 * @since 0.1.0
 */
export interface DocStringArg<A> {
  readonly _tag: "DocStringArg";
  readonly decode: (docString: DocString) => Effect.Effect<A, unknown>;
}

/**
 * Advanced union of decoded step argument descriptors.
 *
 * @category models
 * @since 0.1.0
 */
export type StepArg<A> = TableArg<A> | DocStringArg<A>;

/**
 * A standalone step definition. A step is both executable metadata and a
 * scenario transformer.
 *
 * @category models
 * @since 0.3.0
 */
export interface Step<
  Kind extends StepKind,
  In,
  Out,
  E = never,
  R = never,
  Captures = unknown,
  Argument = undefined,
> extends Pipeable {
  <State extends In, E0, R0>(self: Scenario<State, E0, R0>): Scenario<Out, E | E0, R | R0>;
  readonly [StepTypeId]: typeof StepTypeId;
  readonly kind: Kind;
  readonly expression: Expression<Captures>;
  readonly argument?: StepArg<Argument>;
  readonly timeout?: Duration.Input;
  readonly run: (captures: Captures, argument: Argument, state: In) => Effect.Effect<Out, E, R>;
}

/**
 * Existential step type stored in scenario chains.
 *
 * @category models
 * @since 0.3.0
 */
export type AnyStep = Step<StepKind, any, any, any, any, any, any>;

/**
 * A named scenario chain. The type parameter tracks the current state after
 * the last appended step.
 *
 * @category models
 * @since 0.3.0
 */
export interface Scenario<State = void, E = never, R = never> extends Pipeable {
  <E0, R0>(self: Feature<E0, R0>): Feature<E | E0, R | R0>;
  readonly [ScenarioTypeId]: typeof ScenarioTypeId;
  readonly _State?: (_: State) => State;
  readonly name: string;
  readonly steps: ReadonlyArray<AnyStep>;
}

/**
 * A feature definition made from explicit scenario chains.
 *
 * @category models
 * @since 0.1.0
 */
export interface Feature<E = never, R = never> extends Pipeable {
  readonly [FeatureTypeId]: typeof FeatureTypeId;
  readonly _E?: E;
  readonly _R?: R;
  readonly name: string;
  readonly scenarios: ReadonlyArray<Scenario<any, any, any>>;
}

/**
 * Checks whether a value is a {@link Feature} definition.
 *
 * @category guards
 * @since 0.2.0
 */
export const isFeature = (u: unknown): u is Feature<unknown, unknown> =>
  Predicate.hasProperty(u, FeatureTypeId);

/**
 * Result returned after all scenarios pass.
 *
 * @category models
 * @since 0.1.0
 */
export interface Report {
  readonly feature: string;
  readonly scenarios: ReadonlyArray<{
    readonly name: string;
    readonly steps: number;
    readonly tags: ReadonlyArray<string>;
  }>;
}

type FeatureType<E, R> = Feature<E, R>;
type ScenarioType<State, E, R> = Scenario<State, E, R>;
type StepType<Kind extends StepKind, In, Out, E, R, Captures, Argument> = Step<
  Kind,
  In,
  Out,
  E,
  R,
  Captures,
  Argument
>;
type ReportType = Report;
type RunErrorType = RunError;
type GherkinCompilerType = GherkinCompiler;
type CaptureType<Name extends string, A> = Capture<Name, A>;
type TableArgType<A> = TableArg<A>;
type DocStringArgType<A> = DocStringArg<A>;
type DataTableType = DataTable;
type DocStringType = DocString;
type RunOptionsType = RunOptions;

/**
 * Options that control `Bdd.run` execution policy.
 *
 * @category models
 * @since 0.4.0
 */
export interface RunOptions {
  readonly stepTimeout?: Duration.Input;
}

/**
 * Creates a named capture decoded from step text.
 *
 * @category constructors
 * @since 0.1.0
 */
const capture_: <const Name extends string, A>(
  name: Name,
  schema: Schema.Codec<A, string>,
) => Capture<Name, A> = expression.makeCapture;

/**
 * Creates a DataTable decoder from a row Schema.
 *
 * @category constructors
 * @since 0.1.0
 */
const table_ = <S extends Schema.Decoder<unknown, never>>(
  row: S,
): TableArg<ReadonlyArray<S["Type"]>> => ({
  _tag: "TableArg",
  decode: runner.decodeTable(row),
});

/**
 * Creates a DocString decoder from a Schema.
 *
 * @category constructors
 * @since 0.1.0
 */
const docString_ = <S extends Schema.Decoder<unknown, never>>(
  schema: S,
): DocStringArg<S["Type"]> => ({
  _tag: "DocStringArg",
  decode: runner.decodeDocString(schema),
});

/**
 * Creates a feature definition.
 *
 * @category constructors
 * @since 0.1.0
 */
const feature_ = (name: string): Feature => makeFeature(name, []);

/**
 * Creates a scenario chain.
 *
 * @category constructors
 * @since 0.3.0
 */
const scenario_ = (name: string): Scenario<void> => makeScenario(name, []);

/**
 * Tagged-template step factory that is keyword agnostic.
 *
 * @category constructors
 * @since 0.1.0
 */
const step_: StepTag<"Step"> = makeStepTag("Step");

/**
 * Tagged-template step factory for `Given`.
 *
 * @category constructors
 * @since 0.1.0
 */
const given_: StepTag<"Given"> = makeStepTag("Given");

/**
 * Tagged-template step factory for `When`.
 *
 * @category constructors
 * @since 0.1.0
 */
const when_: StepTag<"When"> = makeStepTag("When");

/**
 * Tagged-template step factory for `Then`.
 *
 * @category constructors
 * @since 0.1.0
 */
const then_: StepTag<"Then"> = makeStepTag("Then");

/**
 * Overrides the run-level step timeout for a single step definition.
 *
 * @example
 * ```ts
 * import { Bdd } from "effect-bdd"
 * import { Duration, Effect } from "effect"
 *
 * const eventuallyConsistent = Bdd.then`the projection catches up`(() =>
 *   Effect.void
 * ).pipe(Bdd.withTimeout(Duration.seconds(30)))
 * ```
 *
 * @category combinators
 * @since 0.4.0
 */
const withTimeout_ =
  (timeout: Duration.Input) =>
  <Kind extends StepKind, In, Out, E, R, Captures, Argument>(
    self: Step<Kind, In, Out, E, R, Captures, Argument>,
  ): Step<Kind, In, Out, E, R, Captures, Argument> =>
    makeStep({
      kind: self.kind,
      expression: self.expression,
      ...(self.argument === undefined ? {} : { argument: self.argument }),
      timeout,
      run: self.run,
    });

/**
 * Runs Gherkin source against a feature definition.
 *
 * @category execution
 * @since 0.1.0
 */
const run_ = <E, R>(
  self: Feature<E, R>,
  source: string,
  options: RunOptions = {},
): Effect.Effect<Report, RunError, R | GherkinCompiler> => runner.run(self, source, options);

/**
 * Namespace-style API for building and running BDD feature definitions.
 *
 * @category namespaces
 * @since 0.1.0
 */
export const Bdd = {
  ParseError,
  MatchError,
  StepError,
  StepTimeoutError,
  GherkinCompiler,
  layerCucumber,
  isFeature,
  capture: capture_,
  table: table_,
  docString: docString_,
  feature: feature_,
  scenario: scenario_,
  step: step_,
  given: given_,
  when: when_,
  // oxlint-disable-next-line unicorn/no-thenable
  then: then_,
  withTimeout: withTimeout_,
  run: run_,
};

/**
 * Type helpers for the {@link Bdd} value namespace.
 *
 * @since 0.1.0
 */
export declare namespace Bdd {
  /**
   * A feature definition made from explicit scenario chains.
   *
   * @category models
   * @since 0.1.0
   */
  export type Feature<E = never, R = never> = FeatureType<E, R>;

  /**
   * A named scenario chain.
   *
   * @category models
   * @since 0.3.0
   */
  export type Scenario<State = void, E = never, R = never> = ScenarioType<State, E, R>;

  /**
   * A standalone step definition.
   *
   * @category models
   * @since 0.3.0
   */
  export type Step<
    Kind extends StepKind,
    In,
    Out,
    E = never,
    R = never,
    Captures = unknown,
    Argument = undefined,
  > = StepType<Kind, In, Out, E, R, Captures, Argument>;

  /**
   * Result returned after all scenarios pass.
   *
   * @category models
   * @since 0.1.0
   */
  export type Report = ReportType;

  /**
   * Error type returned by `Bdd.run`.
   *
   * @category errors
   * @since 0.1.0
   */
  export type RunError = RunErrorType;

  /**
   * Options that control `Bdd.run` execution policy.
   *
   * @category models
   * @since 0.4.0
   */
  export type RunOptions = RunOptionsType;

  /**
   * Service used to compile Gherkin source into executable scenarios.
   *
   * @category services
   * @since 0.1.0
   */
  export type GherkinCompiler = GherkinCompilerType;

  /**
   * A named capture decoded from step text with a Schema.
   *
   * @category models
   * @since 0.1.0
   */
  export type Capture<Name extends string, A> = CaptureType<Name, A>;

  /**
   * A decoded DataTable argument.
   *
   * @category models
   * @since 0.1.0
   */
  export type TableArg<A> = TableArgType<A>;

  /**
   * A decoded DocString argument.
   *
   * @category models
   * @since 0.1.0
   */
  export type DocStringArg<A> = DocStringArgType<A>;

  /**
   * The cell structure of a Gherkin DataTable supplied to a TableArg decoder.
   *
   * @category models
   * @since 0.2.0
   */
  export type DataTable = DataTableType;

  /**
   * The content of a Gherkin DocString supplied to a DocStringArg decoder.
   *
   * @category models
   * @since 0.2.0
   */
  export type DocString = DocStringType;
}

/**
 * Tagged-template function type used to create steps.
 *
 * @category models
 * @since 0.3.0
 */
export interface StepTag<Kind extends StepKind> {
  (strings: TemplateStringsArray): EmptyStepFactory<Kind>;
  <const Captures extends readonly [Capture<string, any>, ...Array<Capture<string, any>>]>(
    strings: TemplateStringsArray,
    ...captures: Captures
  ): CapturedStepFactory<CapturesOf<Captures>, Kind>;
}

type StepFactory<Captures, Kind extends StepKind> =
  EmptyCaptures<Captures> extends true
    ? EmptyStepFactory<Kind>
    : CapturedStepFactory<Captures, Kind>;

interface EmptyStepFactory<Kind extends StepKind> {
  readonly kind: Kind;
  readonly expression: Expression<{}>;
  <Out, E, R>(impl: () => Effect.Effect<Out, E, R>): Step<Kind, unknown, Out, E, R, {}>;
  <In, Out, E, R>(impl: (state: In) => Effect.Effect<Out, E, R>): Step<Kind, In, Out, E, R, {}>;
  <Arg, Out, E, R>(
    arg: StepArg<Arg>,
    impl: (arg: Arg) => Effect.Effect<Out, E, R>,
  ): Step<Kind, unknown, Out, E, R, {}, Arg>;
  <Arg, In, Out, E, R>(
    arg: StepArg<Arg>,
    impl: (arg: Arg, state: In) => Effect.Effect<Out, E, R>,
  ): Step<Kind, In, Out, E, R, {}, Arg>;
}

interface CapturedStepFactory<Captures, Kind extends StepKind> {
  readonly kind: Kind;
  readonly expression: Expression<Captures>;
  <Out, E, R>(impl: () => Effect.Effect<Out, E, R>): Step<Kind, unknown, Out, E, R, Captures>;
  <Out, E, R>(
    impl: (captures: Captures) => Effect.Effect<Out, E, R>,
  ): Step<Kind, unknown, Out, E, R, Captures>;
  <In, Out, E, R>(
    impl: (captures: Captures, state: In) => Effect.Effect<Out, E, R>,
  ): Step<Kind, In, Out, E, R, Captures>;
  <Arg, Out, E, R>(
    arg: StepArg<Arg>,
    impl: (captures: Captures, arg: Arg) => Effect.Effect<Out, E, R>,
  ): Step<Kind, unknown, Out, E, R, Captures, Arg>;
  <Arg, In, Out, E, R>(
    arg: StepArg<Arg>,
    impl: (captures: Captures, arg: Arg, state: In) => Effect.Effect<Out, E, R>,
  ): Step<Kind, In, Out, E, R, Captures, Arg>;
}

const FeatureProto = {
  [FeatureTypeId]: FeatureTypeId,
  pipe() {
    return PipeableRuntime.pipeArguments(this, arguments);
  },
};

const ScenarioProto = {
  [ScenarioTypeId]: ScenarioTypeId,
  pipe() {
    return PipeableRuntime.pipeArguments(this, arguments);
  },
};

const StepProto = {
  [StepTypeId]: StepTypeId,
  pipe() {
    return PipeableRuntime.pipeArguments(this, arguments);
  },
};

const makeFeature = <E, R>(
  name: string,
  scenarios: ReadonlyArray<Scenario<any, any, any>>,
): Feature<E, R> => {
  const feature = Object.create(FeatureProto) as Feature<E, R> & {
    name: string;
    scenarios: ReadonlyArray<Scenario<any, any, any>>;
  };
  feature.name = name;
  feature.scenarios = scenarios;
  return feature;
};

const makeScenario = <State, E, R>(
  name: string,
  steps: ReadonlyArray<AnyStep>,
): Scenario<State, E, R> => {
  const appendScenario = ((self: Feature<unknown, unknown>) =>
    makeFeature(self.name, [
      ...self.scenarios,
      appendScenario as Scenario<State, E, R>,
    ])) as Scenario<State, E, R>;
  Object.setPrototypeOf(appendScenario, ScenarioProto);
  Object.defineProperty(appendScenario, "name", { value: name });
  (appendScenario as Scenario<State, E, R> & { steps: ReadonlyArray<AnyStep> }).steps = steps;
  return appendScenario;
};

interface StepOptions<Kind extends StepKind, In, Out, E, R, Captures, Argument> {
  readonly kind: Kind;
  readonly expression: Expression<Captures>;
  readonly argument?: StepArg<Argument>;
  readonly timeout?: Duration.Input;
  readonly run: (captures: Captures, argument: Argument, state: In) => Effect.Effect<Out, E, R>;
}

const makeStep = <Kind extends StepKind, In, Out, E, R, Captures, Argument>(
  options: StepOptions<Kind, In, Out, E, R, Captures, Argument>,
): Step<Kind, In, Out, E, R, Captures, Argument> => {
  const step = ((self: Scenario<In, unknown, unknown>) =>
    makeScenario(self.name, [...self.steps, step as AnyStep])) as Step<
    Kind,
    In,
    Out,
    E,
    R,
    Captures,
    Argument
  >;
  Object.setPrototypeOf(step, StepProto);
  const self = step as Step<Kind, In, Out, E, R, Captures, Argument> & {
    kind: Kind;
    expression: Expression<Captures>;
    argument?: StepArg<Argument>;
    timeout?: Duration.Input;
    run: (captures: Captures, argument: Argument, state: In) => Effect.Effect<Out, E, R>;
  };
  self.kind = options.kind;
  self.expression = options.expression;
  if (options.argument !== undefined) {
    self.argument = options.argument;
  }
  if (options.timeout !== undefined) {
    self.timeout = options.timeout;
  }
  self.run = options.run;
  return self;
};

function makeStepTag<Kind extends StepKind>(kind: Kind): StepTag<Kind> {
  return ((strings: TemplateStringsArray, ...captures: ReadonlyArray<Capture<string, unknown>>) =>
    makeStepFactory(
      kind,
      expression.makeMatcher(strings, captures),
      captures.length > 0,
    )) as StepTag<Kind>;
}

const makeStepFactory = <Kind extends StepKind, Captures>(
  kind: Kind,
  matcher: Expression<Captures>,
  hasCaptures: boolean,
): StepFactory<Captures, Kind> => {
  const factory = ((first: unknown, second?: unknown) => {
    const hasArgument = isStepArg(first);
    const argument = hasArgument ? first : undefined;
    const impl = (hasArgument ? second : first) as (
      ...args: ReadonlyArray<unknown>
    ) => Effect.Effect<unknown, unknown, unknown>;
    return makeStep({
      kind,
      expression: matcher,
      ...(argument === undefined ? {} : { argument }),
      run: (captures: Captures, decodedArgument: unknown, state: unknown) =>
        impl(
          ...handlerArgs(
            impl,
            hasCaptures,
            argument !== undefined,
            captures,
            decodedArgument,
            state,
          ),
        ),
    });
  }) as StepFactory<Captures, Kind>;
  const self = factory as StepFactory<Captures, Kind> & {
    kind: Kind;
    expression: Expression<Captures>;
  };
  self.kind = kind;
  self.expression = matcher;
  return self;
};

const handlerArgs = (
  impl: (...args: ReadonlyArray<unknown>) => unknown,
  hasCaptures: boolean,
  hasArgument: boolean,
  captures: unknown,
  argument: unknown,
  state: unknown,
): ReadonlyArray<unknown> => {
  const args: ReadonlyArray<unknown> = [
    ...(hasCaptures ? [captures] : []),
    ...(hasArgument ? [argument] : []),
  ];
  return impl.length > args.length ? Arr.append(args, state) : args;
};

const isStepArg = (u: unknown): u is StepArg<unknown> =>
  typeof u === "object" &&
  u !== null &&
  "_tag" in u &&
  ((u as { readonly _tag: unknown })._tag === "TableArg" ||
    (u as { readonly _tag: unknown })._tag === "DocStringArg");
