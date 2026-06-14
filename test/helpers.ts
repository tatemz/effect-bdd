import { Bdd } from "effect-bdd";
import { assert } from "@effect/vitest";
import { Cause, Effect, Option } from "effect";

export const runBdd = <E, R>(
  feature: Bdd.Feature<E, R>,
  source: string,
  options?: Bdd.RunOptions,
) => Bdd.run(feature, source, options).pipe(Effect.provide(Bdd.layerCucumber));

export const runError = <A, R>(
  effect: Effect.Effect<A, Bdd.RunError, R>,
): Effect.Effect<Bdd.RunError, never, R> =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(effect);
    assert.strictEqual(result._tag, "Failure");
    if (result._tag === "Failure") {
      return Option.getOrThrow(Cause.findErrorOption(result.cause));
    }
    return yield* Effect.die("expected Bdd.run to fail");
  });

export const assertMatchError = (
  effect: Effect.Effect<unknown, Bdd.RunError>,
  message: RegExp = /MatchError/,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const error = yield* runError(effect);
    assert.strictEqual(error._tag, "MatchError");
    assert.match(error.message, message);
  });
