import type { BenchmarkRun, RunnerId, RunnerStats } from "./types.ts";

const mean = (values: ReadonlyArray<number>): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const median = (values: ReadonlyArray<number>): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1]! + sorted[midpoint]!) / 2
    : sorted[midpoint]!;
};

export const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const percentDelta = (baseline: number, actual: number): number =>
  ((actual - baseline) / baseline) * 100;

export const summarizeRunner = (
  runner: RunnerId,
  runs: ReadonlyArray<BenchmarkRun>,
): RunnerStats => {
  const durations = runs.map((run) => run.wallDurationMillis);
  const scenarioTotal = runs[0]?.summary.total ?? 0;
  const medianMillis = median(durations);
  return {
    runner,
    runs: runs.length,
    medianMillis,
    meanMillis: mean(durations),
    minMillis: Math.min(...durations),
    maxMillis: Math.max(...durations),
    scenariosPerSecond: scenarioTotal === 0 ? 0 : scenarioTotal / (medianMillis / 1000),
  };
};
