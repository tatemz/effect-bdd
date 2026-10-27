import { Bdd } from "effect-bdd";
import { Effect, Schema } from "effect";
import * as Counter from "./counter.ts";

/** Captures the starting value a `Given` step builds. */
const startValue = Bdd.capture("startValue", Schema.FiniteFromString);

/** Captures how many times a step repeats a counter change. */
const count = Bdd.capture("count", Schema.FiniteFromString.check(Schema.isGreaterThanOrEqualTo(0)));

/** Captures the counter value a `Then` step expects. */
const expectedValue = Bdd.capture("expectedValue", Schema.FiniteFromString);

/** Raises a counter to `value` by incrementing it from zero. */
const counterAt = (value: number): Counter.Counter =>
  Array.from({ length: value }).reduce<Counter.Counter>(
    (current) => Counter.increment(current),
    Counter.create(),
  );

/**
 * Asserts the counter holds the expected value and passes the state through.
 *
 * The assertion lives in a `Then` step, so it reports against the scenario
 * rather than against a setup or action step.
 */
const expectValue = (
  state: Counter.Counter,
  expected: number,
): Effect.Effect<Counter.Counter, string> =>
  state.value === expected
    ? Effect.succeed(state)
    : Effect.fail(`Expected counter value ${expected}, got ${state.value}.`);

/**
 * The canonical Counter behavior as executable BDD.
 *
 * Every scenario has exactly one `Given`, one `When`, and one `Then`, and each
 * keyword does only its own job:
 *
 * - `Given` builds the starting state. It never asserts and never changes the
 *   behavior under test.
 * - `When` performs the single action the scenario is about.
 * - `Then` asserts the observable result and passes the state through, so the
 *   scenario never fails from a setup or action step.
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
    Bdd.when`the counter is created`((counter: Counter.Counter | undefined) => {
      return Effect.sync(() => (counter === undefined ? Counter.create() : counter));
    }),
    Bdd.tap((counter) => {
      return Effect.log(`[Counter] created state: ${JSON.stringify(counter)}`);
    }),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, counter) => {
      if (counter === undefined) {
        return Effect.fail("Expected a counter, but none was created.");
      }
      return expectValue(counter, expectedValue);
    }),
  ),
  Bdd.tap((state) => {
    return Effect.log(`[Counter] after "Creating a counter": ${JSON.stringify(state)}`);
  }),
  Bdd.scenario("Counting up").pipe(
    Bdd.given`a counter at value ${startValue}`(({ startValue }) => {
      return Effect.succeed(counterAt(startValue));
    }),
    Bdd.when`the counter is incremented ${count} times`(({ count }, counter: Counter.Counter) => {
      return Effect.sync(() =>
        Array.from({ length: count }).reduce<Counter.Counter>(
          (current) => Counter.increment(current),
          counter,
        ),
      );
    }),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, counter) => {
      return expectValue(counter, expectedValue);
    }),
  ),
  Bdd.scenario("Counting down").pipe(
    Bdd.given`a counter at value ${startValue}`(({ startValue }) => {
      return Effect.succeed(counterAt(startValue));
    }),
    Bdd.when`the counter is decremented`((counter: Counter.Counter) => {
      return Effect.sync(() => Counter.decrement(counter));
    }),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, counter) => {
      return expectValue(counter, expectedValue);
    }),
  ),
);
