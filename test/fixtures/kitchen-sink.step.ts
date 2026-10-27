import { Bdd } from "effect-bdd";
import { Context, Effect, Layer, Schema } from "effect";

class TaxRate extends Context.Service<
  TaxRate,
  {
    readonly rate: number;
  }
>()("TaxRate") {}

/** The rate the taxed-total scenario runs with. */
const TaxRateLive = Layer.succeed(TaxRate, { rate: 0.1 });

const Item = Schema.Struct({
  sku: Schema.String,
  qty: Schema.FiniteFromString,
  price: Schema.FiniteFromString,
});

const Payload = Schema.Struct({
  sku: Schema.String,
  qty: Schema.Number,
});

type LineItem = {
  readonly sku: string;
  readonly qty: number;
  readonly price: number;
};

type Cart = {
  readonly items: ReadonlyArray<LineItem>;
  readonly payload?: Schema.Schema.Type<typeof Payload>;
  readonly taxEnabled: boolean;
};

const emptyCart: Cart = {
  items: [],
  taxEnabled: false,
};

const qty = Bdd.capture("qty", Schema.FiniteFromString);
const sku = Bdd.capture("sku", Schema.String);
const price = Bdd.capture("price", Schema.FiniteFromString);
const expected = Bdd.capture("expected", Schema.FiniteFromString);

const addItem = (cart: Cart, sku: string, qty: number, price: number): Cart => ({
  ...cart,
  items: [...cart.items, { sku, qty, price }],
});

const subtotalOf = (cart: Cart): number =>
  cart.items.reduce((sum, item) => sum + item.qty * item.price, 0);

const givenEmptyCart = Bdd.given`an empty cart`(() => Effect.succeed(emptyCart));
const givenTaxEnabled = Bdd.given`tax is enabled`((state: Cart) =>
  Effect.succeed({ ...state, taxEnabled: true }),
);
const givenCartStartsEmpty = Bdd.step`the cart starts empty`(() => Effect.succeed(emptyCart));
const whenItemAdded = Bdd.when`${qty} ${sku} are added at ${price} each`(
  ({ qty, sku, price }, state: Cart) => Effect.succeed(addItem(state, sku, qty, price)),
);
const whenTableItemsAdded = Bdd.when`the following items are added:`(
  Bdd.table(Item),
  (items, state: Cart) =>
    Effect.succeed(
      items.reduce((cart, item) => addItem(cart, item.sku, item.qty, item.price), state),
    ),
);
const givenRequestBody = Bdd.given`the request body is:`(
  Bdd.docString(Schema.fromJsonString(Payload)),
  (payload, state: Cart) => Effect.succeed({ ...state, payload }),
);
const thenSubtotal = Bdd.then`the subtotal is ${expected}`(({ expected }, state: Cart) =>
  subtotalOf(state) === expected
    ? Effect.succeed(state)
    : Effect.fail(`expected subtotal ${expected}, got ${subtotalOf(state)}` as const),
);
const thenTaxedTotal = Bdd.then`the taxed total is ${expected}`(({ expected }, state: Cart) =>
  Effect.gen(function* () {
    const taxRate = yield* TaxRate;
    const rate = state.taxEnabled ? taxRate.rate : 0;
    const actual = Math.round(subtotalOf(state) * (1 + rate));
    return actual === expected
      ? state
      : yield* Effect.fail(`expected taxed total ${expected}, got ${actual}` as const);
  }),
);
const thenPayloadAccepted = Bdd.then`the payload is accepted`((state: Cart) => {
  if (state.payload?.sku === "book" && state.payload.qty === 2) {
    return Effect.succeed(state);
  }
  return Effect.fail("expected payload to be accepted" as const);
});

const captureTotals = Bdd.scenario("capture totals include tax").pipe(
  Bdd.provide(TaxRateLive),
  givenEmptyCart,
  givenTaxEnabled,
  whenItemAdded,
  thenSubtotal,
  thenTaxedTotal,
);

const structuredArguments = Bdd.scenario("structured arguments update state").pipe(
  givenEmptyCart,
  givenTaxEnabled,
  givenRequestBody,
  whenTableItemsAdded,
  thenSubtotal,
  thenPayloadAccepted,
);

const outlineExamples = Bdd.scenario("outline examples start from initial state").pipe(
  givenEmptyCart,
  givenTaxEnabled,
  whenItemAdded,
  thenSubtotal,
);

const keywordAgnostic = Bdd.scenario("a wildcard step satisfies the given keyword").pipe(
  givenEmptyCart,
  givenTaxEnabled,
  givenCartStartsEmpty,
  whenTableItemsAdded,
  thenSubtotal,
);

export const kitchenSink = Bdd.feature("Effect BDD kitchen sink").pipe(
  captureTotals,
  structuredArguments,
  outlineExamples,
  keywordAgnostic,
);
