import { Bdd } from "effect-bdd";
import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import { runBdd, runError } from "./helpers.ts";

class Boom extends Context.Service<Boom, { readonly value: number }>()("Boom") {}

const tapLog = (seen: Array<string>) =>
  Bdd.tapError((failure) =>
    Effect.sync(() => {
      seen.push(failure._tag);
    }),
  );

const source = `
Feature: Error taps

  Scenario: Failure
    Given a word
`;

const runFailure = <E, R>(feature: Bdd.Feature<E, R>) => runError(runBdd(feature, source));

const featureWith = <E, R>(seen: Array<string>, provider: Layer.Layer<Boom, E, R>) =>
  Bdd.feature("Error taps").pipe(
    Bdd.scenario("Failure").pipe(
      Bdd.given`a word`(() => Effect.succeed("one")),
      Bdd.provide(provider),
      tapLog(seen),
    ),
  );

describe("scenario error taps", () => {
  it.effect("observes setup and teardown failures", () => {
    const setupSeen: Array<string> = [];
    const teardownSeen: Array<string> = [];
    const setup = featureWith(setupSeen, Layer.effect(Boom, Effect.fail("setup failed" as const)));
    const teardown = featureWith(
      teardownSeen,
      Layer.effect(
        Boom,
        Effect.acquireRelease(Effect.succeed({ value: 1 }), () =>
          Effect.fail("teardown failed" as const),
        ),
      ),
    );

    return Effect.gen(function* () {
      const setupError = yield* runFailure(setup);
      const teardownError = yield* runFailure(teardown);

      assert.strictEqual(setupError._tag, "ScenarioSetupError");
      assert.deepStrictEqual(setupSeen, ["ScenarioSetupError"]);
      assert.strictEqual(teardownError._tag, "ScenarioTeardownError");
      assert.deepStrictEqual(teardownSeen, ["ScenarioTeardownError"]);
    });
  });
});
