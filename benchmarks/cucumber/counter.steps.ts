import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import * as Counter from "../counter-domain.ts";
import { BenchmarkWorld } from "./world.ts";

Given("no counter exists", function (this: BenchmarkWorld) {
  this.counterState = undefined;
});

Given("a counter was created", function (this: BenchmarkWorld) {
  this.counterState = Counter.create();
});

Given("a counter at value {int}", function (this: BenchmarkWorld, count: number) {
  this.counterState = incrementTimes(Counter.create(), count);
});

When("the counter is created", function (this: BenchmarkWorld) {
  if (this.counterState === undefined) {
    this.counterState = Counter.create();
  }
});

When("the counter is created again", function (this: BenchmarkWorld) {
  if (this.counterState === undefined) {
    this.counterState = Counter.create();
  }
});

When("the counter is incremented", function (this: BenchmarkWorld) {
  if (this.counterState !== undefined) {
    this.counterState = Counter.increment(this.counterState);
  }
});

When("the counter is incremented {int} times", function (this: BenchmarkWorld, count: number) {
  this.counterState = incrementTimes(this.counterState, count);
});

When("the counter is decremented", function (this: BenchmarkWorld) {
  if (this.counterState !== undefined) {
    this.counterState = Counter.decrement(this.counterState);
  }
});

Then("the counter value is {int}", function (this: BenchmarkWorld, expected: number) {
  assert.equal(this.counterState?.value, expected);
});

function incrementTimes(
  counter: Counter.Counter | undefined,
  times: number,
): Counter.Counter | undefined {
  return Array.from({ length: times }).reduce<Counter.Counter | undefined>(
    (current) => (current === undefined ? current : Counter.increment(current)),
    counter,
  );
}
