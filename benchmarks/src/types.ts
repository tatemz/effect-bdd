export type RunnerId = "effect-bdd-cli" | "effect-bdd-api" | "cucumber-js";

export type BenchmarkProfile = "tsx" | "compiled";

export interface BenchmarkConfig {
  readonly iterations: number;
  readonly warmups: number;
  readonly parallel: number;
  readonly profile: BenchmarkProfile;
  readonly generatedScale: GeneratedScale;
}

export interface GeneratedScale {
  readonly parseFeatures: number;
  readonly parseScenariosPerFeature: number;
  readonly outlineExamples: number;
  readonly discoveryFeatures: number;
  readonly discoveryScenariosPerFeature: number;
  readonly parallelScenarios: number;
  readonly reporterScenarios: number;
}

export interface BenchmarkEnvironment {
  readonly node: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly cpuModel: string;
  readonly cpuCount: number;
  readonly gitCommit: string;
  readonly packageVersions: Readonly<Record<string, string>>;
}

export interface SuiteDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly featurePaths: ReadonlyArray<string>;
  readonly apiFeaturePaths?: ReadonlyArray<string>;
  readonly effectBddStepModules: ReadonlyArray<string>;
  readonly effectBddFeatureModules: ReadonlyArray<string>;
  readonly cucumberStepModules: ReadonlyArray<string>;
  readonly generated?: boolean;
  readonly supportsCompiled?: boolean;
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
  readonly phases?: RunPhaseDurations;
}

interface RunPhaseDurations {
  readonly featureDiscoveryMillis: number;
  readonly stepModuleLoadMillis: number;
  readonly taskBuildMillis: number;
  readonly filteringMillis: number;
  readonly executionMillis: number;
  readonly reportEmissionMillis?: number;
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
  readonly executionDurationMillis?: number;
  readonly summary: RunSummary;
  readonly scenarios: ReadonlyArray<ScenarioTiming>;
}

export interface DurationStats {
  readonly medianMillis: number;
  readonly meanMillis: number;
  readonly minMillis: number;
  readonly maxMillis: number;
  readonly p95Millis: number;
  readonly standardDeviationMillis: number;
  readonly coefficientOfVariation: number;
}

export type Confidence = "high" | "medium" | "low";

export interface RunnerStats {
  readonly runner: RunnerId;
  readonly runs: number;
  readonly confidence: Confidence;
  readonly wall: DurationStats;
  readonly execution?: DurationStats;
  readonly wallScenariosPerSecond: number;
  readonly executionScenariosPerSecond?: number;
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
