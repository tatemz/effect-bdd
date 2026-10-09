import { Bdd } from "effect-bdd";
import { Effect, Schema } from "effect";
import * as Counter from "../counter-domain.ts";

const count = Bdd.capture("count", Schema.FiniteFromString);
const expectedValue = Bdd.capture("expectedValue", Schema.FiniteFromString);

const givenNoCounterExists = Bdd.given`no counter exists`(() => Effect.succeed(undefined));
const givenCounterWasCreated = Bdd.given`a counter was created`(() =>
  Effect.succeed(Counter.create()),
);
const givenCounterAtValue = Bdd.given`a counter at value ${count}`(({ count }) =>
  Effect.succeed(incrementTimes(Counter.create(), count)),
);
const whenCounterIsCreated = Bdd.when`the counter is created`(
  (state: Counter.Counter | undefined) =>
    Effect.succeed(state === undefined ? Counter.create() : state),
);
const whenCounterIsIncrementedTimes = Bdd.when`the counter is incremented ${count} times`(
  ({ count }, state: Counter.Counter | undefined) => Effect.succeed(incrementTimes(state, count)),
);
const whenCounterIsDecremented = Bdd.when`the counter is decremented`(
  (state: Counter.Counter | undefined) =>
    Effect.succeed(state === undefined ? state : Counter.decrement(state)),
);
const thenCounterValueIs = Bdd.then`the counter value is ${expectedValue}`(
  ({ expectedValue }, state: Counter.Counter | undefined) => expectValue(state, expectedValue),
);

const valueOf = (state: Counter.Counter | undefined): number | undefined => state?.value;

function expectValue(
  state: Counter.Counter | undefined,
  expected: number,
): Effect.Effect<Counter.Counter | undefined, string> {
  return valueOf(state) === expected
    ? Effect.succeed(state)
    : Effect.fail(`Expected counter value ${expected}, got ${valueOf(state) ?? "none"}.`);
}

export const counter = Bdd.feature("Counter").pipe(
  Bdd.scenario("Creating a counter").pipe(
    givenNoCounterExists,
    whenCounterIsCreated,
    thenCounterValueIs,
  ),
  Bdd.scenario("Counting up").pipe(
    givenCounterWasCreated,
    whenCounterIsIncrementedTimes,
    thenCounterValueIs,
  ),
  Bdd.scenario("Counting down").pipe(
    givenCounterAtValue,
    whenCounterIsDecremented,
    thenCounterValueIs,
  ),
);

function incrementTimes(
  state: Counter.Counter | undefined,
  times: number,
): Counter.Counter | undefined {
  return Array.from({ length: times }).reduce<Counter.Counter | undefined>(
    (current) => (current === undefined ? current : Counter.increment(current)),
    state,
  );
}
