import { Effect } from "effect";
import { Bdd } from "effect-bdd";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { assertSuccessful, runCommand } from "./process.ts";
import { benchmarkRoot, displayPath, fromBenchmarkRoot } from "./paths.ts";
import type {
  BenchmarkRun,
  BenchmarkProfile,
  CommandResult,
  RunSummary,
  RunnerId,
  ScenarioTiming,
  SuiteDefinition,
} from "./types.ts";

type Phase = BenchmarkRun["phase"];

interface EffectBddJsonReport {
  readonly summary: RunSummary;
  readonly scenarios: ReadonlyArray<{
    readonly feature: string;
    readonly scenario: string;
    readonly durationMillis: number;
    readonly outcome: {
      readonly status: string;
    };
  }>;
}

interface EffectBddTimingSidecar {
  readonly reportEmissionMillis: number;
}

interface CucumberJsonFeature {
  readonly name?: string;
  readonly elements: ReadonlyArray<CucumberJsonElement>;
}

interface CucumberJsonElement {
  readonly name?: string;
  readonly type?: string;
  readonly steps: ReadonlyArray<CucumberJsonStep>;
}

interface CucumberJsonStep {
  readonly result?: {
    readonly status?: string;
    readonly duration?: number;
  };
}

export const runEffectBddCli = async (
  suite: SuiteDefinition,
  phase: Phase,
  iteration: number,
  parallel: number,
  profile: BenchmarkProfile,
): Promise<BenchmarkRun> => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "effect-bdd-cli-"));
  const outputFile = path.join(outputDir, "report.json");
  const timingFile = path.join(outputDir, "timing.txt");
  const args = [
    ...nodeLoaderArgs(profile),
    fromBenchmarkRoot("node_modules", "effect-bdd", "dist", "bin.js"),
    ...suite.featurePaths.flatMap((featurePath) => ["--features", featurePath]),
    ...suite.effectBddStepModules.flatMap((stepModule) => [
      "--steps",
      modulePathForProfile(stepModule, profile),
    ]),
    "--reporter",
    "json",
    "--output-file.json",
    outputFile,
    "--benchmark-timing-file",
    timingFile,
    "--parallel",
    String(parallel),
  ];
  const result = await runCommand(process.execPath, args, { cwd: benchmarkRoot });
  assertSuccessful(result);
  const report = parseEffectBddJsonReport(JSON.parse(await fs.readFile(outputFile, "utf8")));
  const timing = parseEffectBddTimingSidecar(await fs.readFile(timingFile, "utf8"));
  const summary = withReportEmissionTiming(report.summary, timing);
  await fs.rm(outputDir, { recursive: true, force: true });
  return subprocessRun("effect-bdd-cli", suite, phase, iteration, result, {
    summary,
    ...(summary.phases?.executionMillis === undefined
      ? {}
      : { executionDurationMillis: summary.phases.executionMillis }),
    scenarios: report.scenarios.map((scenario) => ({
      feature: scenario.feature,
      scenario: scenario.scenario,
      durationMillis: scenario.durationMillis,
    })),
  });
};

const withReportEmissionTiming = (
  summary: RunSummary,
  timing: EffectBddTimingSidecar,
): RunSummary =>
  summary.phases === undefined
    ? summary
    : {
        ...summary,
        phases: {
          ...summary.phases,
          reportEmissionMillis: timing.reportEmissionMillis,
        },
      };

export const runCucumberJs = async (
  suite: SuiteDefinition,
  phase: Phase,
  iteration: number,
  parallel: number,
  profile: BenchmarkProfile,
): Promise<BenchmarkRun> => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "cucumber-js-"));
  const outputFile = path.join(outputDir, "report.json");
  const args = [
    ...nodeLoaderArgs(profile),
    fromBenchmarkRoot("node_modules", "@cucumber", "cucumber", "bin", "cucumber.js"),
    "--parallel",
    String(parallel),
    "--format",
    `json:${outputFile}`,
    ...suite.cucumberStepModules.flatMap((stepModule) => [
      "--import",
      modulePathForProfile(stepModule, profile),
    ]),
    ...suite.featurePaths,
  ];
  const result = await runCommand(process.execPath, args, { cwd: benchmarkRoot });
  assertSuccessful(result);
  const features = parseCucumberJson(JSON.parse(await fs.readFile(outputFile, "utf8")));
  await fs.rm(outputDir, { recursive: true, force: true });
  return subprocessRun("cucumber-js", suite, phase, iteration, result, cucumberSummary(features));
};

export const runEffectBddApi = async (
  suite: SuiteDefinition,
  phase: Phase,
  iteration: number,
): Promise<BenchmarkRun> => {
  const started = performance.now();
  const featureDefinitions = await loadEffectBddFeatures(suite.effectBddFeatureModules);
  const apiFeaturePaths = suite.apiFeaturePaths ?? suite.featurePaths;
  const counts = await apiFeaturePaths.reduce<
    Promise<{
      readonly featureCount: number;
      readonly scenarioCount: number;
    }>
  >(
    async (previousCounts, featurePath) =>
      addEffectBddApiFeatureCounts(await previousCounts, featureDefinitions, featurePath),
    Promise.resolve({ featureCount: 0, scenarioCount: 0 }),
  );

  const wallDurationMillis = performance.now() - started;
  return {
    suiteId: suite.id,
    runner: "effect-bdd-api",
    phase,
    iteration,
    command: "in-process",
    args: apiFeaturePaths.map(displayPath),
    cwd: benchmarkRoot,
    exitCode: 0,
    wallDurationMillis,
    summary: {
      features: counts.featureCount,
      total: counts.scenarioCount,
      passed: counts.scenarioCount,
      failed: 0,
      durationMillis: wallDurationMillis,
    },
    scenarios: [],
  };
};

const addEffectBddApiFeatureCounts = async (
  counts: {
    readonly featureCount: number;
    readonly scenarioCount: number;
  },
  featureDefinitions: ReadonlyMap<string, Bdd.Feature<unknown, never>>,
  featurePath: string,
): Promise<{
  readonly featureCount: number;
  readonly scenarioCount: number;
}> => {
  const source = await fs.readFile(featurePath, "utf8");
  const title = featureTitle(source);
  const feature = featureDefinitions.get(title);
  if (feature === undefined) {
    throw new Error(`No effect-bdd feature definition found for "${title}"`);
  }
  const report = await Effect.runPromise(
    Bdd.run(feature, source).pipe(Effect.provide(Bdd.layerCucumber)),
  );
  return {
    featureCount: counts.featureCount + 1,
    scenarioCount: counts.scenarioCount + report.scenarios.length,
  };
};

const subprocessRun = (
  runner: RunnerId,
  suite: SuiteDefinition,
  phase: Phase,
  iteration: number,
  result: CommandResult,
  parsed: {
    readonly summary: RunSummary;
    readonly executionDurationMillis?: number;
    readonly scenarios: ReadonlyArray<ScenarioTiming>;
  },
): BenchmarkRun => ({
  suiteId: suite.id,
  runner,
  phase,
  iteration,
  command: result.command,
  args: result.args,
  cwd: result.cwd,
  exitCode: result.exitCode,
  wallDurationMillis: result.wallDurationMillis,
  ...(parsed.executionDurationMillis === undefined
    ? {}
    : { executionDurationMillis: parsed.executionDurationMillis }),
  summary: parsed.summary,
  scenarios: parsed.scenarios,
});

const nodeLoaderArgs = (profile: BenchmarkProfile): ReadonlyArray<string> =>
  profile === "tsx" ? ["--import", "tsx"] : [];

const modulePathForProfile = (modulePath: string, profile: BenchmarkProfile): string => {
  if (profile === "tsx" || !modulePath.startsWith(benchmarkRoot)) {
    return modulePath;
  }
  const relative = path.relative(benchmarkRoot, modulePath);
  return path.join(benchmarkRoot, "dist", relative).replace(/\.ts$/, ".js");
};

const cucumberSummary = (
  features: ReadonlyArray<CucumberJsonFeature>,
): {
  readonly summary: RunSummary;
  readonly executionDurationMillis: number;
  readonly scenarios: ReadonlyArray<ScenarioTiming>;
} => {
  const scenarios = features.flatMap((feature) =>
    feature.elements
      .filter((element) => element.type !== "background")
      .map((element) => cucumberScenario(feature, element)),
  );
  const failed = scenarios.filter((scenario) => scenario.failed).length;
  const durationMillis = scenarios.reduce((sum, scenario) => sum + scenario.durationMillis, 0);
  return {
    summary: {
      features: features.length,
      total: scenarios.length,
      passed: scenarios.length - failed,
      failed,
      durationMillis,
    },
    executionDurationMillis: durationMillis,
    scenarios: scenarios.map(({ feature, scenario, durationMillis }) => ({
      feature,
      scenario,
      durationMillis,
    })),
  };
};

const loadEffectBddFeatures = async (
  modules: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, Bdd.Feature<unknown, never>>> => {
  const loadedModules = await Promise.all(modules.map(loadModuleValues));
  const features = new Map<string, Bdd.Feature<unknown, never>>();
  for (const value of loadedModules.flat()) {
    if (isRunnableFeature(value)) {
      features.set(value.title, value);
    }
  }
  return features;
};

const loadModuleValues = async (modulePath: string): Promise<ReadonlyArray<unknown>> => {
  const loaded: unknown = await import(modulePath);
  return isRecord(loaded) ? Object.values(loaded) : [];
};

const isRunnableFeature = (value: unknown): value is Bdd.Feature<unknown, never> =>
  Bdd.isFeature(value);

const featureTitle = (source: string): string => {
  const match = /^Feature:\s*(.+)$/m.exec(source);
  if (match === null) {
    throw new Error("Feature source does not contain a Feature title");
  }
  return match[1]!;
};

const cucumberScenario = (
  feature: CucumberJsonFeature,
  element: CucumberJsonElement,
): {
  readonly feature: string;
  readonly scenario: string;
  readonly failed: boolean;
  readonly durationMillis: number;
} => ({
  feature: feature.name ?? "Unknown feature",
  scenario: element.name ?? "Unknown scenario",
  failed: element.steps.some((step) => step.result?.status !== "passed"),
  durationMillis:
    element.steps.reduce((sum, step) => sum + (step.result?.duration ?? 0), 0) / 1_000_000,
});

const parseEffectBddJsonReport = (value: unknown): EffectBddJsonReport => {
  if (!isRecord(value)) {
    throw new Error("effect-bdd JSON report must be an object");
  }
  return {
    summary: parseRunSummary(value.summary),
    scenarios: parseArray(value.scenarios, parseEffectBddScenario),
  };
};

const parseEffectBddTimingSidecar = (value: string): EffectBddTimingSidecar => {
  const reportEmissionMillis = Number(value.trim());
  if (!Number.isFinite(reportEmissionMillis) || reportEmissionMillis < 0) {
    throw new Error("effect-bdd timing sidecar must contain a non-negative duration");
  }
  return { reportEmissionMillis };
};

const parseEffectBddScenario = (value: unknown): EffectBddJsonReport["scenarios"][number] => {
  if (!isRecord(value)) {
    throw new Error("effect-bdd scenario result must be an object");
  }
  return {
    feature: stringProperty(value, "feature"),
    scenario: stringProperty(value, "scenario"),
    durationMillis: numberProperty(value, "durationMillis"),
    outcome: {
      status: "unknown",
    },
  };
};

const parseCucumberJson = (value: unknown): ReadonlyArray<CucumberJsonFeature> =>
  parseArray(value, parseCucumberFeature);

const parseCucumberFeature = (value: unknown): CucumberJsonFeature => {
  if (!isRecord(value)) {
    throw new Error("Cucumber JSON feature must be an object");
  }
  return {
    ...optionalStringProperty(value, "name"),
    elements: parseArray(value.elements ?? [], parseCucumberElement),
  };
};

const parseCucumberElement = (value: unknown): CucumberJsonElement => {
  if (!isRecord(value)) {
    throw new Error("Cucumber JSON element must be an object");
  }
  return {
    ...optionalStringProperty(value, "name"),
    ...optionalStringProperty(value, "type"),
    steps: parseArray(value.steps ?? [], parseCucumberStep),
  };
};

const parseCucumberStep = (value: unknown): CucumberJsonStep => {
  if (!isRecord(value)) {
    throw new Error("Cucumber JSON step must be an object");
  }
  if (!isRecord(value.result)) {
    return {};
  }
  return {
    result: {
      ...optionalStringProperty(value.result, "status"),
      ...optionalNumberProperty(value.result, "duration"),
    },
  };
};

const parseRunSummary = (value: unknown): RunSummary => {
  if (!isRecord(value)) {
    throw new Error("Run summary must be an object");
  }
  const durationMillis = optionalNumber(value.durationMillis);
  const phases = parseRunPhases(value.phases);
  return {
    features: numberProperty(value, "features"),
    total: numberProperty(value, "total"),
    passed: numberProperty(value, "passed"),
    failed: numberProperty(value, "failed"),
    ...(durationMillis === undefined ? {} : { durationMillis }),
    ...(phases === undefined ? {} : { phases }),
  };
};

const parseRunPhases = (value: unknown): RunSummary["phases"] | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    featureDiscoveryMillis: numberProperty(value, "featureDiscoveryMillis"),
    stepModuleLoadMillis: numberProperty(value, "stepModuleLoadMillis"),
    taskBuildMillis: numberProperty(value, "taskBuildMillis"),
    filteringMillis: numberProperty(value, "filteringMillis"),
    executionMillis: numberProperty(value, "executionMillis"),
    ...optionalNumberProperty(value, "reportEmissionMillis"),
  };
};

const parseArray = <A>(value: unknown, parseItem: (item: unknown) => A): ReadonlyArray<A> => {
  if (!Array.isArray(value)) {
    throw new Error("Expected an array");
  }
  return value.map(parseItem);
};

const stringProperty = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  if (typeof value === "string") {
    return value;
  }
  throw new Error(`Expected ${key} to be a string`);
};

const numberProperty = (record: Record<string, unknown>, key: string): number => {
  const value = record[key];
  if (typeof value === "number") {
    return value;
  }
  throw new Error(`Expected ${key} to be a number`);
};

const optionalStringProperty = (
  record: Record<string, unknown>,
  key: string,
): Record<string, string> => {
  const value = record[key];
  return typeof value === "string" ? { [key]: value } : {};
};

const optionalNumberProperty = (
  record: Record<string, unknown>,
  key: string,
): Record<string, number> => {
  const value = record[key];
  return typeof value === "number" ? { [key]: value } : {};
};

const optionalNumber = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
