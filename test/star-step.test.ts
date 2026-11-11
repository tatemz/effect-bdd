import { Bdd } from "effect-bdd";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { runBdd, runError } from "./helpers.ts";

describe("star steps", () => {
  it.effect("run through keyword-agnostic step definitions", () => {
    const feature = Bdd.feature("Star steps").pipe(
      Bdd.scenario("Uses star").pipe(
        Bdd.step`an empty cart`(() => Effect.succeed(0)),
        Bdd.step`the counter is incremented`((state: number) => Effect.succeed(state + 1)),
        Bdd.step`the counter value is 1`((state: number) => Effect.succeed(state)),
      ),
    );

    return Effect.gen(function* () {
      const report = yield* runBdd(
        feature,
        `
Feature: Star steps

  Scenario: Uses star
    * an empty cart
    * the counter is incremented
    * the counter value is 1
`,
      );

      assert.deepStrictEqual(report.scenarios, [{ title: "Uses star", steps: 3, tags: [] }]);
    });
  });

  it.effect("reject concrete step keywords", () => {
    const feature = Bdd.feature("Star steps").pipe(
      Bdd.scenario("Uses star").pipe(Bdd.given`an empty cart`(() => Effect.succeed(0))),
    );

    return Effect.gen(function* () {
      const error = yield* runError(
        runBdd(
          feature,
          `
Feature: Star steps

  Scenario: Uses star
    * an empty cart
`,
        ),
      );

      assert.strictEqual(error._tag, "MatchError");
      if (error._tag === "MatchError") {
        assert.match(error.message, /source is \*, chain expects Given/);
      }
    });
  });
});
