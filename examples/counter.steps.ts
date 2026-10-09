import { Bdd } from "effect-bdd";
import { Effect, Schema } from "effect";
import * as Support from "./counter.steps-support.ts";

/** Captures how many times a step repeats a counter change. */
const count = Bdd.capture("count", Schema.FiniteFromString.check(Schema.isGreaterThanOrEqualTo(0)));

/** Captures the counter value a `Then` step expects. */
const expectedValue = Bdd.capture("expectedValue", Schema.FiniteFromString);

/**
 * The canonical Counter behavior as executable BDD.
 *
 * Steps are defined inline in each scenario pipe; only captures and pure
 * helpers live at the top level. Steps read as generators: `Effect.gen`
 * wherever work is sequenced or branched, `Effect.sync` for pure state
 * changes. `Bdd.tap` and `Bdd.tapError` observe the run without changing
 * it: the feature tap reports every step's state, and the feature error tap
 * reports any failure's tag and message before the scenario still fails
 * with the original error.
 */
export const counter = Bdd.feature("Counter").pipe(
  Bdd.tapError((failure) => {
    const where = failure._tag === "TapError" ? failure.scenario : failure.message;
    return Effect.logError(`[Counter] failure in ${where}: ${failure._tag} - ${failure.message}`);
  }),
  Bdd.tap((state) => Effect.log(`[Counter] step state: ${JSON.stringify(state)}`)),
  Bdd.scenario("Creating a counter").pipe(
    Bdd.given`no counter exists`(() => Effect.sync(() => Support.initialScenarioState)),
    Bdd.when`the counter is created`((state) => Effect.sync(() => Support.createCounter(state))),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, state) =>
      Support.expectCounterValue(state, expectedValue),
    ),
    Bdd.then`the counter is active`((state) => Support.expectCounterActive(state)),
  ),
  Bdd.scenario("A counter is created only once").pipe(
    Bdd.given`a counter was created`(() =>
      Effect.sync(() => Support.createCounter(Support.initialScenarioState)),
    ),
    Bdd.when`the counter is created again`((state) =>
      Effect.sync(() => Support.createCounter(state)),
    ),
    Bdd.then`the change is rejected because the counter already exists`((state) =>
      Support.expectRejection(state, "AlreadyExists"),
    ),
  ),
  Bdd.scenario("Counting up").pipe(
    Bdd.given`a counter was created`(() =>
      Effect.sync(() => Support.createCounter(Support.initialScenarioState)),
    ),
    Bdd.when`the counter is incremented ${count} times`(({ count }, state) =>
      Effect.sync(() => Support.incrementCounterTimes(state, count)),
    ),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, state) =>
      Support.expectCounterValue(state, expectedValue),
    ),
  ),
  Bdd.scenario("Counting down").pipe(
    Bdd.given`a counter at value ${count}`(({ count }) =>
      Effect.sync(() =>
        Support.incrementCounterTimes(Support.createCounter(Support.initialScenarioState), count),
      ),
    ),
    Bdd.when`the counter is decremented`((state) =>
      Effect.sync(() => Support.decrementCounter(state)),
    ),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, state) =>
      Support.expectCounterValue(state, expectedValue),
    ),
  ),
  Bdd.scenario("The counter never counts above 5").pipe(
    Bdd.given`a counter at value ${count}`(({ count }) =>
      Effect.sync(() =>
        Support.incrementCounterTimes(Support.createCounter(Support.initialScenarioState), count),
      ),
    ),
    Bdd.when`the counter is incremented`((state) =>
      Effect.sync(() => Support.incrementCounter(state)),
    ),
    Bdd.then`the change is rejected because the counter reached its maximum`((state) =>
      Support.expectRejection(state, "MaximumReached"),
    ),
  ),
  Bdd.scenario("The counter never counts below 0").pipe(
    Bdd.given`a counter was created`(() =>
      Effect.sync(() => Support.createCounter(Support.initialScenarioState)),
    ),
    Bdd.when`the counter is decremented`((state) =>
      Effect.sync(() => Support.decrementCounter(state)),
    ),
    Bdd.then`the change is rejected because the counter reached its minimum`((state) =>
      Support.expectRejection(state, "MinimumReached"),
    ),
  ),
  Bdd.scenario("Disabling a counter freezes it").pipe(
    Bdd.given`a counter at value ${count}`(({ count }) =>
      Effect.sync(() =>
        Support.incrementCounterTimes(Support.createCounter(Support.initialScenarioState), count),
      ),
    ),
    Bdd.when`the counter is disabled`((state) => Effect.sync(() => Support.disableCounter(state))),
    Bdd.when`the counter is incremented`((state) =>
      Effect.sync(() => Support.incrementCounter(state)),
    ),
    Bdd.then`the change is rejected because the counter is disabled`((state) =>
      Support.expectRejection(state, "Disabled"),
    ),
  ),
  Bdd.scenario("A missing counter cannot change").pipe(
    Bdd.given`no counter exists`(() => Effect.sync(() => Support.initialScenarioState)),
    Bdd.when`the counter is incremented`((state) =>
      Effect.sync(() => Support.incrementCounter(state)),
    ),
    Bdd.then`the change is rejected because the counter does not exist`((state) =>
      Support.expectRejection(state, "DoesNotExist"),
    ),
  ),
);
