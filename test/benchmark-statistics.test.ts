import { assert, describe, it } from "@effect/vitest";
import { durationStats, measurementStability, percentDelta } from "../benchmarks/src/statistics.ts";

describe("benchmark statistics", () => {
  it("calculates deterministic duration summaries", () => {
    const stats = durationStats([40, 10, 30, 20]);

    assert.deepStrictEqual(stats, {
      medianMillis: 25,
      meanMillis: 25,
      minMillis: 10,
      maxMillis: 40,
      p95Millis: 40,
      standardDeviationMillis: Math.sqrt(125),
      coefficientOfVariation: Math.sqrt(125) / 25,
    });
  });

  it("describes measurement stability without implying statistical confidence", () => {
    const stable = durationStats([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
    const noisy = durationStats([1, 100, 1, 100, 1, 100, 1, 100, 1, 100]);

    assert.strictEqual(measurementStability(4, stable), "low");
    assert.strictEqual(measurementStability(5, stable), "medium");
    assert.strictEqual(measurementStability(10, stable), "high");
    assert.strictEqual(measurementStability(10, noisy), "low");
  });

  it("computes deltas relative to the baseline", () => {
    assert.strictEqual(percentDelta(200, 150), -25);
    assert.strictEqual(percentDelta(200, 250), 25);
  });

  it("rejects empty samples", () => {
    assert.throws(() => durationStats([]), /empty duration sample/);
  });
});
