/**
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fn from "effect/Function";
import type * as Layer from "effect/Layer";
import type * as Option from "effect/Option";
import type { Pipeable } from "effect/Pipeable";
import * as PipeableRuntime from "effect/Pipeable";
import * as Predicate from "effect/Predicate";
import type * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import {
  MatchError,
  ParseError,
  ScenarioSetupError,
  ScenarioTeardownError,
  StepError,
  StepTimeoutError,
} from "./Errors.ts";
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
export type RunError =
  | ParseError
  | MatchError
  | ScenarioSetupError
  | StepError
  | ScenarioTeardownError;

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

/**
 * A compiled step expression.
 *
 * @category models
 * @since 0.1.0
 */
export interface Expression<_A> {
  readonly source: string;
  readonly match: (text: string) => Option.Option<unknown>;
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
  readonly timeout?: Duration.Duration;
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
 * Existential provider type stored in scenario chains.
 *
 * @category models
 * @since 0.5.0
 */
export type AnyProvider = Layer.Layer<any, any, any>;

/**
 * A titled scenario chain. The type parameter tracks the current state after
 * the last appended step.
 *
 * @category models
 * @since 0.3.0
 */
export interface Scenario<State = void, E = never, R = never> extends Pipeable {
  <E0, R0>(self: Feature<E0, R0>): Feature<E | E0, R | R0>;
  readonly [ScenarioTypeId]: typeof ScenarioTypeId;
  readonly _State?: (_: State) => State;
  readonly title: string;
  readonly steps: ReadonlyArray<AnyStep>;
  readonly providers: ReadonlyArray<AnyProvider>;
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
  readonly title: string;
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
    readonly title: string;
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
type StepTimeoutErrorType = StepTimeoutError;
type ScenarioSetupErrorType = ScenarioSetupError;
type ScenarioTeardownErrorType = ScenarioTeardownError;

/**
 * Options that control `Bdd.run` execution policy.
 *
 * @category models
 * @since 0.4.0
 */
export interface RunOptions {
  readonly stepTimeout?: Duration.Duration;
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
const table_ = <S extends Schema.ConstraintDecoder<unknown, never>>(
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
const docString_ = <S extends Schema.ConstraintDecoder<unknown, never>>(
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
const feature_ = (title: string): Feature => makeFeature(title, []);

/**
 * Creates a scenario chain.
 *
 * @category constructors
 * @since 0.3.0
 */
const scenario_ = (title: string): Scenario<void> => makeScenario(title, []);

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
export interface WithTimeout {
  (
    timeout: Duration.Duration,
  ): <Kind extends StepKind, In, Out, E, R, Captures, Argument>(
    self: Step<Kind, In, Out, E, R, Captures, Argument>,
  ) => Step<Kind, In, Out, E, R, Captures, Argument>;
  <Kind extends StepKind, In, Out, E, R, Captures, Argument>(
    self: Step<Kind, In, Out, E, R, Captures, Argument>,
    timeout: Duration.Duration,
  ): Step<Kind, In, Out, E, R, Captures, Argument>;
}

const withTimeout_: WithTimeout = Fn.dual(
  2,
  <Kind extends StepKind, In, Out, E, R, Captures, Argument>(
    self: Step<Kind, In, Out, E, R, Captures, Argument>,
    timeout: Duration.Duration,
  ): Step<Kind, In, Out, E, R, Captures, Argument> =>
    makeStep({
      kind: self.kind,
      expression: self.expression,
      ...(self.argument === undefined ? {} : { argument: self.argument }),
      timeout,
      run: self.run,
    }),
);

/**
 * Provides scenario-local services to the matched scenario program.
 *
 * `Bdd.provide` mirrors `Effect.provide`, but attaches provision before the
 * scenario program exists. The runner applies the layer once per matched
 * scenario, so scoped resources are finalized at scenario end.
 *
 * @example
 * ```ts
 * import { Bdd } from "effect-bdd"
 * import { Context, Effect, Layer } from "effect"
 *
 * class BrowserPage extends Context.Service<BrowserPage, {
 *   readonly close: () => Effect.Effect<void>
 * }>()("BrowserPage") {}
 *
 * const BrowserPageLive = Layer.effect(
 *   BrowserPage,
 *   Effect.acquireRelease(
 *     Effect.succeed({ close: () => Effect.void }),
 *     (page) => page.close()
 *   )
 * )
 *
 * const opensPage = Bdd.scenario("Opens page").pipe(
 *   Bdd.given`the app is open`(() => Effect.void),
 *   Bdd.provide(BrowserPageLive)
 * )
 * ```
 *
 * @category combinators
 * @since 0.5.0
 */
export interface Provide {
  <ROut, E2, RIn>(
    provider: Layer.Layer<ROut, E2, RIn>,
  ): <State, E, R>(self: Scenario<State, E, R>) => Scenario<State, E | E2, Exclude<R, ROut> | RIn>;
  <State, E, R, ROut, E2, RIn>(
    self: Scenario<State, E, R>,
    provider: Layer.Layer<ROut, E2, RIn>,
  ): Scenario<State, E | E2, Exclude<R, ROut> | RIn>;
}

const provide_: Provide = Fn.dual(
  2,
  <State, E, R, ROut, E2, RIn>(
    self: Scenario<State, E, R>,
    provider: Layer.Layer<ROut, E2, RIn>,
  ): Scenario<State, E | E2, Exclude<R, ROut> | RIn> =>
    makeScenario(self.title, self.steps, [...self.providers, provider]),
);

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
): Effect.Effect<Report, RunError, Exclude<R, Scope.Scope> | GherkinCompiler> =>
  runner.run(self, source, options);

/**
 * Checks whether a value is a {@link StepTimeoutError}.
 *
 * @category guards
 * @since 0.4.0
 */
const isStepTimeoutError_ = (u: unknown): u is StepTimeoutError => u instanceof StepTimeoutError;

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
  ScenarioSetupError,
  ScenarioTeardownError,
  StepTimeoutError,
  GherkinCompiler,
  layerCucumber,
  isFeature,
  isStepTimeoutError: isStepTimeoutError_,
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
  provide: provide_,
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
   * A titled scenario chain.
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
   * Structured cause used when a matched step exceeds its configured timeout.
   *
   * @category errors
   * @since 0.4.0
   */
  export type StepTimeoutError = StepTimeoutErrorType;

  /**
   * Error raised when scenario setup fails before Gherkin steps run.
   *
   * @category errors
   * @since 0.5.0
   */
  export type ScenarioSetupError = ScenarioSetupErrorType;

  /**
   * Error raised when scenario teardown fails after Gherkin steps finish.
   *
   * @category errors
   * @since 0.5.0
   */
  export type ScenarioTeardownError = ScenarioTeardownErrorType;

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

const makeFeature = <E, R>(
  title: string,
  scenarios: ReadonlyArray<Scenario<any, any, any>>,
): Feature<E, R> =>
  Object.freeze({
    [FeatureTypeId]: FeatureTypeId,
    title,
    scenarios,
    pipe() {
      return PipeableRuntime.pipeArguments(this, arguments);
    },
  });

const makeScenario = <State, E, R>(
  title: string,
  steps: ReadonlyArray<AnyStep>,
  providers: ReadonlyArray<AnyProvider> = [],
): Scenario<State, E, R> => {
  function appendScenario<E0, R0>(self: Feature<E0, R0>): Feature<E | E0, R | R0> {
    return makeFeature(self.title, [...self.scenarios, scenario]);
  }
  const properties: Pick<
    Scenario<State, E, R>,
    typeof ScenarioTypeId | "title" | "steps" | "providers" | "pipe"
  > = {
    [ScenarioTypeId]: ScenarioTypeId,
    title,
    steps,
    providers,
    pipe() {
      return PipeableRuntime.pipeArguments(this, arguments);
    },
  };
  // oxlint-disable-next-line effect-bdd/no-native-object-methods-in-src
  const scenario: Scenario<State, E, R> = Object.assign(appendScenario, properties);
  return Object.freeze(scenario);
};

interface StepOptions<Kind extends StepKind, In, Out, E, R, Captures, Argument> {
  readonly kind: Kind;
  readonly expression: Expression<Captures>;
  readonly argument?: StepArg<Argument>;
  readonly timeout?: Duration.Duration;
  readonly run: (captures: Captures, argument: Argument, state: In) => Effect.Effect<Out, E, R>;
}

const makeStep = <Kind extends StepKind, In, Out, E, R, Captures, Argument>(
  options: StepOptions<Kind, In, Out, E, R, Captures, Argument>,
): Step<Kind, In, Out, E, R, Captures, Argument> => {
  function appendStep<State extends In, E0, R0>(
    self: Scenario<State, E0, R0>,
  ): Scenario<Out, E | E0, R | R0> {
    return makeScenario(self.title, [...self.steps, step], self.providers);
  }
  const properties: Pick<
    Step<Kind, In, Out, E, R, Captures, Argument>,
    typeof StepTypeId | "kind" | "expression" | "run" | "pipe"
  > & {
    readonly argument?: StepArg<Argument>;
    readonly timeout?: Duration.Duration;
  } = {
    [StepTypeId]: StepTypeId,
    kind: options.kind,
    expression: options.expression,
    ...(options.argument === undefined ? {} : { argument: options.argument }),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    run: options.run,
    pipe() {
      return PipeableRuntime.pipeArguments(this, arguments);
    },
  };
  // oxlint-disable-next-line effect-bdd/no-native-object-methods-in-src
  const step: Step<Kind, In, Out, E, R, Captures, Argument> = Object.assign(appendStep, properties);
  return Object.freeze(step);
};

function makeStepTag<Kind extends StepKind>(kind: Kind): StepTag<Kind> {
  function stepTag(strings: TemplateStringsArray): EmptyStepFactory<Kind>;
  function stepTag<
    const Captures extends readonly [Capture<string, any>, ...Array<Capture<string, any>>],
  >(
    strings: TemplateStringsArray,
    ...captures: Captures
  ): CapturedStepFactory<CapturesOf<Captures>, Kind>;
  function stepTag(
    strings: TemplateStringsArray,
    ...captures: ReadonlyArray<Capture<string, unknown>>
  ) {
    return captures.length === 0
      ? makeStepFactory(kind, expression.makeMatcher(strings, captures), false)
      : makeStepFactory(kind, expression.makeMatcher(strings, captures), true);
  }
  return stepTag;
}

function makeStepFactory<Kind extends StepKind>(
  kind: Kind,
  matcher: Expression<unknown>,
  hasCaptures: false,
): EmptyStepFactory<Kind>;
function makeStepFactory<Kind extends StepKind, Captures>(
  kind: Kind,
  matcher: Expression<Captures>,
  hasCaptures: true,
): CapturedStepFactory<Captures, Kind>;
function makeStepFactory<Kind extends StepKind, Captures>(
  kind: Kind,
  matcher: Expression<Captures>,
  hasCaptures: boolean,
) {
  function factory<Out, E, R>(
    impl: () => Effect.Effect<Out, E, R>,
  ): Step<Kind, unknown, Out, E, R, Captures>;
  function factory<In, Out, E, R>(
    impl: (state: In) => Effect.Effect<Out, E, R>,
  ): Step<Kind, In, Out, E, R, Captures>;
  function factory<Arg, Out, E, R>(
    arg: StepArg<Arg>,
    impl: (arg: Arg) => Effect.Effect<Out, E, R>,
  ): Step<Kind, unknown, Out, E, R, Captures, Arg>;
  function factory<Arg, In, Out, E, R>(
    arg: StepArg<Arg>,
    impl: (arg: Arg, state: In) => Effect.Effect<Out, E, R>,
  ): Step<Kind, In, Out, E, R, Captures, Arg>;
  function factory(
    first: unknown,
    second?: unknown,
  ): Step<Kind, any, any, any, any, Captures, any> {
    const hasArgument = isStepArg(first);
    const argument = hasArgument ? first : undefined;
    const impl = stepImplementation(hasArgument ? second : first);
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
  }
  // oxlint-disable-next-line effect-bdd/no-native-object-methods-in-src
  return Object.assign(factory, {
    kind,
    expression: matcher,
  });
}

type StepImplementation = (
  ...args: ReadonlyArray<unknown>
) => Effect.Effect<unknown, unknown, unknown>;

const invalidStepImplementation: StepImplementation = () =>
  Effect.fail(new TypeError("Expected a step implementation function."));

const isStepImplementation = (u: unknown): u is StepImplementation => typeof u === "function";

const stepImplementation = (u: unknown): StepImplementation =>
  isStepImplementation(u) ? u : invalidStepImplementation;

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

const isStepArgTag = (tag: unknown): tag is StepArg<unknown>["_tag"] =>
  tag === "TableArg" || tag === "DocStringArg";

const isStepArg = (u: unknown): u is StepArg<unknown> =>
  typeof u === "object" && u !== null && "_tag" in u && isStepArgTag(u._tag);
