import { assert, describe, it } from "@effect/vitest";
import { renderHtml, renderMarkdown } from "../benchmarks/src/report.ts";
import type {
  BenchmarkResult,
  BenchmarkRun,
  RunnerId,
  RunnerStats,
} from "../benchmarks/src/types.ts";

const runnerStats = (runner: RunnerId, medianMillis: number): RunnerStats => ({
  runner,
  runs: 2,
  stability: "low",
  wall: {
    medianMillis,
    meanMillis: medianMillis,
    minMillis: medianMillis,
    maxMillis: medianMillis,
    p95Millis: medianMillis,
    standardDeviationMillis: 0,
    coefficientOfVariation: 0,
  },
  ...(runner === "effect-bdd-api"
    ? {}
    : {
        execution: {
          medianMillis: medianMillis / 2,
          meanMillis: medianMillis / 2,
          minMillis: medianMillis / 2,
          maxMillis: medianMillis / 2,
          p95Millis: medianMillis / 2,
          standardDeviationMillis: 0,
          coefficientOfVariation: 0,
        },
        executionScenariosPerSecond: 200,
      }),
  wallScenariosPerSecond: 100,
});

const effectRun = (
  iteration: number,
  featureDiscoveryMillis: number,
  executionMillis: number,
): BenchmarkRun => ({
  suiteId: "counter",
  runner: "effect-bdd-cli",
  phase: "measured",
  iteration,
  command: "node",
  args: [],
  cwd: "/repo",
  exitCode: 0,
  wallDurationMillis: 100,
  executionDurationMillis: executionMillis,
  summary: {
    features: 1,
    total: 10,
    passed: 10,
    failed: 0,
    phases: {
      featureDiscoveryMillis,
      stepModuleLoadMillis: 20,
      taskBuildMillis: 10,
      filteringMillis: 1,
      executionMillis,
      reportEmissionMillis: iteration === 1 ? 5 : 7,
    },
  },
  scenarios: [],
});

const result: BenchmarkResult = {
  generatedAt: "2026-07-09T00:00:00.000Z",
  environment: {
    node: "v24.0.0",
    platform: "darwin",
    arch: "arm64",
    cpuModel: "Test CPU",
    cpuCount: 8,
    gitCommit: "abc123",
    packageVersions: {},
  },
  config: {
    iterations: 2,
    warmups: 0,
    parallel: 1,
    profile: "tsx",
    generatedScale: {
      parseFeatures: 1,
      parseScenariosPerFeature: 1,
      outlineExamples: 1,
      discoveryFeatures: 1,
      discoveryScenariosPerFeature: 1,
      parallelScenarios: 1,
      reporterScenarios: 1,
    },
  },
  suites: [
    {
      id: "counter",
      name: "Counter",
      description: "Counter benchmark",
      stats: [
        runnerStats("effect-bdd-cli", 100),
        runnerStats("cucumber-js", 120),
        runnerStats("effect-bdd-api", 20),
      ],
      runs: [effectRun(1, 10, 30), effectRun(2, 30, 50)],
    },
  ],
};

describe("benchmark reports", () => {
  it("separates CLI comparisons from the in-process API baseline", () => {
    const markdown = renderMarkdown(result);

    assert.match(markdown, /Runner work metric/);
    assert.match(markdown, /execution phase/);
    assert.match(markdown, /summed step duration/);
    assert.match(markdown, /In-process effect-bdd API baseline \(not CLI-comparable\)/);
    assert.strictEqual(/Confidence/.test(markdown), false);
  });

  it("aggregates phase timing across measured runs", () => {
    const markdown = renderMarkdown(result);
    const html = renderHtml(result);

    assert.match(markdown, /Feature discovery: median 20ms, p95 30ms/);
    assert.match(markdown, /Execution: median 40ms, p95 50ms/);
    assert.match(markdown, /Report emission: median 6ms, p95 7ms/);
    assert.strictEqual(/first measured run/.test(markdown), false);
    assert.match(html, /Feature discovery median 20ms, p95 30ms/);
  });
});
