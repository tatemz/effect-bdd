import { Bdd } from "effect-bdd";
import { Effect, Schema } from "effect";
import * as Counter from "./counter.ts";

/** Captures how many times a step repeats a counter change. */
const count = Bdd.capture("count", Schema.FiniteFromString.check(Schema.isGreaterThanOrEqualTo(0)));

/** Captures the counter value a `Then` step expects. */
const expectedValue = Bdd.capture("expectedValue", Schema.FiniteFromString);

/** Reads the counter value from the scenario state. */
const valueOf = (state: Counter.Counter | undefined): number | undefined => state?.value;

/** Asserts the counter holds the expected value and returns the state. */
const expectValue = (
  state: Counter.Counter | undefined,
  expected: number,
): Effect.Effect<Counter.Counter | undefined, string> =>
  valueOf(state) === expected
    ? Effect.succeed(state)
    : Effect.fail(`Expected counter value ${expected}, got ${valueOf(state) ?? "none"}.`);

/**
 * The canonical Counter behavior as executable BDD.
 *
 * Steps are defined inline in each scenario pipe. The scenario state is the
 * counter itself: `undefined` before it exists, the counter after. Each step
 * hands the previous state to the next domain call and returns the new state
 * explicitly. `Bdd.tap` and `Bdd.tapError` observe the run without changing
 * it: a scenario tap runs at its chain position, and a feature tap runs once
 * after the scenario declared before it.
 */
export const counter = Bdd.feature("Counter").pipe(
  Bdd.scenario("Creating a counter").pipe(
    Bdd.given`no counter exists`(() => {
      return Effect.succeed(undefined);
    }),
    Bdd.when`the counter is created`((counter) => {
      return Effect.sync(() => (counter === undefined ? Counter.create() : counter));
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
  Bdd.scenario("Counting up").pipe(
    Bdd.given`a counter was created`(() => {
      return Effect.succeed(Counter.create());
    }),
    Bdd.when`the counter is incremented ${count} times`(({ count }, counter) => {
      return Effect.sync(() =>
        Array.from({ length: count }).reduce(
          (current: Counter.Counter | undefined) =>
            current === undefined ? current : Counter.increment(current),
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
      const created: Counter.Counter | undefined = Counter.create();
      return Effect.succeed(
        Array.from({ length: count }).reduce(
          (current: Counter.Counter | undefined) =>
            current === undefined ? current : Counter.increment(current),
          created,
        ),
      );
    }),
    Bdd.when`the counter is decremented`((counter) => {
      return Effect.sync(() => (counter === undefined ? counter : Counter.decrement(counter)));
    }),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, counter) => {
      return expectValue(counter, expectedValue);
    }),
  ),
);
