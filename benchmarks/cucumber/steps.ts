import { Given, Then, When, setWorldConstructor, type DataTable } from "@cucumber/cucumber";
import assert from "node:assert/strict";

type LineItem = {
  readonly sku: string;
  readonly qty: number;
  readonly price: number;
};

type Cart = {
  readonly items: ReadonlyArray<LineItem>;
  readonly payload?: Payload;
  readonly taxEnabled: boolean;
};

type Payload = {
  readonly sku: string;
  readonly qty: number;
};

type Counter = {
  readonly value: number;
  readonly active: boolean;
};

type CounterRejection =
  | "AlreadyExists"
  | "DoesNotExist"
  | "MaximumReached"
  | "MinimumReached"
  | "Disabled";

type CounterResult =
  | {
      readonly _tag: "Success";
      readonly counter: Counter;
    }
  | {
      readonly _tag: "Failure";
      readonly rejection: CounterRejection;
    };

type CounterScenarioState = {
  readonly counter: Counter | undefined;
  readonly rejection: CounterRejection | undefined;
};

const emptyCart: Cart = {
  items: [],
  taxEnabled: false,
};

const initialCounterState: CounterScenarioState = {
  counter: undefined,
  rejection: undefined,
};

class BenchmarkWorld {
  readonly events: Array<string> = [];
  cart: Cart = emptyCart;
  counterState: CounterScenarioState = initialCounterState;
}

setWorldConstructor(BenchmarkWorld);

const append = (world: BenchmarkWorld, event: string): void => {
  world.events.push(event);
};

Given("the minimalism inside a background", function (this: BenchmarkWorld) {
  append(this, "background");
});

Given(/^the (minimalism|more minimalism)$/, function (this: BenchmarkWorld, text: string) {
  append(this, text);
});

Given("the @delimits tags", function (this: BenchmarkWorld) {
  append(this, "joined tags");
});

Given("a comment", function (this: BenchmarkWorld) {
  append(this, "comment");
});

Given("a comment is preceded by a space", function (this: BenchmarkWorld) {
  append(this, "comment is preceded by a space");
});

Given(
  /^a (simple data table|data table with .+)$/,
  function (this: BenchmarkWorld, text: string, _table: DataTable) {
    append(this, text);
  },
);

Given(
  /^a (simple DocString|DocString with .+)$/,
  function (this: BenchmarkWorld, text: string, _docString: string) {
    append(this, text);
  },
);

Given("fb", function (this: BenchmarkWorld) {
  append(this, "feature background");
});

Given("ab", function (this: BenchmarkWorld) {
  append(this, "rule background");
});

Given("a", function (this: BenchmarkWorld) {
  append(this, "example a");
});

Given("b", function (this: BenchmarkWorld) {
  append(this, "example b");
});

Given("an empty cart", function (this: BenchmarkWorld) {
  this.cart = emptyCart;
});

Given("tax is enabled", function (this: BenchmarkWorld) {
  this.cart = { ...this.cart, taxEnabled: true };
});

Given("the cart starts empty", function (this: BenchmarkWorld) {
  this.cart = emptyCart;
});

When(
  "{int} {word} are added at {int} each",
  function (this: BenchmarkWorld, qty: number, sku: string, price: number) {
    this.cart = addItem(this.cart, sku, qty, price);
  },
);

When("the following items are added:", function (this: BenchmarkWorld, table: DataTable) {
  this.cart = table
    .hashes()
    .reduce(
      (cart, item) => addItem(cart, String(item.sku), Number(item.qty), Number(item.price)),
      this.cart,
    );
});

When("the request body is:", function (this: BenchmarkWorld, body: string) {
  this.cart = { ...this.cart, payload: parsePayload(body) };
});

Then("the subtotal is {int}", function (this: BenchmarkWorld, expected: number) {
  assert.equal(subtotalOf(this.cart), expected);
});

Then("the taxed total is {int}", function (this: BenchmarkWorld, expected: number) {
  const taxRate = this.cart.taxEnabled ? 0.1 : 0;
  assert.equal(Math.round(subtotalOf(this.cart) * (1 + taxRate)), expected);
});

Then("the payload is accepted", function (this: BenchmarkWorld) {
  assert.deepEqual(this.cart.payload, { sku: "book", qty: 2 });
});

Then("the scenario can finish with any keyword", function (this: BenchmarkWorld) {
  assert.equal(subtotalOf(this.cart), 0);
});

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

const addItem = (cart: Cart, sku: string, qty: number, price: number): Cart => ({
  ...cart,
  items: [...cart.items, { sku, qty, price }],
});

const subtotalOf = (cart: Cart): number =>
  cart.items.reduce((sum, item) => sum + item.qty * item.price, 0);

const parsePayload = (body: string): Payload => {
  const value: unknown = JSON.parse(body);
  if (isPayload(value)) {
    return value;
  }
  throw new Error("Expected request body to contain sku and qty");
};

const isPayload = (value: unknown): value is Payload =>
  isRecord(value) && hasStringProperty(value, "sku") && hasNumberProperty(value, "qty");

const hasStringProperty = (record: Record<string, unknown>, key: string): boolean =>
  typeof record[key] === "string";

const hasNumberProperty = (record: Record<string, unknown>, key: string): boolean =>
  typeof record[key] === "number";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

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
