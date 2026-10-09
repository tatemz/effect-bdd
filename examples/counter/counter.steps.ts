import { Bdd } from "effect-bdd";
import { Effect, Result, Schema } from "effect";
import * as Counter from "./counter.ts";

/**
 * The state a counter scenario carries: the current counter, and the
 * rejection from the latest change attempt, if the change was refused.
 */
type CounterState = {
  readonly counter: Counter.Counter | undefined;
  readonly rejection: Counter.CounterRejection | undefined;
};

/** Captures how many times a step repeats a counter change. */
const count = Bdd.capture("count", Schema.FiniteFromString.check(Schema.isGreaterThanOrEqualTo(0)));

/** Captures the counter value a `Then` step expects. */
const expectedValue = Bdd.capture("expectedValue", Schema.FiniteFromString);

/**
 * The canonical Counter behavior as executable BDD.
 *
 * Steps are defined inline in each scenario pipe. Every step that changes
 * state applies the domain call to `state.counter` and returns the new
 * state explicitly, so the update is visible at the step, not hidden in a
 * helper. `Bdd.tap` and `Bdd.tapError` observe the run without changing
 * it: the feature tap reports every step's state, and the feature error
 * tap reports any failure's tag and message before the scenario still
 * fails with the original error.
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
      return Effect.sync(
        () => ({ counter: undefined, rejection: undefined }) satisfies CounterState,
      );
    }),
    Bdd.when`the counter is created`((state) => {
      return Effect.sync(() => {
        return Result.match(Counter.create(state.counter), {
          onSuccess: (counter) => ({ ...state, counter, rejection: undefined }),
          onFailure: (rejection) => ({ ...state, rejection }),
        });
      });
    }),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, state) => {
      return Effect.gen(function* () {
        const counter = state.counter;
        if (counter === undefined) {
          return yield* Effect.fail("Expected a counter to exist.");
        }
        if (counter.value !== expectedValue) {
          return yield* Effect.fail(
            `Expected counter value ${expectedValue}, got ${counter.value}.`,
          );
        }
        return state;
      });
    }),
    Bdd.then`the counter is active`((state) => {
      return Effect.gen(function* () {
        if (state.counter === undefined || !state.counter.active) {
          return yield* Effect.fail("Expected the counter to be active.");
        }
        return state;
      });
    }),
  ),
  Bdd.scenario("A counter is created only once").pipe(
    Bdd.given`a counter was created`(() => {
      return Effect.sync(() => {
        return Result.match(Counter.create(undefined), {
          onSuccess: (counter) => ({ counter, rejection: undefined }),
          onFailure: (rejection) => ({ counter: undefined, rejection }),
        });
      });
    }),
    Bdd.when`the counter is created again`((state) => {
      return Effect.sync(() => {
        return Result.match(Counter.create(state.counter), {
          onSuccess: (counter) => ({ ...state, counter, rejection: undefined }),
          onFailure: (rejection) => ({ ...state, rejection }),
        });
      });
    }),
    Bdd.then`the change is rejected because the counter already exists`((state) => {
      return Effect.gen(function* () {
        if (state.rejection !== "AlreadyExists") {
          return yield* Effect.fail(
            `Expected rejection AlreadyExists, got ${state.rejection ?? "none"}.`,
          );
        }
        return state;
      });
    }),
  ),
  Bdd.scenario("Counting up").pipe(
    Bdd.given`a counter was created`(() => {
      return Effect.sync(() => {
        return Result.match(Counter.create(undefined), {
          onSuccess: (counter) => ({ counter, rejection: undefined }),
          onFailure: (rejection) => ({ counter: undefined, rejection }),
        });
      });
    }),
    Bdd.when`the counter is incremented ${count} times`(({ count }, state) => {
      return Effect.sync(() => {
        return Array.from({ length: count }).reduce<CounterState>(
          (current) =>
            Result.match(Counter.increment(current.counter), {
              onSuccess: (counter) => ({ ...current, counter, rejection: undefined }),
              onFailure: (rejection) => ({ ...current, rejection }),
            }),
          state,
        );
      });
    }),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, state) => {
      return Effect.gen(function* () {
        const counter = state.counter;
        if (counter === undefined) {
          return yield* Effect.fail("Expected a counter to exist.");
        }
        if (counter.value !== expectedValue) {
          return yield* Effect.fail(
            `Expected counter value ${expectedValue}, got ${counter.value}.`,
          );
        }
        return state;
      });
    }),
  ),
  Bdd.scenario("Counting down").pipe(
    Bdd.given`a counter at value ${count}`(({ count }) => {
      return Effect.sync(() => {
        const created = Result.match(Counter.create(undefined), {
          onSuccess: (counter) => ({ counter, rejection: undefined }),
          onFailure: (rejection) => ({ counter: undefined, rejection }),
        });
        return Array.from({ length: count }).reduce<CounterState>(
          (current) =>
            Result.match(Counter.increment(current.counter), {
              onSuccess: (counter) => ({ ...current, counter, rejection: undefined }),
              onFailure: (rejection) => ({ ...current, rejection }),
            }),
          created,
        );
      });
    }),
    Bdd.when`the counter is decremented`((state) => {
      return Effect.sync(() => {
        return Result.match(Counter.decrement(state.counter), {
          onSuccess: (counter) => ({ ...state, counter, rejection: undefined }),
          onFailure: (rejection) => ({ ...state, rejection }),
        });
      });
    }),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, state) => {
      return Effect.gen(function* () {
        const counter = state.counter;
        if (counter === undefined) {
          return yield* Effect.fail("Expected a counter to exist.");
        }
        if (counter.value !== expectedValue) {
          return yield* Effect.fail(
            `Expected counter value ${expectedValue}, got ${counter.value}.`,
          );
        }
        return state;
      });
    }),
  ),
  Bdd.scenario("The counter never counts above 5").pipe(
    Bdd.given`a counter at value ${count}`(({ count }) => {
      return Effect.sync(() => {
        const created = Result.match(Counter.create(undefined), {
          onSuccess: (counter) => ({ counter, rejection: undefined }),
          onFailure: (rejection) => ({ counter: undefined, rejection }),
        });
        return Array.from({ length: count }).reduce<CounterState>(
          (current) =>
            Result.match(Counter.increment(current.counter), {
              onSuccess: (counter) => ({ ...current, counter, rejection: undefined }),
              onFailure: (rejection) => ({ ...current, rejection }),
            }),
          created,
        );
      });
    }),
    Bdd.when`the counter is incremented`((state) => {
      return Effect.sync(() => {
        return Result.match(Counter.increment(state.counter), {
          onSuccess: (counter) => ({ ...state, counter, rejection: undefined }),
          onFailure: (rejection) => ({ ...state, rejection }),
        });
      });
    }),
    Bdd.then`the change is rejected because the counter reached its maximum`((state) => {
      return Effect.gen(function* () {
        if (state.rejection !== "MaximumReached") {
          return yield* Effect.fail(
            `Expected rejection MaximumReached, got ${state.rejection ?? "none"}.`,
          );
        }
        return state;
      });
    }),
  ),
  Bdd.scenario("The counter never counts below 0").pipe(
    Bdd.given`a counter was created`(() => {
      return Effect.sync(() => {
        return Result.match(Counter.create(undefined), {
          onSuccess: (counter) => ({ counter, rejection: undefined }),
          onFailure: (rejection) => ({ counter: undefined, rejection }),
        });
      });
    }),
    Bdd.when`the counter is decremented`((state) => {
      return Effect.sync(() => {
        return Result.match(Counter.decrement(state.counter), {
          onSuccess: (counter) => ({ ...state, counter, rejection: undefined }),
          onFailure: (rejection) => ({ ...state, rejection }),
        });
      });
    }),
    Bdd.then`the change is rejected because the counter reached its minimum`((state) => {
      return Effect.gen(function* () {
        if (state.rejection !== "MinimumReached") {
          return yield* Effect.fail(
            `Expected rejection MinimumReached, got ${state.rejection ?? "none"}.`,
          );
        }
        return state;
      });
    }),
  ),
  Bdd.scenario("Disabling a counter freezes it").pipe(
    Bdd.given`a counter at value ${count}`(({ count }) => {
      return Effect.sync(() => {
        const created = Result.match(Counter.create(undefined), {
          onSuccess: (counter) => ({ counter, rejection: undefined }),
          onFailure: (rejection) => ({ counter: undefined, rejection }),
        });
        return Array.from({ length: count }).reduce<CounterState>(
          (current) =>
            Result.match(Counter.increment(current.counter), {
              onSuccess: (counter) => ({ ...current, counter, rejection: undefined }),
              onFailure: (rejection) => ({ ...current, rejection }),
            }),
          created,
        );
      });
    }),
    Bdd.when`the counter is disabled`((state) => {
      return Effect.sync(() => {
        return Result.match(Counter.disable(state.counter), {
          onSuccess: (counter) => ({ ...state, counter, rejection: undefined }),
          onFailure: (rejection) => ({ ...state, rejection }),
        });
      });
    }),
    Bdd.when`the counter is incremented`((state) => {
      return Effect.sync(() => {
        return Result.match(Counter.increment(state.counter), {
          onSuccess: (counter) => ({ ...state, counter, rejection: undefined }),
          onFailure: (rejection) => ({ ...state, rejection }),
        });
      });
    }),
    Bdd.then`the change is rejected because the counter is disabled`((state) => {
      return Effect.gen(function* () {
        if (state.rejection !== "Disabled") {
          return yield* Effect.fail(
            `Expected rejection Disabled, got ${state.rejection ?? "none"}.`,
          );
        }
        return state;
      });
    }),
  ),
  Bdd.scenario("A missing counter cannot change").pipe(
    Bdd.given`no counter exists`(() => {
      return Effect.sync(
        () => ({ counter: undefined, rejection: undefined }) satisfies CounterState,
      );
    }),
    Bdd.when`the counter is incremented`((state) => {
      return Effect.sync(() => {
        return Result.match(Counter.increment(state.counter), {
          onSuccess: (counter) => ({ ...state, counter, rejection: undefined }),
          onFailure: (rejection) => ({ ...state, rejection }),
        });
      });
    }),
    Bdd.then`the change is rejected because the counter does not exist`((state) => {
      return Effect.gen(function* () {
        if (state.rejection !== "DoesNotExist") {
          return yield* Effect.fail(
            `Expected rejection DoesNotExist, got ${state.rejection ?? "none"}.`,
          );
        }
        return state;
      });
    }),
  ),
);
