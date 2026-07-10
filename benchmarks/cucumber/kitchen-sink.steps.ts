import { Given, Then, When, type DataTable } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { BenchmarkWorld, emptyCart, type Cart, type Payload } from "./world.ts";

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
