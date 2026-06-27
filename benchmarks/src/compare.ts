import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { assertSuccessful, runCommand } from "./process.ts";
import { benchmarkRoot, fromRepoRoot, resultsRoot } from "./paths.ts";
import { runCucumberJs, runEffectBddApi, runEffectBddCli } from "./runners.ts";
import { ensureGeneratedSuites } from "./generatedSuites.ts";
import { suiteById, suites } from "./suites.ts";
import { summarizeRunner } from "./statistics.ts";
import type {
  BenchmarkProfile,
  BenchmarkConfig,
  BenchmarkEnvironment,
  BenchmarkResult,
  BenchmarkRun,
  RunnerId,
  SuiteDefinition,
  SuiteResult,
} from "./types.ts";

const runnerOrder: ReadonlyArray<RunnerId> = ["effect-bdd-cli", "cucumber-js", "effect-bdd-api"];

const main = async (): Promise<void> => {
  const { config, outputFile, selectedSuites } = parseCli();
  await ensureGeneratedSuites();
  const suiteResults = await selectedSuites.reduce<Promise<ReadonlyArray<SuiteResult>>>(
    async (previousResults, suite) => [
      ...(await previousResults),
      await runSuiteBenchmark(suite, config),
    ],
    Promise.resolve([]),
  );

  const result: BenchmarkResult = {
    generatedAt: new Date().toISOString(),
    environment: await environment(),
    config,
    suites: suiteResults,
  };

  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Wrote ${outputFile}`);
};

const runSuiteBenchmark = async (
  suite: SuiteDefinition,
  config: BenchmarkConfig,
): Promise<SuiteResult> => {
  console.log(`Benchmarking ${suite.id}`);
  const runs = [
    ...(await runIterations(suite, "warmup", config.warmups, config.parallel)),
    ...(await runIterations(suite, "measured", config.iterations, config.parallel)),
  ];
  const measuredRuns = runs.filter((run) => run.phase === "measured");
  return {
    id: suite.id,
    name: suite.name,
    description: suite.description,
    stats: runnerOrder.map((runner) =>
      summarizeRunner(
        runner,
        measuredRuns.filter((run) => run.runner === runner),
      ),
    ),
    runs,
  };
};

const runIterations = (
  suite: SuiteDefinition,
  phase: BenchmarkRun["phase"],
  iterations: number,
  parallel: number,
): Promise<ReadonlyArray<BenchmarkRun>> =>
  Array.from({ length: iterations }).reduce<Promise<ReadonlyArray<BenchmarkRun>>>(
    async (previousRuns, _, index) => [
      ...(await previousRuns),
      ...(await runSuite(
        suite,
        phase,
        index + 1,
        parallel,
        suite.supportsCompiled === false ? "tsx" : configProfile(),
      )),
    ],
    Promise.resolve([]),
  );

const runSuite = async (
  suite: SuiteDefinition,
  phase: BenchmarkRun["phase"],
  iteration: number,
  parallel: number,
  profile: BenchmarkProfile,
): Promise<ReadonlyArray<BenchmarkRun>> =>
  runnerOrderFor(iteration).reduce<Promise<ReadonlyArray<BenchmarkRun>>>(
    async (previousRuns, runner) => [
      ...(await previousRuns),
      await runRunner(runner, suite, phase, iteration, parallel, profile),
    ],
    Promise.resolve([]),
  );

let activeProfile: BenchmarkProfile = "tsx";

const configProfile = (): BenchmarkProfile => activeProfile;

const runnerOrderFor = (iteration: number): ReadonlyArray<RunnerId> => {
  const offset = (iteration - 1) % runnerOrder.length;
  return [...runnerOrder.slice(offset), ...runnerOrder.slice(0, offset)];
};

const runRunner = (
  runner: RunnerId,
  suite: SuiteDefinition,
  phase: BenchmarkRun["phase"],
  iteration: number,
  parallel: number,
  profile: BenchmarkProfile,
): Promise<BenchmarkRun> => {
  switch (runner) {
    case "effect-bdd-cli": {
      return runEffectBddCli(suite, phase, iteration, parallel, profile);
    }
    case "cucumber-js": {
      return runCucumberJs(suite, phase, iteration, parallel, profile);
    }
    case "effect-bdd-api": {
      return runEffectBddApi(suite, phase, iteration);
    }
  }
};

const parseCli = (): {
  readonly config: BenchmarkConfig;
  readonly outputFile: string;
  readonly selectedSuites: ReadonlyArray<SuiteDefinition>;
} => {
  const parsed = parseArgs({
    args: normalizedArgs(),
    options: {
      iterations: { type: "string", default: "20" },
      warmups: { type: "string", default: "3" },
      parallel: { type: "string", default: "1" },
      profile: { type: "string", default: "tsx" },
      out: { type: "string", default: path.join(resultsRoot, "latest.json") },
      suite: { type: "string", multiple: true },
    },
  });
  activeProfile = benchmarkProfile(parsed.values.profile);
  const explicitSuiteSelection = parsed.values.suite !== undefined;
  const availableSuites =
    activeProfile === "compiled"
      ? suites.filter((suite) => suite.supportsCompiled !== false)
      : suites;
  const suiteIds = parsed.values.suite ?? availableSuites.map((suite) => suite.id);
  const selectedSuites = suiteIds.map((id) =>
    selectedSuite(id, activeProfile, explicitSuiteSelection),
  );
  return {
    config: {
      iterations: positiveInteger("iterations", parsed.values.iterations),
      warmups: nonNegativeInteger("warmups", parsed.values.warmups),
      parallel: positiveInteger("parallel", parsed.values.parallel),
      profile: activeProfile,
    },
    outputFile: parsed.values.out,
    selectedSuites,
  };
};

const selectedSuite = (
  id: string,
  profile: BenchmarkProfile,
  explicitSuiteSelection: boolean,
): SuiteDefinition => {
  const suite = knownSuite(id);
  assertSupportedSuite(suite, profile, explicitSuiteSelection);
  return suite;
};

const knownSuite = (id: string): SuiteDefinition => {
  const suite = suiteById(id);
  if (suite !== undefined) {
    return suite;
  }
  throw new Error(
    `Unknown benchmark suite "${id}". Known suites: ${suites.map((s) => s.id).join(", ")}`,
  );
};

const assertSupportedSuite = (
  suite: SuiteDefinition,
  profile: BenchmarkProfile,
  explicitSuiteSelection: boolean,
): void => {
  if (explicitSuiteSelection && profile === "compiled" && suite.supportsCompiled === false) {
    throw new Error(
      `Suite "${suite.id}" is generated at runtime and does not support --profile compiled`,
    );
  }
};

const benchmarkProfile = (value: string | undefined): BenchmarkProfile => {
  if (value === "tsx" || value === "compiled") {
    return value;
  }
  throw new Error(`Expected --profile to be "tsx" or "compiled", got ${value ?? "undefined"}`);
};

const normalizedArgs = (): ReadonlyArray<string> =>
  process.argv.slice(2).filter((arg) => arg !== "--");

const positiveInteger = (name: string, value: string | undefined): number => {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  throw new Error(`Expected --${name} to be a positive integer, got ${value ?? "undefined"}`);
};

const nonNegativeInteger = (name: string, value: string | undefined): number => {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }
  throw new Error(`Expected --${name} to be a non-negative integer, got ${value ?? "undefined"}`);
};

const environment = async (): Promise<BenchmarkEnvironment> => {
  const cpus = os.cpus();
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpus[0]?.model ?? "unknown",
    cpuCount: cpus.length,
    gitCommit: await gitCommit(),
    packageVersions: await packageVersions(),
  };
};

const gitCommit = async (): Promise<string> => {
  const result = await runCommand("git", ["rev-parse", "HEAD"], { cwd: fromRepoRoot() });
  assertSuccessful(result);
  return result.stdout.trim();
};

const packageVersions = async (): Promise<Readonly<Record<string, string>>> => {
  const rootPackage = parsePackageJson(
    JSON.parse(await fs.readFile(fromRepoRoot("package.json"), "utf8")),
  );
  const benchmarkPackage = parsePackageJson(
    JSON.parse(await fs.readFile(path.join(benchmarkRoot, "package.json"), "utf8")),
  );
  return {
    "effect-bdd": rootPackage.version,
    effect: benchmarkPackage.dependencies.effect,
    "@cucumber/cucumber": benchmarkPackage.devDependencies["@cucumber/cucumber"],
    tsx: benchmarkPackage.devDependencies.tsx,
  };
};

const parsePackageJson = (
  value: unknown,
): {
  readonly version: string;
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
} => {
  if (!isRecord(value)) {
    throw new Error("Expected package.json to be an object");
  }
  return {
    version: stringValue(value.version, "unknown"),
    dependencies: recordValue(value.dependencies),
    devDependencies: recordValue(value.devDependencies),
  };
};

const stringValue = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const recordValue = (value: unknown): Record<string, string> =>
  isRecord(value) ? stringRecord(value) : {};

const stringRecord = (record: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

await main();
