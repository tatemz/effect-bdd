import { Bdd } from "effect-bdd";
import { Effect, Schema } from "effect";
import * as Support from "./counter-state.ts";

/** Captures how many times a step repeats a counter change. */
const count = Bdd.capture("count", Schema.FiniteFromString.check(Schema.isGreaterThanOrEqualTo(0)));

/** Captures the counter value a `Then` step expects. */
const expectedValue = Bdd.capture("expectedValue", Schema.FiniteFromString);

/**
 * The canonical Counter behavior as executable BDD.
 *
 * Steps are defined inline in each scenario pipe; only captures and pure
 * helpers live at the top level. Every step body is an `Effect.gen`
 * generator. `Bdd.tap` and `Bdd.tapError` observe the run without changing
 * it: the feature tap reports every step's state, and the feature error tap
 * reports any failure's tag and message before the scenario still fails
 * with the original error.
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
      return Effect.sync(() => Support.initialScenarioState);
    }),
    Bdd.when`the counter is created`((state) => {
      return Effect.sync(() => Support.createCounter(state));
    }),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, state) => {
      return Effect.gen(function* () {
        return yield* Support.expectCounterValue(state, expectedValue);
      });
    }),
    Bdd.then`the counter is active`((state) => {
      return Effect.gen(function* () {
        return yield* Support.expectCounterActive(state);
      });
    }),
  ),
  Bdd.scenario("A counter is created only once").pipe(
    Bdd.given`a counter was created`(() => {
      return Effect.sync(() => Support.createCounter(Support.initialScenarioState));
    }),
    Bdd.when`the counter is created again`((state) => {
      return Effect.sync(() => Support.createCounter(state));
    }),
    Bdd.then`the change is rejected because the counter already exists`((state) => {
      return Support.expectRejection(state, "AlreadyExists");
    }),
  ),
  Bdd.scenario("Counting up").pipe(
    Bdd.given`a counter was created`(() => {
      return Effect.sync(() => Support.createCounter(Support.initialScenarioState));
    }),
    Bdd.when`the counter is incremented ${count} times`(({ count }, state) => {
      return Effect.sync(() => Support.incrementCounterTimes(state, count));
    }),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, state) => {
      return Support.expectCounterValue(state, expectedValue);
    }),
  ),
  Bdd.scenario("Counting down").pipe(
    Bdd.given`a counter at value ${count}`(({ count }) => {
      return Effect.sync(() => {
        return Support.incrementCounterTimes(
          Support.createCounter(Support.initialScenarioState),
          count,
        );
      });
    }),
    Bdd.when`the counter is decremented`((state) => {
      return Effect.sync(() => Support.decrementCounter(state));
    }),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, state) => {
      return Support.expectCounterValue(state, expectedValue);
    }),
  ),
  Bdd.scenario("The counter never counts above 5").pipe(
    Bdd.given`a counter at value ${count}`(({ count }) => {
      return Effect.sync(() => {
        return Support.incrementCounterTimes(
          Support.createCounter(Support.initialScenarioState),
          count,
        );
      });
    }),
    Bdd.when`the counter is incremented`((state) => {
      return Effect.sync(() => Support.incrementCounter(state));
    }),
    Bdd.then`the change is rejected because the counter reached its maximum`((state) => {
      return Support.expectRejection(state, "MaximumReached");
    }),
  ),
  Bdd.scenario("The counter never counts below 0").pipe(
    Bdd.given`a counter was created`(() => {
      return Effect.sync(() => Support.createCounter(Support.initialScenarioState));
    }),
    Bdd.when`the counter is decremented`((state) => {
      return Effect.sync(() => Support.decrementCounter(state));
    }),
    Bdd.then`the change is rejected because the counter reached its minimum`((state) => {
      return Support.expectRejection(state, "MinimumReached");
    }),
  ),
  Bdd.scenario("Disabling a counter freezes it").pipe(
    Bdd.given`a counter at value ${count}`(({ count }) => {
      return Effect.sync(() => {
        return Support.incrementCounterTimes(
          Support.createCounter(Support.initialScenarioState),
          count,
        );
      });
    }),
    Bdd.when`the counter is disabled`((state) => {
      return Effect.sync(() => Support.disableCounter(state));
    }),
    Bdd.when`the counter is incremented`((state) => {
      return Effect.sync(() => Support.incrementCounter(state));
    }),
    Bdd.then`the change is rejected because the counter is disabled`((state) => {
      return Support.expectRejection(state, "Disabled");
    }),
  ),
  Bdd.scenario("A missing counter cannot change").pipe(
    Bdd.given`no counter exists`(() => {
      return Effect.sync(() => Support.initialScenarioState);
    }),
    Bdd.when`the counter is incremented`((state) => {
      return Effect.sync(() => Support.incrementCounter(state));
    }),
    Bdd.then`the change is rejected because the counter does not exist`((state) => {
      return Support.expectRejection(state, "DoesNotExist");
    }),
  ),
);
