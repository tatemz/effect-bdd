/**
 * @since 0.1.0
 */
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
export class ParseError extends Schema.TaggedErrorClass<ParseError>()("ParseError", {
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
export class MatchError extends Schema.TaggedErrorClass<MatchError>()("MatchError", {
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
export class StepError extends Schema.TaggedErrorClass<StepError>()("StepError", {
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
export class ScenarioSetupError extends Schema.TaggedErrorClass<ScenarioSetupError>()(
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
export class ScenarioTeardownError extends Schema.TaggedErrorClass<ScenarioTeardownError>()(
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
export class StepTimeoutError extends Schema.TaggedErrorClass<StepTimeoutError>()(
  "StepTimeoutError",
  {
    message: Schema.String,
    timeout: Schema.Duration,
  },
) {}
