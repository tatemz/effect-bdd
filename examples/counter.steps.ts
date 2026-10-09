import { Bdd } from "effect-bdd";
import { Effect, Result, Schema } from "effect";
import * as Counter from "./counter.ts";

type CounterScenarioState = {
  readonly counter: Counter.Counter | undefined;
  readonly rejection: Counter.CounterRejection | undefined;
};

/** Captures how many times a step repeats a counter change. */
const count = Bdd.capture("count", Schema.FiniteFromString.check(Schema.isGreaterThanOrEqualTo(0)));

/** Captures the counter value a `Then` step expects. */
const expectedValue = Bdd.capture("expectedValue", Schema.FiniteFromString);

const initialScenarioState: CounterScenarioState = {
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

const createCounter = (state: CounterScenarioState): CounterScenarioState =>
  recordCounterResult(state, Counter.create(state.counter));

const incrementCounter = (state: CounterScenarioState): CounterScenarioState =>
  recordCounterResult(state, Counter.increment(state.counter));

const decrementCounter = (state: CounterScenarioState): CounterScenarioState =>
  recordCounterResult(state, Counter.decrement(state.counter));

const disableCounter = (state: CounterScenarioState): CounterScenarioState =>
  recordCounterResult(state, Counter.disable(state.counter));

const incrementCounterTimes = (state: CounterScenarioState, times: number): CounterScenarioState =>
  Array.from({ length: times }).reduce<CounterScenarioState>(
    (current) => incrementCounter(current),
    state,
  );

const reject = (message: string): Effect.Effect<never, string> => Effect.fail(message);

const expectCounter = (state: CounterScenarioState): Effect.Effect<Counter.Counter, string> =>
  state.counter === undefined
    ? reject("Expected a counter to exist.")
    : Effect.succeed(state.counter);

const expectRejection = (
  state: CounterScenarioState,
  expected: Counter.CounterRejection,
): Effect.Effect<CounterScenarioState, string> =>
  state.rejection === expected
    ? Effect.succeed(state)
    : reject(`Expected rejection ${expected}, got ${state.rejection ?? "none"}.`);

/**
 * The canonical Counter behavior as executable BDD.
 *
 * Steps are defined inline in each scenario pipe; only captures and pure
 * helpers live at the top level. `Bdd.tap` and `Bdd.tapError` observe the
 * run without changing it: the feature tap reports every step's state, and
 * the feature error tap reports any failure's tag and message before the
 * scenario still fails with the original error.
 */
export const counter = Bdd.feature("Counter").pipe(
  Bdd.tapError((failure) => {
    const where = failure._tag === "TapError" ? failure.scenario : failure.message;
    return Effect.logError(`[Counter] failure in ${where}: ${failure._tag} - ${failure.message}`);
  }),
  Bdd.tap((state) => Effect.log(`[Counter] step state: ${JSON.stringify(state)}`)),
  Bdd.scenario("Creating a counter").pipe(
    Bdd.given`no counter exists`(() => Effect.succeed(initialScenarioState)),
    Bdd.when`the counter is created`((state) => Effect.succeed(createCounter(state))),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, state) =>
      Effect.flatMap(expectCounter(state), (counter) =>
        counter.value === expectedValue
          ? Effect.succeed(state)
          : reject(`Expected counter value ${expectedValue}, got ${counter.value}.`),
      ),
    ),
    Bdd.then`the counter is active`((state) =>
      Effect.flatMap(expectCounter(state), (counter) =>
        counter.active ? Effect.succeed(state) : reject("Expected the counter to be active."),
      ),
    ),
  ),
  Bdd.scenario("A counter is created only once").pipe(
    Bdd.given`a counter was created`(() => Effect.succeed(createCounter(initialScenarioState))),
    Bdd.when`the counter is created again`((state) => Effect.succeed(createCounter(state))),
    Bdd.then`the change is rejected because the counter already exists`((state) =>
      expectRejection(state, "AlreadyExists"),
    ),
  ),
  Bdd.scenario("Counting up").pipe(
    Bdd.given`a counter was created`(() => Effect.succeed(createCounter(initialScenarioState))),
    Bdd.when`the counter is incremented ${count} times`(({ count }, state) =>
      Effect.succeed(incrementCounterTimes(state, count)),
    ),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, state) =>
      Effect.flatMap(expectCounter(state), (counter) =>
        counter.value === expectedValue
          ? Effect.succeed(state)
          : reject(`Expected counter value ${expectedValue}, got ${counter.value}.`),
      ),
    ),
  ),
  Bdd.scenario("Counting down").pipe(
    Bdd.given`a counter at value ${count}`(({ count }) =>
      Effect.succeed(incrementCounterTimes(createCounter(initialScenarioState), count)),
    ),
    Bdd.when`the counter is decremented`((state) => Effect.succeed(decrementCounter(state))),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, state) =>
      Effect.flatMap(expectCounter(state), (counter) =>
        counter.value === expectedValue
          ? Effect.succeed(state)
          : reject(`Expected counter value ${expectedValue}, got ${counter.value}.`),
      ),
    ),
  ),
  Bdd.scenario("The counter never counts above 5").pipe(
    Bdd.given`a counter at value ${count}`(({ count }) =>
      Effect.succeed(incrementCounterTimes(createCounter(initialScenarioState), count)),
    ),
    Bdd.when`the counter is incremented`((state) => Effect.succeed(incrementCounter(state))),
    Bdd.then`the change is rejected because the counter reached its maximum`((state) =>
      expectRejection(state, "MaximumReached"),
    ),
  ),
  Bdd.scenario("The counter never counts below 0").pipe(
    Bdd.given`a counter was created`(() => Effect.succeed(createCounter(initialScenarioState))),
    Bdd.when`the counter is decremented`((state) => Effect.succeed(decrementCounter(state))),
    Bdd.then`the change is rejected because the counter reached its minimum`((state) =>
      expectRejection(state, "MinimumReached"),
    ),
  ),
  Bdd.scenario("Disabling a counter freezes it").pipe(
    Bdd.given`a counter at value ${count}`(({ count }) =>
      Effect.succeed(incrementCounterTimes(createCounter(initialScenarioState), count)),
    ),
    Bdd.when`the counter is disabled`((state) => Effect.succeed(disableCounter(state))),
    Bdd.when`the counter is incremented`((state) => Effect.succeed(incrementCounter(state))),
    Bdd.then`the change is rejected because the counter is disabled`((state) =>
      expectRejection(state, "Disabled"),
    ),
  ),
  Bdd.scenario("A missing counter cannot change").pipe(
    Bdd.given`no counter exists`(() => Effect.succeed(initialScenarioState)),
    Bdd.when`the counter is incremented`((state) => Effect.succeed(incrementCounter(state))),
    Bdd.then`the change is rejected because the counter does not exist`((state) =>
      expectRejection(state, "DoesNotExist"),
    ),
  ),
);
