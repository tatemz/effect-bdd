/**
 * @since 0.1.0
 */
import { Bdd as bdd } from "./Bdd.ts";
import type {
  Capture as Capture_,
  DataTable as DataTable_,
  DocString as DocString_,
  DocStringArg as DocStringArg_,
  Feature as Feature_,
  GherkinCompiler as GherkinCompiler_,
  Report as Report_,
  RunError as RunError_,
  RunOptions as RunOptions_,
  Scenario as Scenario_,
  Step as Step_,
  TableArg as TableArg_,
} from "./Bdd.ts";
import type {
  ScenarioSetupError as ScenarioSetupError_,
  ScenarioTeardownError as ScenarioTeardownError_,
  ScenarioTeardownTimeoutError as ScenarioTeardownTimeoutError_,
  StepTimeoutError as StepTimeoutError_,
} from "./Errors.ts";

export {
  MatchError,
  ParseError,
  ScenarioSetupError,
  ScenarioTeardownError,
  ScenarioTeardownTimeoutError,
  StepError,
  StepTimeoutError,
} from "./Errors.ts";

/**
 * Namespace-style API for building and running BDD feature definitions.
 *
 * @category re-exports
 * @since 0.1.0
 */
export const Bdd = bdd;

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
  export type Feature<E = never, R = never> = Feature_<E, R>;

  /**
   * A titled scenario chain.
   *
   * @category models
   * @since 0.3.0
   */
  export type Scenario<State = void, E = never, R = never> = Scenario_<State, E, R>;

  /**
   * A standalone step definition.
   *
   * @category models
   * @since 0.3.0
   */
  export type Step<
    Kind extends "Step" | "Given" | "When" | "Then",
    In,
    Out,
    E = never,
    R = never,
    Captures = unknown,
    Argument = undefined,
  > = Step_<Kind, In, Out, E, R, Captures, Argument>;

  /**
   * Result returned after all scenarios pass.
   *
   * @category models
   * @since 0.1.0
   */
  export type Report = Report_;

  /**
   * Error type returned by `Bdd.run`.
   *
   * @category errors
   * @since 0.1.0
   */
  export type RunError = RunError_;

  /**
   * Options that control `Bdd.run` execution policy.
   *
   * @category models
   * @since 0.4.0
   */
  export type RunOptions = RunOptions_;

  /**
   * Structured cause used when a matched step exceeds its configured timeout.
   *
   * @category errors
   * @since 0.4.0
   */
  export type StepTimeoutError = StepTimeoutError_;

  /**
   * Error raised when scenario setup fails before Gherkin steps run.
   *
   * @category errors
   * @since 0.5.0
   */
  export type ScenarioSetupError = ScenarioSetupError_;

  /**
   * Error raised when scenario teardown fails after Gherkin steps finish.
   *
   * @category errors
   * @since 0.5.0
   */
  export type ScenarioTeardownError = ScenarioTeardownError_;

  /**
   * Structured cause used when scenario teardown exceeds its configured timeout.
   *
   * @category errors
   * @since 0.5.0
   */
  export type ScenarioTeardownTimeoutError = ScenarioTeardownTimeoutError_;

  /**
   * Service used to compile Gherkin source into executable scenarios.
   *
   * @category services
   * @since 0.1.0
   */
  export type GherkinCompiler = GherkinCompiler_;

  /**
   * A named capture decoded from step text with a Schema.
   *
   * @category models
   * @since 0.1.0
   */
  export type Capture<Name extends string, A> = Capture_<Name, A>;

  /**
   * A decoded DataTable argument.
   *
   * @category models
   * @since 0.1.0
   */
  export type TableArg<A> = TableArg_<A>;

  /**
   * A decoded DocString argument.
   *
   * @category models
   * @since 0.1.0
   */
  export type DocStringArg<A> = DocStringArg_<A>;

  /**
   * The cell structure of a Gherkin DataTable supplied to a TableArg decoder.
   *
   * @category models
   * @since 0.2.0
   */
  export type DataTable = DataTable_;

  /**
   * The content of a Gherkin DocString supplied to a DocStringArg decoder.
   *
   * @category models
   * @since 0.2.0
   */
  export type DocString = DocString_;
}

/**
 * A named capture decoded from step text with a Schema.
 *
 * @category re-exports
 * @since 0.1.0
 */
export type Capture<Name extends string, A> = Capture_<Name, A>;

/**
 * A decoded DocString argument.
 *
 * @category re-exports
 * @since 0.1.0
 */
export type DocStringArg<A> = DocStringArg_<A>;

/**
 * A local immutable feature definition used to interpret scenarios from Gherkin source.
 *
 * @category re-exports
 * @since 0.1.0
 */
export type Feature<E = never, R = never> = Feature_<E, R>;

/**
 * A titled scenario chain.
 *
 * @category re-exports
 * @since 0.3.0
 */
export type Scenario<State = void, E = never, R = never> = Scenario_<State, E, R>;

/**
 * A standalone step definition.
 *
 * @category re-exports
 * @since 0.3.0
 */
export type Step<
  Kind extends "Step" | "Given" | "When" | "Then",
  In,
  Out,
  E = never,
  R = never,
  Captures = unknown,
  Argument = undefined,
> = Step_<Kind, In, Out, E, R, Captures, Argument>;

/**
 * Result returned after all scenarios pass.
 *
 * @category re-exports
 * @since 0.1.0
 */
export type Report = Report_;

/**
 * Error type returned by `Bdd.run`.
 *
 * @category re-exports
 * @since 0.1.0
 */
export type RunError = RunError_;

/**
 * Options that control `Bdd.run` execution policy.
 *
 * @category re-exports
 * @since 0.4.0
 */
export type RunOptions = RunOptions_;

/**
 * Service used to compile Gherkin source into executable scenarios.
 *
 * @category re-exports
 * @since 0.1.0
 */
export type GherkinCompiler = GherkinCompiler_;

/**
 * A decoded DataTable argument.
 *
 * @category re-exports
 * @since 0.1.0
 */
export type TableArg<A> = TableArg_<A>;

/**
 * The cell structure of a Gherkin DataTable supplied to a TableArg decoder.
 *
 * @category re-exports
 * @since 0.2.0
 */
export type DataTable = DataTable_;

/**
 * The content of a Gherkin DocString supplied to a DocStringArg decoder.
 *
 * @category re-exports
 * @since 0.2.0
 */
export type DocString = DocString_;
