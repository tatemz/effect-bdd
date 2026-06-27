import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { resultsRoot } from "./paths.ts";
import { runCucumberJs, runEffectBddApi, runEffectBddCli } from "./runners.ts";
import { suiteById, suites } from "./suites.ts";
import { summarizeRunner } from "./statistics.ts";
import type {
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
  const suiteResults = await selectedSuites.reduce<Promise<ReadonlyArray<SuiteResult>>>(
    async (previousResults, suite) => [
      ...(await previousResults),
      await runSuiteBenchmark(suite, config),
    ],
    Promise.resolve([]),
  );

  const result: BenchmarkResult = {
    generatedAt: new Date().toISOString(),
    environment: environment(),
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
      ...(await runSuite(suite, phase, index + 1, parallel)),
    ],
    Promise.resolve([]),
  );

const runSuite = async (
  suite: SuiteDefinition,
  phase: BenchmarkRun["phase"],
  iteration: number,
  parallel: number,
): Promise<ReadonlyArray<BenchmarkRun>> => [
  await runEffectBddCli(suite, phase, iteration, parallel),
  await runCucumberJs(suite, phase, iteration, parallel),
  await runEffectBddApi(suite, phase, iteration),
];

const parseCli = (): {
  readonly config: BenchmarkConfig;
  readonly outputFile: string;
  readonly selectedSuites: ReadonlyArray<SuiteDefinition>;
} => {
  const parsed = parseArgs({
    args: normalizedArgs(),
    options: {
      iterations: { type: "string", default: "5" },
      warmups: { type: "string", default: "1" },
      parallel: { type: "string", default: "1" },
      out: { type: "string", default: path.join(resultsRoot, "latest.json") },
      suite: { type: "string", multiple: true },
    },
  });
  const suiteIds = parsed.values.suite ?? suites.map((suite) => suite.id);
  const selectedSuites = suiteIds.map((id) => {
    const suite = suiteById(id);
    if (suite === undefined) {
      throw new Error(
        `Unknown benchmark suite "${id}". Known suites: ${suites.map((s) => s.id).join(", ")}`,
      );
    }
    return suite;
  });
  return {
    config: {
      iterations: positiveInteger("iterations", parsed.values.iterations),
      warmups: nonNegativeInteger("warmups", parsed.values.warmups),
      parallel: positiveInteger("parallel", parsed.values.parallel),
    },
    outputFile: parsed.values.out,
    selectedSuites,
  };
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

const environment = (): BenchmarkEnvironment => {
  const cpus = os.cpus();
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpus[0]?.model ?? "unknown",
    cpuCount: cpus.length,
  };
};

await main();
