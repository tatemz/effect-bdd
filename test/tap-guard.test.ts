import { Bdd } from "effect-bdd";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

describe("tap guard", () => {
  it("recognizes tap nodes in a scenario chain", () => {
    const feature = Bdd.feature("Taps").pipe(
      Bdd.scenario("Observes state").pipe(
        Bdd.given`a value`(() => Effect.succeed(1)),
        Bdd.tap(() => Effect.void),
      ),
    );
    const [step, tap] = feature.scenarios[0].steps;

    assert.strictEqual(Bdd.isTap(tap), true);
    assert.strictEqual(Bdd.isTap(step), false);
    assert.strictEqual(Bdd.isTap({ ...tap }), false);
    assert.strictEqual(Bdd.isTap(undefined), false);
  });
});
