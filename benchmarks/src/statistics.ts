import type { BenchmarkRun, DurationStats, RunnerId, RunnerStats, Stability } from "./types.ts";

const mean = (values: ReadonlyArray<number>): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const median = (values: ReadonlyArray<number>): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1]! + sorted[midpoint]!) / 2
    : sorted[midpoint]!;
};

const percentile = (values: ReadonlyArray<number>, percentileValue: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))]!;
};

const standardDeviation = (values: ReadonlyArray<number>): number => {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};

export const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const percentDelta = (baseline: number, actual: number): number =>
  ((actual - baseline) / baseline) * 100;

export const durationStats = (durations: ReadonlyArray<number>): DurationStats => {
  if (durations.length === 0) {
    throw new Error("Cannot summarize an empty duration sample");
  }
  const average = mean(durations);
  const deviation = standardDeviation(durations);
  return {
    medianMillis: median(durations),
    meanMillis: average,
    minMillis: Math.min(...durations),
    maxMillis: Math.max(...durations),
    p95Millis: percentile(durations, 95),
    standardDeviationMillis: deviation,
    coefficientOfVariation: average === 0 ? 0 : deviation / average,
  };
};

export const measurementStability = (runs: number, wall: DurationStats): Stability => {
  if (hasLowStability(runs, wall)) {
    return "low";
  }
  return hasMediumStability(runs, wall) ? "medium" : "high";
};

const hasLowStability = (runs: number, wall: DurationStats): boolean =>
  runs < 5 || wall.coefficientOfVariation > 0.2;

const hasMediumStability = (runs: number, wall: DurationStats): boolean =>
  runs < 10 || wall.coefficientOfVariation > 0.1;

export const summarizeRunner = (
  runner: RunnerId,
  runs: ReadonlyArray<BenchmarkRun>,
): RunnerStats => {
  const wall = durationStats(runs.map((run) => run.wallDurationMillis));
  const execution = executionStats(runs);
  const scenarioTotal = runs[0]?.summary.total ?? 0;
  return {
    runner,
    runs: runs.length,
    stability: measurementStability(runs.length, wall),
    wall,
    ...optionalExecutionStats(execution),
    wallScenariosPerSecond: scenariosPerSecond(scenarioTotal, wall),
    ...optionalExecutionRate(scenarioTotal, execution),
  };
};

const executionStats = (runs: ReadonlyArray<BenchmarkRun>): DurationStats | undefined => {
  const durations = runs.flatMap((run) =>
    run.executionDurationMillis === undefined ? [] : [run.executionDurationMillis],
  );
  return durations.length === 0 ? undefined : durationStats(durations);
};

const optionalExecutionStats = (
  execution: DurationStats | undefined,
): Pick<RunnerStats, "execution"> | {} => (execution === undefined ? {} : { execution });

const optionalExecutionRate = (
  scenarioTotal: number,
  execution: DurationStats | undefined,
): Pick<RunnerStats, "executionScenariosPerSecond"> | {} =>
  execution === undefined
    ? {}
    : { executionScenariosPerSecond: scenariosPerSecond(scenarioTotal, execution) };

const scenariosPerSecond = (scenarioTotal: number, stats: DurationStats): number =>
  scenarioTotal === 0 ? 0 : scenarioTotal / (stats.medianMillis / 1000);
