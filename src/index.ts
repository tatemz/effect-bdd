/**
 * @since 0.1.0
 */
import { Bdd as bdd } from "./Bdd.ts"
import type {
  Capture as Capture_,
  DataTable as DataTable_,
  DocString as DocString_,
  DocStringArg as DocStringArg_,
  Feature as Feature_,
  GherkinCompiler as GherkinCompiler_,
  Report as Report_,
  RunError as RunError_,
  TableArg as TableArg_
} from "./Bdd.ts"

/**
 * Namespace-style API for building and running BDD feature definitions.
 *
 * @category re-exports
 * @since 0.1.0
 */
export const Bdd = bdd

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
  export type Feature<State, E = never, R = never> = Feature_<State, E, R>

  /**
   * Result returned after all scenarios pass.
   *
   * @category models
   * @since 0.1.0
   */
  export type Report = Report_

  /**
   * Error type returned by `Bdd.run`.
   *
   * @category errors
   * @since 0.1.0
   */
  export type RunError = RunError_

  /**
   * Service used to compile Gherkin source into executable scenarios.
   *
   * @category services
   * @since 0.1.0
   */
  export type GherkinCompiler = GherkinCompiler_

  /**
   * A named capture decoded from step text with a Schema.
   *
   * @category models
   * @since 0.1.0
   */
  export type Capture<Name extends string, A> = Capture_<Name, A>

  /**
   * A decoded DataTable argument.
   *
   * @category models
   * @since 0.1.0
   */
  export type TableArg<A> = TableArg_<A>

  /**
   * A decoded DocString argument.
   *
   * @category models
   * @since 0.1.0
   */
  export type DocStringArg<A> = DocStringArg_<A>

  /**
   * The cell structure of a Gherkin DataTable supplied to a TableArg decoder.
   *
   * @category models
   * @since 0.2.0
   */
  export type DataTable = DataTable_

  /**
   * The content of a Gherkin DocString supplied to a DocStringArg decoder.
   *
   * @category models
   * @since 0.2.0
   */
  export type DocString = DocString_
}

/**
 * A named capture decoded from step text with a Schema.
 *
 * @category re-exports
 * @since 0.1.0
 */
export type Capture<Name extends string, A> = Capture_<Name, A>

/**
 * A decoded DocString argument.
 *
 * @category re-exports
 * @since 0.1.0
 */
export type DocStringArg<A> = DocStringArg_<A>

/**
 * A local immutable feature definition used to interpret scenarios from Gherkin source.
 *
 * @category re-exports
 * @since 0.1.0
 */
export type Feature<State, E = never, R = never> = Feature_<State, E, R>

/**
 * Result returned after all scenarios pass.
 *
 * @category re-exports
 * @since 0.1.0
 */
export type Report = Report_

/**
 * Error type returned by `Bdd.run`.
 *
 * @category re-exports
 * @since 0.1.0
 */
export type RunError = RunError_

/**
 * Service used to compile Gherkin source into executable scenarios.
 *
 * @category re-exports
 * @since 0.1.0
 */
export type GherkinCompiler = GherkinCompiler_

/**
 * A decoded DataTable argument.
 *
 * @category re-exports
 * @since 0.1.0
 */
export type TableArg<A> = TableArg_<A>

/**
 * The cell structure of a Gherkin DataTable supplied to a TableArg decoder.
 *
 * @category re-exports
 * @since 0.2.0
 */
export type DataTable = DataTable_

/**
 * The content of a Gherkin DocString supplied to a DocStringArg decoder.
 *
 * @category re-exports
 * @since 0.2.0
 */
export type DocString = DocString_
