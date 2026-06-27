export type RunnerId = "effect-bdd-cli" | "effect-bdd-api" | "cucumber-js";

export interface BenchmarkConfig {
  readonly iterations: number;
  readonly warmups: number;
  readonly parallel: number;
}

export interface BenchmarkEnvironment {
  readonly node: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly cpuModel: string;
  readonly cpuCount: number;
}

export interface SuiteDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly featurePaths: ReadonlyArray<string>;
  readonly effectBddStepModules: ReadonlyArray<string>;
  readonly effectBddFeatureModules: ReadonlyArray<string>;
  readonly cucumberStepModules: ReadonlyArray<string>;
}

export interface ScenarioTiming {
  readonly feature: string;
  readonly scenario: string;
  readonly durationMillis: number;
}

export interface RunSummary {
  readonly features: number;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly durationMillis?: number;
}

export interface CommandResult {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly wallDurationMillis: number;
}

export interface BenchmarkRun {
  readonly suiteId: string;
  readonly runner: RunnerId;
  readonly phase: "warmup" | "measured";
  readonly iteration: number;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly exitCode: number;
  readonly wallDurationMillis: number;
  readonly summary: RunSummary;
  readonly scenarios: ReadonlyArray<ScenarioTiming>;
}

export interface RunnerStats {
  readonly runner: RunnerId;
  readonly runs: number;
  readonly medianMillis: number;
  readonly meanMillis: number;
  readonly minMillis: number;
  readonly maxMillis: number;
  readonly scenariosPerSecond: number;
}

export interface SuiteResult {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly stats: ReadonlyArray<RunnerStats>;
  readonly runs: ReadonlyArray<BenchmarkRun>;
}

export interface BenchmarkResult {
  readonly generatedAt: string;
  readonly environment: BenchmarkEnvironment;
  readonly config: BenchmarkConfig;
  readonly suites: ReadonlyArray<SuiteResult>;
}
