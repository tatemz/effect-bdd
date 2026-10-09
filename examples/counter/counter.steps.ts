import { Bdd } from "effect-bdd";
import { Effect, Result, Schema } from "effect";
import * as Counter from "./counter.ts";

/** Captures how many times a step repeats a counter change. */
const count = Bdd.capture("count", Schema.FiniteFromString.check(Schema.isGreaterThanOrEqualTo(0)));

/** Captures the counter value a `Then` step expects. */
const expectedValue = Bdd.capture("expectedValue", Schema.FiniteFromString);

/** Reads the value of an existing counter, for value assertions. */
const valueOf = (state: Counter.CounterState): number | undefined =>
  Result.getOrElse(state, () => undefined)?.value;

/** Asserts the counter holds the expected value and returns the state. */
const expectValue = (
  state: Counter.CounterState,
  expected: number,
): Effect.Effect<Counter.CounterState, string> =>
  valueOf(state) === expected
    ? Effect.succeed(state)
    : Effect.fail(`Expected counter value ${expected}, got ${valueOf(state) ?? "none"}.`);

/**
 * The canonical Counter behavior as executable BDD.
 *
 * Steps are defined inline in each scenario pipe. The scenario state is the
 * domain `CounterState` itself: each step hands the previous state to the next
 * domain call instead of unwrapping and re-wrapping it, and returns the new
 * state explicitly. `Bdd.tap` and `Bdd.tapError` observe the run without
 * changing it: a scenario tap runs at its chain position, a feature tap runs
 * once after the scenario declared before it, and a `tapError` observes the
 * failures of what was declared before it while the scenario still fails
 * with the original error.
 */
export const counter = Bdd.feature("Counter").pipe(
  Bdd.scenario("Creating a counter").pipe(
    Bdd.given`no counter exists`(() => {
      return Effect.succeed(Counter.missing);
    }),
    Bdd.when`the counter is created`((counter) => {
      return Effect.sync(() => Counter.create(counter));
    }),
    Bdd.tap((counter) => {
      return Effect.log(`[Counter] created state: ${JSON.stringify(counter)}`);
    }),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, counter) => {
      return expectValue(counter, expectedValue);
    }),
  ),
  Bdd.tap((state) => {
    return Effect.log(`[Counter] after "Creating a counter": ${JSON.stringify(state)}`);
  }),
  Bdd.scenario("A counter is created only once").pipe(
    Bdd.given`a counter was created`(() => {
      return Effect.succeed(Counter.create(Counter.missing));
    }),
    Bdd.when`the counter is created again`((counter) => {
      return Effect.sync(() => Counter.create(counter));
    }),
    Bdd.then`the change is rejected because the counter already exists`((counter) => {
      return Effect.gen(function* () {
        if (Result.isFailure(counter) && counter.failure === "AlreadyExists") {
          return counter;
        }
        return yield* Effect.fail("Expected the change to be rejected with AlreadyExists.");
      });
    }),
  ),
  Bdd.scenario("Counting up").pipe(
    Bdd.given`a counter was created`(() => {
      return Effect.succeed(Counter.create(Counter.missing));
    }),
    Bdd.when`the counter is incremented ${count} times`(({ count }, counter) => {
      return Effect.sync(() =>
        Array.from({ length: count }).reduce(
          (current: Counter.CounterState) => Counter.increment(current),
          counter,
        ),
      );
    }),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, counter) => {
      return expectValue(counter, expectedValue);
    }),
  ),
  Bdd.scenario("Counting down").pipe(
    Bdd.given`a counter at value ${count}`(({ count }) => {
      return Effect.succeed(
        Array.from({ length: count }).reduce(
          (current: Counter.CounterState) => Counter.increment(current),
          Counter.create(Counter.missing),
        ),
      );
    }),
    Bdd.when`the counter is decremented`((counter) => {
      return Effect.sync(() => Counter.decrement(counter));
    }),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, counter) => {
      return expectValue(counter, expectedValue);
    }),
  ),
  Bdd.scenario("A missing counter cannot change").pipe(
    Bdd.given`no counter exists`(() => {
      return Effect.succeed(Counter.missing);
    }),
    Bdd.when`the counter is incremented`((counter) => {
      return Effect.sync(() => Counter.increment(counter));
    }),
    Bdd.tapError((failure) => {
      return Effect.logError(`[Counter] ${failure._tag}: ${failure.message}`);
    }),
    Bdd.then`the change is rejected because the counter does not exist`((counter) => {
      return Effect.gen(function* () {
        if (Result.isFailure(counter) && counter.failure === "DoesNotExist") {
          return counter;
        }
        return yield* Effect.fail("Expected the change to be rejected with DoesNotExist.");
      });
    }),
  ),
);
