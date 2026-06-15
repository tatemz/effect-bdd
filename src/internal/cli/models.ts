import type * as Bdd from "../../Bdd.ts";
import type * as Duration from "effect/Duration";
import type * as CoreRunner from "../runner.ts";

/** @internal */
export interface FeatureSource {
  readonly path: string;
  readonly source: string;
}

/** @internal */
export interface ScenarioTask {
  readonly featurePath: string;
  readonly core: CoreRunner.ScenarioTask<unknown, any>;
}

/** @internal */
type ScenarioOutcome =
  | {
      readonly _tag: "Passed";
      readonly steps: number;
    }
  | {
      readonly _tag: "Failed";
      readonly error: Bdd.RunError;
    };

/** @internal */
export interface ScenarioResult {
  readonly task: ScenarioTask;
  readonly outcome: ScenarioOutcome;
  readonly durationMillis: number;
}

/** @internal */
export type RunEvent =
  | {
      readonly _tag: "ScenarioStarted";
      readonly task: ScenarioTask;
    }
  | {
      readonly _tag: "ScenarioFinished";
      readonly result: ScenarioResult;
    };

/** @internal */
export interface RunSummary {
  readonly features: number;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly durationMillis: number;
}

/** @internal */
export interface DiscoverySummary {
  readonly featurePatterns: ReadonlyArray<string>;
  readonly featurePaths: ReadonlyArray<string>;
  readonly stepPatterns: ReadonlyArray<string>;
  readonly stepModulePaths: ReadonlyArray<string>;
  readonly featureDefinitions: ReadonlyArray<string>;
  readonly scenariosDiscovered: number;
  readonly scenariosSelected: number;
  readonly selectedScenarios: ReadonlyArray<{
    readonly featurePath: string;
    readonly featureTitle: string;
    readonly scenarioTitle: string;
    readonly scenarioLine: number;
  }>;
}

/** @internal */
export type CliDiagnostic =
  | {
      readonly _tag: "UnmatchedFeature";
      readonly featurePath: string;
      readonly featureTitle: string;
      readonly line: number;
      readonly message: string;
    }
  | {
      readonly _tag: "UnmatchedScenario";
      readonly featurePath: string;
      readonly featureTitle: string;
      readonly scenarioTitle: string;
      readonly scenarioLine: number;
      readonly message: string;
    }
  | {
      readonly _tag: "UnusedFeatureDefinition";
      readonly featureTitle: string;
      readonly message: string;
    }
  | {
      readonly _tag: "UnusedScenarioDefinition";
      readonly featureTitle: string;
      readonly scenarioTitle: string;
      readonly message: string;
    };

/** @internal */
export interface CliRunResult {
  readonly results: ReadonlyArray<ScenarioResult>;
  readonly diagnostics: ReadonlyArray<CliDiagnostic>;
  readonly summary: RunSummary;
  readonly discovery: DiscoverySummary;
}

/** @internal */
interface CliFilters {
  readonly tags: ReadonlyArray<string>;
  readonly titles: ReadonlyArray<string>;
  readonly failFast: boolean;
}

/** @internal */
export interface CliOptions {
  readonly features: ReadonlyArray<string>;
  readonly steps: ReadonlyArray<string>;
  readonly reporters: ReadonlyArray<ReporterName>;
  readonly outputFiles: {
    readonly text?: string;
    readonly html?: string;
    readonly json?: string;
    readonly junit?: string;
  };
  readonly verbose: boolean;
  readonly filters: CliFilters;
  readonly parallel: number;
  readonly stepTimeout?: Duration.Duration;
}

/** @internal */
export type ReporterName = "text" | "html" | "json" | "junit";
