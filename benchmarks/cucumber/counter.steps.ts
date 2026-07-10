import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {
  BenchmarkWorld,
  initialCounterState,
  type Counter,
  type CounterRejection,
  type CounterScenarioState,
} from "./world.ts";

type CounterResult =
  | {
      readonly _tag: "Success";
      readonly counter: Counter;
    }
  | {
      readonly _tag: "Failure";
      readonly rejection: CounterRejection;
    };

Given("no counter exists", function (this: BenchmarkWorld) {
  this.counterState = initialCounterState;
});

Given("a counter was created", function (this: BenchmarkWorld) {
  this.counterState = createCounter(initialCounterState);
});

Given("a counter at value {int}", function (this: BenchmarkWorld, count: number) {
  this.counterState = incrementCounterTimes(createCounter(initialCounterState), count);
});

When("the counter is created", function (this: BenchmarkWorld) {
  this.counterState = createCounter(this.counterState);
});

When("the counter is created again", function (this: BenchmarkWorld) {
  this.counterState = createCounter(this.counterState);
});

When("the counter is incremented", function (this: BenchmarkWorld) {
  this.counterState = incrementCounter(this.counterState);
});

When("the counter is incremented {int} times", function (this: BenchmarkWorld, count: number) {
  this.counterState = incrementCounterTimes(this.counterState, count);
});

When("the counter is decremented", function (this: BenchmarkWorld) {
  this.counterState = decrementCounter(this.counterState);
});

When("the counter is disabled", function (this: BenchmarkWorld) {
  this.counterState = disableCounter(this.counterState);
});

Then("the counter value is {int}", function (this: BenchmarkWorld, expected: number) {
  assert.equal(expectCounter(this.counterState).value, expected);
});

Then("the counter is active", function (this: BenchmarkWorld) {
  assert.equal(expectCounter(this.counterState).active, true);
});

Then("the change is rejected because the counter already exists", function (this: BenchmarkWorld) {
  expectRejection(this.counterState, "AlreadyExists");
});

Then(
  "the change is rejected because the counter reached its maximum",
  function (this: BenchmarkWorld) {
    expectRejection(this.counterState, "MaximumReached");
  },
);

Then(
  "the change is rejected because the counter reached its minimum",
  function (this: BenchmarkWorld) {
    expectRejection(this.counterState, "MinimumReached");
  },
);

Then("the change is rejected because the counter is disabled", function (this: BenchmarkWorld) {
  expectRejection(this.counterState, "Disabled");
});

Then("the change is rejected because the counter does not exist", function (this: BenchmarkWorld) {
  expectRejection(this.counterState, "DoesNotExist");
});

const create = (counter: Counter | undefined): CounterResult =>
  counter === undefined
    ? { _tag: "Success", counter: { value: 0, active: true } }
    : { _tag: "Failure", rejection: "AlreadyExists" };

const increment = (counter: Counter | undefined): CounterResult => {
  if (counter === undefined) {
    return { _tag: "Failure", rejection: "DoesNotExist" };
  }
  if (!counter.active) {
    return { _tag: "Failure", rejection: "Disabled" };
  }
  if (counter.value >= 5) {
    return { _tag: "Failure", rejection: "MaximumReached" };
  }
  return { _tag: "Success", counter: { ...counter, value: counter.value + 1 } };
};

const decrement = (counter: Counter | undefined): CounterResult => {
  if (counter === undefined) {
    return { _tag: "Failure", rejection: "DoesNotExist" };
  }
  if (!counter.active) {
    return { _tag: "Failure", rejection: "Disabled" };
  }
  if (counter.value <= 0) {
    return { _tag: "Failure", rejection: "MinimumReached" };
  }
  return { _tag: "Success", counter: { ...counter, value: counter.value - 1 } };
};

const disable = (counter: Counter | undefined): CounterResult =>
  counter === undefined
    ? { _tag: "Failure", rejection: "DoesNotExist" }
    : { _tag: "Success", counter: { ...counter, active: false } };

const recordCounterResult = (
  state: CounterScenarioState,
  result: CounterResult,
): CounterScenarioState =>
  result._tag === "Success"
    ? { counter: result.counter, rejection: undefined }
    : { ...state, rejection: result.rejection };

const createCounter = (state: CounterScenarioState): CounterScenarioState =>
  recordCounterResult(state, create(state.counter));

const incrementCounter = (state: CounterScenarioState): CounterScenarioState =>
  recordCounterResult(state, increment(state.counter));

const decrementCounter = (state: CounterScenarioState): CounterScenarioState =>
  recordCounterResult(state, decrement(state.counter));

const disableCounter = (state: CounterScenarioState): CounterScenarioState =>
  recordCounterResult(state, disable(state.counter));

const incrementCounterTimes = (state: CounterScenarioState, times: number): CounterScenarioState =>
  Array.from({ length: times }).reduce<CounterScenarioState>(
    (current) => incrementCounter(current),
    state,
  );

const expectCounter = (state: CounterScenarioState): Counter => {
  if (state.counter === undefined) {
    throw new Error("Expected a counter to exist.");
  }
  return state.counter;
};

const expectRejection = (state: CounterScenarioState, expected: CounterRejection): void => {
  assert.equal(state.rejection, expected);
};
