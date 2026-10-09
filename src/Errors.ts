/**
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * A syntax or structure error found while parsing Gherkin source.
 *
 * **Details**
 *
 * The error includes the source line and column where parsing failed.
 *
 * @example
 * ```ts
 * import { ParseError } from "effect-bdd/Errors"
 *
 * const error = new ParseError({
 *   message: "Expected a Feature declaration",
 *   line: 1,
 *   column: 1
 * })
 *
 * console.log(error._tag) // "ParseError"
 * ```
 *
 * @category errors
 * @since 0.1.0
 */
export class ParseError extends Schema.TaggedError<ParseError>()("ParseError", {
  message: Schema.String,
  line: Schema.Number,
  column: Schema.Number,
}) {}

/**
 * An error raised when a parsed Gherkin step cannot be matched or decoded.
 *
 * **Details**
 *
 * The `candidates` field contains the registered step expressions considered
 * for the failing source step. When a capture, DataTable, or DocString decode
 * fails, `cause` contains the underlying Schema error.
 *
 * @example
 * ```ts
 * import { MatchError } from "effect-bdd/Errors"
 *
 * const error = new MatchError({
 *   message: "No transition matched step \"increment\"",
 *   scenario: "Increment",
 *   step: "increment",
 *   line: 4,
 *   candidates: ["decrement"],
 *   cause: new Error("Expected a number")
 * })
 *
 * console.log(error._tag) // "MatchError"
 * ```
 *
 * @category errors
 * @since 0.1.0
 */
export class MatchError extends Schema.TaggedError<MatchError>()("MatchError", {
  message: Schema.String,
  scenario: Schema.String,
  step: Schema.String,
  line: Schema.Number,
  candidates: Schema.Array(Schema.String),
  cause: Schema.optionalKey(Schema.Unknown),
}) {}

/**
 * An error raised when a matched step implementation fails.
 *
 * **Details**
 *
 * The `cause` field preserves the original failure from the Effect returned by
 * the step implementation. When the runner interrupts a step because it exceeded
 * its configured timeout, `cause` is a {@link StepTimeoutError}.
 *
 * @example
 * ```ts
 * import { StepError } from "effect-bdd/Errors"
 *
 * const error = new StepError({
 *   message: "Step failed: increment",
 *   scenario: "Increment",
 *   step: "increment",
 *   line: 4,
 *   cause: "expected 1, got 0"
 * })
 *
 * console.log(error._tag) // "StepError"
 * ```
 *
 * @category errors
 * @since 0.1.0
 */
export class StepError extends Schema.TaggedError<StepError>()("StepError", {
  message: Schema.String,
  scenario: Schema.String,
  step: Schema.String,
  line: Schema.Number,
  cause: Schema.Unknown,
}) {}

/**
 * An error raised when scenario-level setup fails before Gherkin steps run.
 *
 * **Details**
 *
 * This includes failures while building scenario-local providers, such as scoped
 * Layers supplied with `Bdd.provide`.
 *
 * @category errors
 * @since 0.5.0
 */
export class ScenarioSetupError extends Schema.TaggedError<ScenarioSetupError>()(
  "ScenarioSetupError",
  {
    message: Schema.String,
    scenario: Schema.String,
    line: Schema.Number,
    cause: Schema.Unknown,
  },
) {}

/**
 * An error raised when scenario-level teardown fails after Gherkin steps finish.
 *
 * **Details**
 *
 * Teardown errors are reported against the scenario, not against the last
 * Gherkin step, because finalizers belong to the scenario lifetime.
 *
 * @category errors
 * @since 0.5.0
 */
export class ScenarioTeardownError extends Schema.TaggedError<ScenarioTeardownError>()(
  "ScenarioTeardownError",
  {
    message: Schema.String,
    scenario: Schema.String,
    line: Schema.Number,
    cause: Schema.Unknown,
  },
) {}

/**
 * A structured cause used when a matched step exceeds its configured timeout.
 *
 * **Details**
 *
 * `StepTimeoutError` is reported as the `cause` of a {@link StepError}. The
 * outer `StepError` carries the scenario, step text, and source line; this
 * nested error carries the timeout-specific details.
 *
 * @example
 * ```ts
 * import { Duration } from "effect"
 * import { StepTimeoutError } from "effect-bdd/Errors"
 *
 * const error = new StepTimeoutError({
 *   message: "Timed out after 5s",
 *   timeout: Duration.seconds(5)
 * })
 *
 * console.log(error._tag) // "StepTimeoutError"
 * ```
 *
 * @category errors
 * @since 0.4.0
 */
export class StepTimeoutError extends Schema.TaggedError<StepTimeoutError>()("StepTimeoutError", {
  message: Schema.String,
  timeout: Schema.Duration,
}) {}

/**
 * A tap handler observes the scenario state without changing it.
 *
 * The Effect may fail — a failing handler surfaces as a {@link TapError}.
 *
 * @category models
 * @since 0.10.0
 */
export interface TapHandler<In> {
  (state: In): Effect.Effect<void, unknown, never>;
}

/**
 * A tap error handler observes a scenario failure without swallowing it.
 *
 * The Effect may fail — a failing handler surfaces as a {@link TapError} that
 * replaces the original failure, mirroring `Effect.tapError` handler semantics.
 *
 * @category models
 * @since 0.10.0
 */
export interface TapErrorHandler {
  (failure: RunError): Effect.Effect<void, unknown, never>;
}

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
  | ScenarioTeardownError
  | TapError;

/**
 * The scenario failure errors observable with `Bdd.tapError`.
 *
 * @category errors
 * @since 0.10.0
 */
export type ScenarioFailure = RunError;

/**
 * An error raised when a {@link Bdd.tap} or `Bdd.tapError` handler fails.
 *
 * **Details**
 *
 * Taps observe without changing outcomes, so a tap handler failure replaces the
 * scenario's own failure the same way an `Effect.tapError` handler failure does.
 * The `cause` field preserves the handler's original failure.
 *
 * @example
 * ```ts
 * import { TapError } from "effect-bdd/Errors"
 *
 * const error = new TapError({
 *   message: "Tap failed: given step",
 *   scenario: "Add item",
 *   step: "an empty cart",
 *   line: 4,
 *   cause: "log sink unavailable"
 * })
 *
 * console.log(error._tag) // "TapError"
 * ```
 *
 * @category errors
 * @since 0.10.0
 */
export class TapError extends Schema.TaggedError<TapError>()("TapError", {
  message: Schema.String,
  scenario: Schema.String,
  step: Schema.String,
  line: Schema.Number,
  cause: Schema.Unknown,
}) {}
