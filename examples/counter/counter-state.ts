import { Effect, Result } from "effect";
import * as Counter from "./counter.ts";

export type CounterScenarioState = {
  readonly counter: Counter.Counter | undefined;
  readonly rejection: Counter.CounterRejection | undefined;
};

export const initialScenarioState: CounterScenarioState = {
  counter: undefined,
  rejection: undefined,
};

const recordCounterResult = (
  state: CounterScenarioState,
  result: Result.Result<Counter.Counter, Counter.CounterRejection>,
): CounterScenarioState =>
  Result.match(result, {
    onSuccess: (counter) => ({ counter, rejection: undefined }),
    onFailure: (rejection) => ({ ...state, rejection }),
  });

export const createCounter = (state: CounterScenarioState): CounterScenarioState =>
  recordCounterResult(state, Counter.create(state.counter));

export const incrementCounter = (state: CounterScenarioState): CounterScenarioState =>
  recordCounterResult(state, Counter.increment(state.counter));

export const decrementCounter = (state: CounterScenarioState): CounterScenarioState =>
  recordCounterResult(state, Counter.decrement(state.counter));

export const disableCounter = (state: CounterScenarioState): CounterScenarioState =>
  recordCounterResult(state, Counter.disable(state.counter));

export const incrementCounterTimes = (
  state: CounterScenarioState,
  times: number,
): CounterScenarioState =>
  Array.from({ length: times }).reduce<CounterScenarioState>(
    (current) => incrementCounter(current),
    state,
  );

export const expectCounterValue = (
  state: CounterScenarioState,
  expected: number,
): Effect.Effect<CounterScenarioState, string> =>
  Effect.gen(function* () {
    if (state.counter === undefined) {
      return yield* Effect.fail("Expected a counter to exist.");
    }
    if (state.counter.value !== expected) {
      return yield* Effect.fail(`Expected counter value ${expected}, got ${state.counter.value}.`);
    }
    return state;
  });

export const expectCounterActive = (
  state: CounterScenarioState,
): Effect.Effect<CounterScenarioState, string> =>
  Effect.gen(function* () {
    if (state.counter === undefined) {
      return yield* Effect.fail("Expected a counter to exist.");
    }
    if (!state.counter.active) {
      return yield* Effect.fail("Expected the counter to be active.");
    }
    return state;
  });

export const expectRejection = (
  state: CounterScenarioState,
  expected: Counter.CounterRejection,
): Effect.Effect<CounterScenarioState, string> =>
  Effect.gen(function* () {
    if (state.rejection !== expected) {
      return yield* Effect.fail(
        `Expected rejection ${expected}, got ${state.rejection ?? "none"}.`,
      );
    }
    return state;
  });
