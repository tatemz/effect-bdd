import { Bdd } from "effect-bdd";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { runBdd, runError } from "./helpers.ts";

describe("scenario error taps", () => {
  it.effect("stays attached when a later step is appended", () => {
    const observed: Array<string> = [];
    const feature = Bdd.feature("Error taps").pipe(
      Bdd.scenario("Appended step").pipe(
        Bdd.given`a word`(() => Effect.succeed("one")),
        Bdd.tapError((failure) =>
          Effect.sync(() => {
            observed.push(failure._tag);
          }),
        ),
        Bdd.when`the action fails`(() => Effect.fail("boom" as const)),
      ),
    );

    return Effect.gen(function* () {
      const error = yield* runError(
        runBdd(
          feature,
          `
Feature: Error taps

  Scenario: Appended step
    Given a word
    When the action fails
`,
        ),
      );

      assert.strictEqual(error._tag, "StepError");
      assert.deepStrictEqual(observed, ["StepError"]);
    });
  });
});
