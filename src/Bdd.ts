/**
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import type * as Option from "effect/Option"
import { type Pipeable, pipeArguments } from "effect/Pipeable"
import { hasProperty } from "effect/Predicate"
import type * as Schema from "effect/Schema"
import { MatchError, ParseError, StepError } from "./Errors.ts"
import * as cucumberCompiler from "./internal/cucumberCompiler.ts"
import * as expression from "./internal/expression.ts"
import * as parser from "./internal/parser.ts"
import * as runner from "./internal/runner.ts"

const FeatureTypeId = "~effect-bdd/Bdd/Feature"

/**
 * Error type returned by `Bdd.run`.
 *
 * @example
 * ```ts
 * import type { Bdd } from "effect-bdd"
 *
 * const describe = (error: Bdd.RunError): string => {
 *   switch (error._tag) {
 *     case "ParseError":
 *       return `Gherkin parse failure at line ${error.line}`
 *     case "MatchError":
 *       return `No step matched "${error.step}"`
 *     case "StepError":
 *       return `Step implementation failed: ${error.step}`
 *   }
 * }
 * ```
 *
 * @category errors
 * @since 0.1.0
 */
export type RunError = ParseError | MatchError | StepError

/**
 * Service used to compile Gherkin source into executable scenarios.
 *
 * **Details**
 *
 * The built-in {@link layerCucumber} layer uses Cucumber's parser and Pickle
 * compiler. Custom implementations must preserve the compiled step, argument,
 * tag, and source-location semantics expected by the runner.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Bdd } from "effect-bdd"
 *
 * const program = Effect.gen(function*() {
 *   const compiler = yield* Bdd.GherkinCompiler
 *   return yield* compiler.compile("Feature: Counter", "<inline>")
 * })
 * ```
 *
 * @category services
 * @since 0.1.0
 */
export const GherkinCompiler = parser.GherkinCompiler

/**
 * Service used to compile Gherkin source into executable scenarios.
 *
 * **Details**
 *
 * The built-in {@link layerCucumber} layer uses Cucumber's parser and Pickle
 * compiler. Custom implementations must preserve the compiled step, argument,
 * tag, and source-location semantics expected by the runner.
 *
 * @example
 * ```ts
 * import type { Effect } from "effect"
 * import type { Bdd } from "effect-bdd"
 *
 * declare const requiresCompiler: Effect.Effect<void, never, Bdd.GherkinCompiler>
 * ```
 *
 * @category services
 * @since 0.1.0
 */
export type GherkinCompiler = parser.GherkinCompiler

/**
 * A {@link GherkinCompiler} layer backed by Cucumber's parser and Pickle
 * compiler.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Bdd } from "effect-bdd"
 *
 * const feature = Bdd.feature("Counter", { initial: 0 })
 *
 * const program = Bdd.run(feature, "Feature: Counter").pipe(
 *   Effect.provide(Bdd.layerCucumber)
 * )
 * ```
 *
 * @category layers
 * @since 0.2.0
 */
export const layerCucumber: Layer.Layer<GherkinCompiler> = cucumberCompiler.layerCucumber

/**
 * Advanced keyword metadata attached to a transition.
 *
 * @example
 * ```ts
 * import type { StepKind } from "effect-bdd/Bdd"
 *
 * const kinds: ReadonlyArray<StepKind> = ["Step", "Given", "When", "Then"]
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export type StepKind = "Step" | "Given" | "When" | "Then"

/**
 * A named capture decoded from step text with a Schema.
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { Bdd } from "effect-bdd"
 *
 * const qty: Bdd.Capture<"qty", number> = Bdd.capture("qty", Schema.FiniteFromString)
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export interface Capture<Name extends string, A> {
  readonly _tag: "Capture"
  readonly name: Name
  readonly schema: Schema.Codec<A, string>
}

/**
 * Advanced type helper that maps capture definitions to decoded values.
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { Bdd } from "effect-bdd"
 * import type { CapturesOf } from "effect-bdd/Bdd"
 *
 * const qty = Bdd.capture("qty", Schema.FiniteFromString)
 * const sku = Bdd.capture("sku", Schema.String)
 *
 * type Decoded = CapturesOf<[typeof qty, typeof sku]>
 * // { readonly qty: number; readonly sku: string }
 * ```
 *
 * @category type-level
 * @since 0.1.0
 */
export type CapturesOf<Captures extends ReadonlyArray<Capture<string, unknown>>> = {
  readonly [C in Captures[number] as C["name"]]: C extends Capture<string, infer A> ? A
    : never
}

/**
 * Advanced matcher type for a compiled step expression.
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { Bdd } from "effect-bdd"
 *
 * const qty = Bdd.capture("qty", Schema.FiniteFromString)
 * const matcher = Bdd.when`add ${qty} items`.expression
 *
 * console.log(matcher.source) // "add {qty} items"
 * console.log(matcher.match("add 3 items")) // Some({ qty: 3 })
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export interface Expression<A> {
  readonly source: string
  readonly match: (text: string) => Option.Option<A>
}

/**
 * The cell structure of a Gherkin DataTable supplied to a {@link TableArg}
 * decoder.
 *
 * @example
 * ```ts
 * import type { Bdd } from "effect-bdd"
 *
 * const table: Bdd.DataTable = {
 *   rows: [
 *     { cells: [{ value: "sku" }, { value: "qty" }] },
 *     { cells: [{ value: "apple" }, { value: "3" }] }
 *   ]
 * }
 * ```
 *
 * @category models
 * @since 0.2.0
 */
export interface DataTable {
  readonly rows: ReadonlyArray<{
    readonly cells: ReadonlyArray<{
      readonly value: string
    }>
  }>
}

/**
 * The content of a Gherkin DocString supplied to a {@link DocStringArg}
 * decoder.
 *
 * @example
 * ```ts
 * import type { Bdd } from "effect-bdd"
 *
 * const docString: Bdd.DocString = { content: "{ \"sku\": \"apple\" }" }
 * ```
 *
 * @category models
 * @since 0.2.0
 */
export interface DocString {
  readonly content: string
}

/**
 * A decoded DataTable argument.
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { Bdd } from "effect-bdd"
 *
 * const Item = Schema.Struct({
 *   sku: Schema.String,
 *   qty: Schema.FiniteFromString
 * })
 *
 * const items: Bdd.TableArg<ReadonlyArray<typeof Item.Type>> = Bdd.table(Item)
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export interface TableArg<A> {
  readonly _tag: "TableArg"
  readonly decode: (table: DataTable) => Effect.Effect<A, unknown>
}

/**
 * A decoded DocString argument.
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { Bdd } from "effect-bdd"
 *
 * const Payload = Schema.Struct({ sku: Schema.String })
 *
 * const payload: Bdd.DocStringArg<typeof Payload.Type> = Bdd.docString(
 *   Schema.fromJsonString(Payload)
 * )
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export interface DocStringArg<A> {
  readonly _tag: "DocStringArg"
  readonly decode: (docString: DocString) => Effect.Effect<A, unknown>
}

/**
 * Advanced union of decoded step argument descriptors.
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { Bdd } from "effect-bdd"
 * import type { StepArg } from "effect-bdd/Bdd"
 *
 * const Item = Schema.Struct({ sku: Schema.String })
 *
 * const arg: StepArg<ReadonlyArray<typeof Item.Type>> = Bdd.table(Item)
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export type StepArg<A> = TableArg<A> | DocStringArg<A>

/**
 * Advanced model for a transition registered on a feature definition.
 *
 * @example
 * ```ts
 * import { Effect, Schema } from "effect"
 * import { Bdd } from "effect-bdd"
 * import type { Transition } from "effect-bdd/Bdd"
 *
 * const qty = Bdd.capture("qty", Schema.FiniteFromString)
 *
 * const transition: Transition<number, never, never, { readonly qty: number }> = {
 *   kind: "When",
 *   expression: Bdd.when`add ${qty}`.expression,
 *   run: (captures, _argument, state) => Effect.succeed(state + captures.qty)
 * }
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export interface Transition<State, E, R, Captures = unknown, Argument = unknown> {
  readonly kind: StepKind
  readonly expression: Expression<Captures>
  readonly argument?: StepArg<Argument>
  readonly run: (captures: Captures, argument: Argument, state: State) => Effect.Effect<State, E, R>
}

/**
 * Existential transition type stored by feature definitions.
 *
 * **Details**
 *
 * A feature can contain many transitions with different capture and step
 * argument shapes. The public constructors keep those shapes typed at the
 * handler boundary, while the runtime matcher stores transitions through this
 * existential type.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Bdd } from "effect-bdd"
 * import type { AnyTransition } from "effect-bdd/Bdd"
 *
 * const feature = Bdd.feature("Counter", { initial: 0 }).pipe(
 *   Bdd.when`increment`((_captures, state) => Effect.succeed(state + 1))
 * )
 *
 * const transitions: ReadonlyArray<AnyTransition<number, never, never>> = feature.transitions
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export type AnyTransition<State, E, R> = Transition<State, E, R, any, any>

/**
 * A local immutable feature definition used to interpret scenarios from Gherkin source.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Bdd } from "effect-bdd"
 *
 * const feature: Bdd.Feature<number> = Bdd.feature("Counter", { initial: 0 }).pipe(
 *   Bdd.when`increment`((_captures, state) => Effect.succeed(state + 1))
 * )
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export interface Feature<State, E = never, R = never> extends Pipeable {
  readonly [FeatureTypeId]: typeof FeatureTypeId
  readonly name: string
  readonly initial: State
  readonly transitions: ReadonlyArray<AnyTransition<State, E, R>>
}

/**
 * Checks whether a value is a {@link Feature} definition.
 *
 * @example
 * ```ts
 * import { Bdd } from "effect-bdd"
 *
 * const feature = Bdd.feature("Counter", { initial: 0 })
 *
 * console.log(Bdd.isFeature(feature)) // true
 * console.log(Bdd.isFeature({ name: "Counter" })) // false
 * ```
 *
 * @category guards
 * @since 0.2.0
 */
export const isFeature = (u: unknown): u is Feature<unknown, unknown, unknown> => hasProperty(u, FeatureTypeId)

/**
 * Result returned after all scenarios pass.
 *
 * @example
 * ```ts
 * import type { Bdd } from "effect-bdd"
 *
 * const summarize = (report: Bdd.Report): string =>
 *   `${report.feature}: ${report.scenarios.length} scenario(s) passed`
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export interface Report {
  readonly feature: string
  readonly scenarios: ReadonlyArray<{
    readonly name: string
    readonly steps: number
    readonly tags: ReadonlyArray<string>
  }>
}

type FeatureType<State, E, R> = Feature<State, E, R>
type ReportType = Report
type RunErrorType = RunError
type GherkinCompilerType = GherkinCompiler
type CaptureType<Name extends string, A> = Capture<Name, A>
type TableArgType<A> = TableArg<A>
type DocStringArgType<A> = DocStringArg<A>
type DataTableType = DataTable
type DocStringType = DocString

/**
 * Creates a named capture decoded from step text.
 *
 * **When to use**
 *
 * Use a capture when a Gherkin step contains a value that should be decoded
 * before it reaches the step implementation.
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { Bdd } from "effect-bdd"
 *
 * const qty = Bdd.capture("qty", Schema.FiniteFromString)
 *
 * const step = Bdd.when`${qty} items are added`
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
const capture_: <const Name extends string, A>(
  name: Name,
  schema: Schema.Codec<A, string>
) => Capture<Name, A> = expression.makeCapture

/**
 * Creates a DataTable decoder from a row Schema.
 *
 * **Details**
 *
 * The first row of the Gherkin table is interpreted as the header row. Each
 * following row is converted into an object and decoded with the supplied
 * Schema.
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { Bdd } from "effect-bdd"
 *
 * const Item = Schema.Struct({
 *   sku: Schema.String,
 *   qty: Schema.FiniteFromString
 * })
 *
 * const items = Bdd.table(Item)
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
const table_ = <S extends Schema.Decoder<unknown, never>>(row: S): TableArg<ReadonlyArray<S["Type"]>> => ({
  _tag: "TableArg",
  decode: runner.decodeTable(row)
})

/**
 * Creates a DocString decoder from a Schema.
 *
 * **When to use**
 *
 * Use `docString` for larger step arguments, such as JSON payloads or plain
 * text blocks, that should be decoded before the step implementation runs.
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { Bdd } from "effect-bdd"
 *
 * const Payload = Schema.Struct({
 *   sku: Schema.String,
 *   qty: Schema.Number
 * })
 *
 * const payload = Bdd.docString(Schema.fromJsonString(Payload))
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
const docString_ = <S extends Schema.Decoder<unknown, never>>(schema: S): DocStringArg<S["Type"]> => ({
  _tag: "DocStringArg",
  decode: runner.decodeDocString(schema)
})

/**
 * Creates a feature definition with an explicit initial state.
 *
 * **Details**
 *
 * A feature definition is an immutable state machine. Each registered step
 * receives the current state and returns the next state in an `Effect`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Bdd } from "effect-bdd"
 *
 * const feature = Bdd.feature("Counter", { initial: 0 }).pipe(
 *   Bdd.given`zero`(() => Effect.succeed(0)),
 *   Bdd.when`increment`((_captures, state) => Effect.succeed(state + 1))
 * )
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
const feature_ = <State>(name: string, options: {
  readonly initial: State
}): Feature<State> => makeFeature(name, options.initial, [])

/**
 * Tagged-template transition factory that does not attach Gherkin keyword metadata.
 *
 * **When to use**
 *
 * Use `step` for a transition that is semantically valid as any concrete
 * Gherkin step kind. Prefer `given`, `when`, or `then` when the transition
 * represents setup, action, or assertion specifically.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Bdd } from "effect-bdd"
 *
 * const feature = Bdd.feature("Counter", { initial: 0 }).pipe(
 *   Bdd.step`the counter exists`((_captures, state) => Effect.succeed(state))
 * )
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
const step_: StepTag<"Step"> = makeStepTag("Step")

/**
 * Tagged-template transition factory for `Given` steps.
 *
 * **Details**
 *
 * A source `Given` step only matches `given` or keyword-agnostic `step`
 * transitions.
 *
 * `And` and `But` steps inherit the previous concrete Gherkin keyword before
 * matching, so they can match a `given` transition when they follow a `Given`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Bdd } from "effect-bdd"
 *
 * const feature = Bdd.feature("Counter", { initial: 0 }).pipe(
 *   Bdd.given`a fresh counter`(() => Effect.succeed(0))
 * )
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
const given_: StepTag<"Given"> = makeStepTag("Given")

/**
 * Tagged-template transition factory for `When` steps.
 *
 * **Details**
 *
 * A source `When` step only matches `when` or keyword-agnostic `step`
 * transitions.
 *
 * `And` and `But` steps inherit the previous concrete Gherkin keyword before
 * matching, so they can match a `when` transition when they follow a `When`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Bdd } from "effect-bdd"
 *
 * const feature = Bdd.feature("Counter", { initial: 0 }).pipe(
 *   Bdd.when`increment`((_captures, state) => Effect.succeed(state + 1))
 * )
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
const when_: StepTag<"When"> = makeStepTag("When")

/**
 * Tagged-template transition factory for `Then` steps.
 *
 * **Details**
 *
 * A source `Then` step only matches `then` or keyword-agnostic `step`
 * transitions.
 *
 * `And` and `But` steps inherit the previous concrete Gherkin keyword before
 * matching, so they can match a `then` transition when they follow a `Then`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Bdd } from "effect-bdd"
 *
 * const feature = Bdd.feature("Counter", { initial: 0 }).pipe(
 *   Bdd.then`the counter is positive`((_captures, state) =>
 *     state > 0
 *       ? Effect.succeed(state)
 *       : Effect.fail(`expected a positive counter, got ${state}`)
 *   )
 * )
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
const then_: StepTag<"Then"> = makeStepTag("Then")

/**
 * Runs Gherkin source against a feature definition.
 *
 * **Details**
 *
 * The feature definition name must match the Gherkin `Feature:` name. Every
 * scenario starts from the feature's initial state. Background steps run before
 * each scenario, then scenario steps run in source order.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Bdd } from "effect-bdd"
 *
 * const feature = Bdd.feature("Counter", { initial: 0 }).pipe(
 *   Bdd.given`zero`(() => Effect.succeed(0)),
 *   Bdd.when`increment`((_captures, state) => Effect.succeed(state + 1))
 * )
 *
 * const program = Bdd.run(feature, `
 * Feature: Counter
 *
 *   Scenario: Increment
 *     Given zero
 *     When increment
 * `).pipe(Effect.provide(Bdd.layerCucumber))
 * ```
 *
 * @category execution
 * @since 0.1.0
 */
const run_ = <State, E, R>(
  self: Feature<State, E, R>,
  source: string
): Effect.Effect<Report, RunError, R | GherkinCompiler> => runner.run(self, source)

/**
 * Namespace-style API for building and running BDD feature definitions.
 *
 * **Details**
 *
 * The namespace contains constructors for captures, step arguments, feature
 * definitions, step transitions, and the Gherkin runner.
 *
 * @example
 * ```ts
 * import { Effect, Schema } from "effect"
 * import { Bdd } from "effect-bdd"
 *
 * const qty = Bdd.capture("qty", Schema.FiniteFromString)
 *
 * const feature = Bdd.feature("Counter", { initial: 0 }).pipe(
 *   Bdd.given`zero`(() => Effect.succeed(0)),
 *   Bdd.when`increment by ${qty}`(({ qty }, state) => Effect.succeed(state + qty))
 * )
 *
 * const program = Bdd.run(feature, `
 * Feature: Counter
 *
 *   Scenario: Increment
 *     Given zero
 *     When increment by 2
 * `).pipe(Effect.provide(Bdd.layerCucumber))
 * ```
 *
 * @category namespaces
 * @since 0.1.0
 */
export const Bdd = {
  ParseError,
  MatchError,
  StepError,
  GherkinCompiler,
  layerCucumber,
  isFeature,
  capture: capture_,
  table: table_,
  docString: docString_,
  feature: feature_,
  step: step_,
  given: given_,
  when: when_,
  // oxlint-disable-next-line unicorn/no-thenable
  then: then_,
  run: run_
}

/**
 * Type helpers for the {@link Bdd} value namespace.
 *
 * @since 0.1.0
 */
export declare namespace Bdd {
  /**
   * A local immutable feature definition used to interpret scenarios from Gherkin source.
   *
   * @category models
   * @since 0.1.0
   */
  export type Feature<State, E = never, R = never> = FeatureType<State, E, R>

  /**
   * Result returned after all scenarios pass.
   *
   * @category models
   * @since 0.1.0
   */
  export type Report = ReportType

  /**
   * Error type returned by `Bdd.run`.
   *
   * @category errors
   * @since 0.1.0
   */
  export type RunError = RunErrorType

  /**
   * Service used to compile Gherkin source into executable scenarios.
   *
   * @category services
   * @since 0.1.0
   */
  export type GherkinCompiler = GherkinCompilerType

  /**
   * A named capture decoded from step text with a Schema.
   *
   * @category models
   * @since 0.1.0
   */
  export type Capture<Name extends string, A> = CaptureType<Name, A>

  /**
   * A decoded DataTable argument.
   *
   * @category models
   * @since 0.1.0
   */
  export type TableArg<A> = TableArgType<A>

  /**
   * A decoded DocString argument.
   *
   * @category models
   * @since 0.1.0
   */
  export type DocStringArg<A> = DocStringArgType<A>

  /**
   * The cell structure of a Gherkin DataTable supplied to a TableArg decoder.
   *
   * @category models
   * @since 0.2.0
   */
  export type DataTable = DataTableType

  /**
   * The content of a Gherkin DocString supplied to a DocStringArg decoder.
   *
   * @category models
   * @since 0.2.0
   */
  export type DocString = DocStringType
}

/**
 * Advanced tagged-template function type used to register transitions.
 *
 * @example
 * ```ts
 * import { Bdd } from "effect-bdd"
 * import type { StepTag } from "effect-bdd/Bdd"
 *
 * const when: StepTag<"When"> = Bdd.when
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export interface StepTag<Kind extends StepKind> {
  <const Captures extends ReadonlyArray<Capture<string, unknown>>>(
    strings: TemplateStringsArray,
    ...captures: Captures
  ): StepBuilder<CapturesOf<Captures>, Kind>
}

/**
 * Advanced builder returned by a tagged-template transition.
 *
 * @example
 * ```ts
 * import { Bdd } from "effect-bdd"
 * import type { StepBuilder } from "effect-bdd/Bdd"
 *
 * const builder: StepBuilder<{}, "When"> = Bdd.when`increment`
 *
 * console.log(builder.kind) // "When"
 * console.log(builder.expression.source) // "increment"
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export interface StepBuilder<Captures, Kind extends StepKind> {
  <State, E, R>(
    impl: (captures: Captures, state: State) => Effect.Effect<State, E, R>
  ): <E0, R0>(self: Feature<State, E0, R0>) => Feature<State, E | E0, R | R0>
  <State, Arg, E, R>(
    arg: StepArg<Arg>,
    impl: (captures: Captures, arg: Arg, state: State) => Effect.Effect<State, E, R>
  ): <E0, R0>(self: Feature<State, E0, R0>) => Feature<State, E | E0, R | R0>
  readonly kind: Kind
  readonly expression: Expression<Captures>
}

const makeFeature = <State, E, R>(
  name: string,
  initial: State,
  transitions: ReadonlyArray<AnyTransition<State, E, R>>
): Feature<State, E, R> => ({
  [FeatureTypeId]: FeatureTypeId,
  name,
  initial,
  transitions,
  pipe() {
    return pipeArguments(this, arguments)
  }
})

function makeStepTag<Kind extends StepKind>(kind: Kind): StepTag<Kind> {
  return ((strings: TemplateStringsArray, ...captures: ReadonlyArray<Capture<string, unknown>>) => {
    const matcher = expression.makeMatcher(strings, captures)
    const builder = ((first: unknown, second?: unknown) => (self: Feature<unknown, unknown, unknown>) => {
      const transition: AnyTransition<unknown, unknown, unknown> = second === undefined ?
        {
          kind,
          expression: matcher,
          run: (captures, _argument, state) =>
            (first as (captures: unknown, state: unknown) => Effect.Effect<unknown, unknown, unknown>)(captures, state)
        } :
        {
          kind,
          expression: matcher,
          argument: first as StepArg<unknown>,
          run: (captures, argument, state) =>
            (second as (
              captures: unknown,
              argument: unknown,
              state: unknown
            ) => Effect.Effect<unknown, unknown, unknown>)(captures, argument, state)
        }
      return makeFeature(self.name, self.initial, [...self.transitions, transition])
    }) as StepBuilder<unknown, Kind>
    Object.defineProperties(builder, {
      kind: { value: kind },
      expression: { value: matcher }
    })
    return builder
  }) as StepTag<Kind>
}
