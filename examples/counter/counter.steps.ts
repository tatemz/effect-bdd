import { Bdd } from "effect-bdd";
import { Effect, Result, Schema } from "effect";
import * as Counter from "./counter.ts";

/**
 * The state a counter scenario carries: the latest domain outcome, passed
 * to each step as-is. `undefined` in the success arm means no counter
 * exists yet; a failure holds the rejection of the latest change attempt.
 */
type CounterState = Result.Result<Counter.Counter | undefined, Counter.CounterRejection>;

/** The seed state for scenarios that begin with no counter. */
const noCounter: CounterState = Result.succeed(undefined);

/** Captures how many times a step repeats a counter change. */
const count = Bdd.capture("count", Schema.FiniteFromString.check(Schema.isGreaterThanOrEqualTo(0)));

/** Captures the counter value a `Then` step expects. */
const expectedValue = Bdd.capture("expectedValue", Schema.FiniteFromString);

/**
 * The canonical Counter behavior as executable BDD.
 *
 * Steps are defined inline in each scenario pipe. The scenario state is the
 * domain `Result` itself: each step hands the previous result to the next
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
      return Effect.succeed(noCounter);
    }),
    Bdd.when`the counter is created`((counter) => {
      return Effect.sync(() => Result.flatMap(counter, Counter.create));
    }),
    Bdd.tap((counter) => {
      return Effect.log(`[Counter] created state: ${JSON.stringify(counter)}`);
    }),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, counter: CounterState) => {
      return Effect.gen(function* () {
        const counterValue = Result.getOrElse(counter, () => undefined)?.value;
        if (counterValue === expectedValue) {
          return counter;
        }
        return yield* Effect.fail(
          `Expected counter value ${expectedValue}, got ${counterValue ?? "none"}.`,
        );
      });
    }),
  ),
  Bdd.tap((state) => {
    return Effect.log(`[Counter] after "Creating a counter": ${JSON.stringify(state)}`);
  }),
  Bdd.scenario("A counter is created only once").pipe(
    Bdd.given`a counter was created`(() => {
      return Effect.succeed(Counter.create(undefined));
    }),
    Bdd.when`the counter is created again`((counter) => {
      return Effect.sync(() => Result.flatMap(counter, Counter.create));
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
      return Effect.succeed(Counter.create(undefined));
    }),
    Bdd.when`the counter is incremented ${count} times`(({ count }, counter) => {
      return Effect.sync(() =>
        Array.from({ length: count }).reduce(
          (current: CounterState) => Result.flatMap(current, Counter.increment),
          counter,
        ),
      );
    }),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, counter: CounterState) => {
      return Effect.gen(function* () {
        const counterValue = Result.getOrElse(counter, () => undefined)?.value;
        if (counterValue === expectedValue) {
          return counter;
        }
        return yield* Effect.fail(
          `Expected counter value ${expectedValue}, got ${counterValue ?? "none"}.`,
        );
      });
    }),
  ),
  Bdd.scenario("Counting down").pipe(
    Bdd.given`a counter at value ${count}`(({ count }) => {
      return Effect.succeed(
        Array.from({ length: count }).reduce(
          (current: CounterState) => Result.flatMap(current, Counter.increment),
          Counter.create(undefined),
        ),
      );
    }),
    Bdd.when`the counter is decremented`((counter) => {
      return Effect.sync(() => Result.flatMap(counter, Counter.decrement));
    }),
    Bdd.then`the counter value is ${expectedValue}`(({ expectedValue }, counter: CounterState) => {
      return Effect.gen(function* () {
        const counterValue = Result.getOrElse(counter, () => undefined)?.value;
        if (counterValue === expectedValue) {
          return counter;
        }
        return yield* Effect.fail(
          `Expected counter value ${expectedValue}, got ${counterValue ?? "none"}.`,
        );
      });
    }),
  ),
  Bdd.scenario("A missing counter cannot change").pipe(
    Bdd.given`no counter exists`(() => {
      return Effect.succeed(noCounter);
    }),
    Bdd.when`the counter is incremented`((counter) => {
      return Effect.sync(() => Result.flatMap(counter, Counter.increment));
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
