import { assert, describe, it } from "@effect/vitest";
import { Duration } from "effect";
import { parseStepTimeout } from "../src/main.ts";

describe("parseStepTimeout", () => {
  it("accepts finite durations", () => {
    assert.strictEqual(Duration.format(parseStepTimeout("1.5 seconds")), "1s 500ms");
  });

  it("accepts the documented Infinity literal", () => {
    const duration = parseStepTimeout("Infinity");

    assert.strictEqual(Duration.isPositive(duration), true);
    assert.strictEqual(Duration.isFinite(duration), false);
  });

  it("rejects negative infinity", () => {
    assert.throws(() => parseStepTimeout("-Infinity"), /positive Effect duration/);
  });
});
