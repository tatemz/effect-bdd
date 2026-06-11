/**
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"

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
  column: Schema.Number
}) {}

/**
 * An error raised when a parsed Gherkin step cannot be matched or decoded.
 *
 * **Details**
 *
 * The `candidates` field contains the registered step expressions considered
 * for the failing source step. When a DataTable or DocString decode fails,
 * `cause` contains the underlying Schema error.
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
 *   candidates: ["decrement"]
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
  cause: Schema.optional(Schema.Unknown)
}) {}

/**
 * An error raised when a matched step implementation fails.
 *
 * **Details**
 *
 * The `cause` field preserves the original failure from the Effect returned by
 * the step implementation.
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
  cause: Schema.Unknown
}) {}
