import { Result } from "effect";

export type Counter = {
  readonly value: number;
};

export type CounterRejection = "AlreadyExists" | "DoesNotExist";

/**
 * The state of a counter: either an existing counter or the typed rejection
 * explaining why there is none. `DoesNotExist` is the absence state; a change
 * on it is rejected and leaves the state untouched.
 */
export type CounterState = Result.Result<Counter, CounterRejection>;

/** The state before any counter exists. */
export const missing: CounterState = Result.fail("DoesNotExist");

/**
 * Creates a counter at zero. Only a missing counter can be created; when one
 * already exists, the creation is rejected with `AlreadyExists`.
 */
export const create = (state: CounterState): CounterState =>
  Result.isSuccess(state) || state.failure === "AlreadyExists"
    ? Result.fail("AlreadyExists")
    : Result.succeed({ value: 0 });

/** Adds one to an existing counter; a missing counter cannot change. */
export const increment = (state: CounterState): CounterState =>
  Result.map(state, (counter) => ({ ...counter, value: counter.value + 1 }));

/** Subtracts one from an existing counter; a missing counter cannot change. */
export const decrement = (state: CounterState): CounterState =>
  Result.map(state, (counter) => ({ ...counter, value: counter.value - 1 }));
