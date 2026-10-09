import { Bdd } from "effect-bdd";
import { Effect, Result, Schema } from "effect";
import * as Counter from "./counter.ts";

/**
 * The state a counter scenario carries: the latest domain outcome, passed
 * to each step as-is. `undefined` means no counter exists yet; a failure
 * holds the rejection of the latest change attempt.
 */
type CounterState = Result.Result<Counter.Counter | undefined, Counter.CounterRejection>;

/** The seed state for scenarios that begin with no counter. */
const noCounter: CounterState = Result.succeed(undefined);

/** Captures how many times a step repeats a counter change. */
const count = Bdd.capture("count", Schema.FiniteFromString.check(Schema.isGreaterThanOrEqualTo(0)));

/** Captures the counter value a `Then` step expects. */
const expectedValue = Bdd.capture("expectedValue", Schema.FiniteFromString);

/**
 * The canonical Counter behavior as executable BDD.
 *
 * Steps are defined inline in each scenario pipe. The scenario state is the
 * domain `Result` itself: each step hands the previous result to the next
 * domain call instead of unwrapping and re-wrapping it, and returns the new
 * state explicitly. `Bdd.tap` and `Bdd.tapError` observe the run without
 * changing it: the feature tap reports every step's state, and the feature
 * error tap reports any failure's tag and message before the scenario
 * still fails with the original error.
 */
export const counter = Bdd.feature("Counter").pipe(
  Bdd.tapError((failure) => {
    const where = failure._tag === "TapError" ? failure.scenario : failure.message;
    return Effect.logError(`[Counter] failure in ${where}: ${failure._tag} - ${failure.message}`);
  }),
  Bdd.tap((state) => {
    return Effect.log(`[Counter] step state: ${JSON.stringify(state)}`);
  }),
  Bdd.scenario("Creating a counter").pipe(
    Bdd.given`no counter exists`(() => {
      return Effect.succeed(noCounter);
    }),
    Bdd.when`the counter is created`((counter) => {
      return Effect.sync(() => Result.flatMap(counter, (existing) => Counter.create(existing)));
    }),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, counter) => {
      return Effect.gen(function* () {
        if (Result.isFailure(counter)) {
          return yield* Effect.fail("Expected a counter to exist.");
        }
        if (counter.success.value !== expectedValue) {
          return yield* Effect.fail(
            `Expected counter value ${expectedValue}, got ${counter.success.value}.`,
          );
        }
        return counter;
      });
    }),
    Bdd.then`the counter is active`((counter) => {
      return Effect.gen(function* () {
        if (Result.isFailure(counter) || !counter.success.active) {
          return yield* Effect.fail("Expected the counter to be active.");
        }
        return counter;
      });
    }),
  ),
  Bdd.scenario("A counter is created only once").pipe(
    Bdd.given`a counter was created`(() => {
      return Effect.succeed(Counter.create(undefined));
    }),
    Bdd.when`the counter is created again`((counter) => {
      return Effect.sync(() => Result.flatMap(counter, Counter.create));
    }),
    Bdd.then`the change is rejected because the counter already exists`((counter) => {
      return Effect.gen(function* () {
        if (!Result.isFailure(counter)) {
          return yield* Effect.fail("Expected the change to be rejected.");
        }
        if (counter.failure !== "AlreadyExists") {
          return yield* Effect.fail(`Expected rejection AlreadyExists, got ${counter.failure}.`);
        }
        return counter;
      });
    }),
  ),
  Bdd.scenario("Counting up").pipe(
    Bdd.given`a counter was created`(() => {
      return Effect.succeed(Counter.create(undefined));
    }),
    Bdd.when`the counter is incremented ${count} times`(({ count }, counter: CounterState) => {
      return Effect.sync(() => {
        return Array.from({ length: count }).reduce(
          (current: CounterState) => Result.flatMap(current, Counter.increment),
          counter,
        );
      });
    }),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, counter: CounterState) => {
      return Effect.gen(function* () {
        if (Result.isFailure(counter)) {
          return yield* Effect.fail("Expected a counter to exist.");
        }
        const counterValue = counter.success?.value;
        if (counterValue !== expectedValue) {
          return yield* Effect.fail(
            `Expected counter value ${expectedValue}, got ${counterValue ?? "none"}.`,
          );
        }
        return counter;
      });
    }),
  ),
  Bdd.scenario("Counting down").pipe(
    Bdd.given`a counter at value ${count}`(({ count }) => {
      return Effect.succeed(
        Array.from({ length: count }).reduce(
          (current: CounterState) => Result.flatMap(current, Counter.increment),
          Counter.create(undefined),
        ),
      );
    }),
    Bdd.when`the counter is decremented`((counter) => {
      return Effect.sync(() => Result.flatMap(counter, Counter.decrement));
    }),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, counter) => {
      return Effect.gen(function* () {
        if (Result.isFailure(counter)) {
          return yield* Effect.fail("Expected a counter to exist.");
        }
        if (counter.success.value !== expectedValue) {
          return yield* Effect.fail(
            `Expected counter value ${expectedValue}, got ${counter.success.value}.`,
          );
        }
        return counter;
      });
    }),
  ),
  Bdd.scenario("The counter never counts above 5").pipe(
    Bdd.given`a counter at value ${count}`(({ count }) => {
      return Effect.succeed(
        Array.from({ length: count }).reduce(
          (current: CounterState) => Result.flatMap(current, Counter.increment),
          Counter.create(undefined),
        ),
      );
    }),
    Bdd.when`the counter is incremented`((counter) => {
      return Effect.sync(() => Result.flatMap(counter, Counter.increment));
    }),
    Bdd.then`the change is rejected because the counter reached its maximum`((counter) => {
      return Effect.gen(function* () {
        if (!Result.isFailure(counter)) {
          return yield* Effect.fail("Expected the change to be rejected.");
        }
        if (counter.failure !== "MaximumReached") {
          return yield* Effect.fail(`Expected rejection MaximumReached, got ${counter.failure}.`);
        }
        return counter;
      });
    }),
  ),
  Bdd.scenario("The counter never counts below 0").pipe(
    Bdd.given`a counter was created`(() => {
      return Effect.succeed(Counter.create(undefined));
    }),
    Bdd.when`the counter is decremented`((counter) => {
      return Effect.sync(() => Result.flatMap(counter, Counter.decrement));
    }),
    Bdd.then`the change is rejected because the counter reached its minimum`((counter) => {
      return Effect.gen(function* () {
        if (!Result.isFailure(counter)) {
          return yield* Effect.fail("Expected the change to be rejected.");
        }
        if (counter.failure !== "MinimumReached") {
          return yield* Effect.fail(`Expected rejection MinimumReached, got ${counter.failure}.`);
        }
        return counter;
      });
    }),
  ),
  Bdd.scenario("Disabling a counter freezes it").pipe(
    Bdd.given`a counter at value ${count}`(({ count }) => {
      return Effect.succeed(
        Array.from({ length: count }).reduce(
          (current: CounterState) => Result.flatMap(current, Counter.increment),
          Counter.create(undefined),
        ),
      );
    }),
    Bdd.when`the counter is disabled`((counter) => {
      return Effect.sync(() => Result.flatMap(counter, Counter.disable));
    }),
    Bdd.when`the counter is incremented`((counter) => {
      return Effect.sync(() => Result.flatMap(counter, Counter.increment));
    }),
    Bdd.then`the change is rejected because the counter is disabled`((counter) => {
      return Effect.gen(function* () {
        if (!Result.isFailure(counter)) {
          return yield* Effect.fail("Expected the change to be rejected.");
        }
        if (counter.failure !== "Disabled") {
          return yield* Effect.fail(`Expected rejection Disabled, got ${counter.failure}.`);
        }
        return counter;
      });
    }),
  ),
  Bdd.scenario("A missing counter cannot change").pipe(
    Bdd.given`no counter exists`(() => {
      return Effect.succeed(noCounter);
    }),
    Bdd.when`the counter is incremented`((counter) => {
      return Effect.sync(() => Result.flatMap(counter, Counter.increment));
    }),
    Bdd.then`the change is rejected because the counter does not exist`((counter) => {
      return Effect.gen(function* () {
        if (!Result.isFailure(counter)) {
          return yield* Effect.fail("Expected the change to be rejected.");
        }
        if (counter.failure !== "DoesNotExist") {
          return yield* Effect.fail(`Expected rejection DoesNotExist, got ${counter.failure}.`);
        }
        return counter;
      });
    }),
  ),
);
