import { Bdd } from "effect-bdd"
import { assert, describe, it } from "@effect/vitest"
import { Context, Effect, Schema } from "effect"
import { runError } from "./helpers.ts"

class TaxRate extends Context.Service<TaxRate, {
  readonly rate: number
}>()("TaxRate") {}

const Payload = Schema.Struct({
  sku: Schema.String,
  qty: Schema.Number
})

type LineItem = {
  readonly sku: string
  readonly qty: number
  readonly price: number
}

type Cart = {
  readonly items: ReadonlyArray<LineItem>
  readonly payload?: Schema.Schema.Type<typeof Payload>
}

const emptyCart: Cart = { items: [] }

const addItem = (cart: Cart, sku: string, qty: number, price: number): Cart => ({
  items: [...cart.items, { sku, qty, price }]
})

const subtotalOf = (cart: Cart): number => cart.items.reduce((sum, item) => sum + item.qty * item.price, 0)

const qty = Bdd.capture("qty", Schema.NumberFromString)
const sku = Bdd.capture("sku", Schema.String)
const price = Bdd.capture("price", Schema.NumberFromString)
const expected = Bdd.capture("expected", Schema.NumberFromString)

const Item = Schema.Struct({
  sku: Schema.String,
  qty: Schema.NumberFromString,
  price: Schema.NumberFromString
})

const givenEmptyCart = Bdd.given`an empty cart`(() => Effect.succeed(emptyCart))
const givenCartStartsEmpty = Bdd.step`the cart starts empty`(() => Effect.succeed(emptyCart))
const whenItemAdded = Bdd.when`${qty} ${sku} are added at ${price} each`(
  ({ qty, sku, price }, state: Cart) => Effect.succeed(addItem(state, sku, qty, price))
)
const whenItemsAdded = Bdd.when`the following items are added:`(
  Bdd.table(Item),
  (items, state: Cart) => Effect.succeed(items.reduce((cart, item) => addItem(cart, item.sku, item.qty, item.price), state))
)
const whenRequestBody = Bdd.when`the request body is:`(
  Bdd.docString(Schema.fromJsonString(Payload)),
  (payload, state: Cart) => Effect.succeed({ ...state, payload })
)
const thenSubtotal = Bdd.then`the subtotal is ${expected}`(({ expected }, state: Cart) => {
  const actual = subtotalOf(state)
  return actual === expected
    ? Effect.succeed(state)
    : Effect.fail(`expected subtotal ${expected}, got ${actual}` as const)
})
const thenTaxedTotal = Bdd.then`the taxed total is ${expected}`(({ expected }, state: Cart) =>
  Effect.gen(function*() {
    const taxRate = yield* TaxRate
    const actual = Math.round(subtotalOf(state) * (1 + taxRate.rate))
    return actual === expected
      ? state
      : yield* Effect.fail(`expected taxed total ${expected}, got ${actual}` as const)
  })
)
const thenPayloadAccepted = Bdd.then`the payload is accepted`((state: Cart) => {
  assert.deepStrictEqual(state.payload, { sku: "book", qty: 2 })
  return Effect.succeed(state)
})
const thenNoDuplicate = Bdd.then`no duplicate charge is made`((state: Cart) => Effect.succeed(state))
const thenAnyKeyword = Bdd.then`the scenario can finish with any keyword`((state: Cart) => {
  assert.strictEqual(subtotalOf(state), 0)
  return Effect.succeed(state)
})

const shoppingCart = Bdd.feature("Shopping cart").pipe(
  Bdd.scenario("Capture based item with a service-backed assertion").pipe(
    givenEmptyCart,
    whenItemAdded,
    thenSubtotal,
    thenTaxedTotal
  ),
  Bdd.scenario("DataTable plus And / But keyword inheritance").pipe(
    givenEmptyCart,
    whenItemsAdded,
    whenItemAdded,
    thenSubtotal,
    thenNoDuplicate
  ),
  Bdd.scenario("DocString JSON payload").pipe(
    givenEmptyCart,
    whenRequestBody,
    thenPayloadAccepted
  ),
  Bdd.scenario("Bdd.step can match any concrete keyword").pipe(
    givenEmptyCart,
    givenCartStartsEmpty,
    thenAnyKeyword
  )
)

const runShoppingCart = (source: string) =>
  Bdd.run(shoppingCart, source).pipe(
    Effect.provide(Bdd.layerCucumber),
    Effect.provideService(TaxRate, { rate: 0.1 })
  )

const singleScenarioShoppingCart = Bdd.feature("Shopping cart").pipe(
  Bdd.scenario("Capture based item with a service-backed assertion").pipe(
    givenEmptyCart,
    whenItemAdded,
    thenSubtotal,
    thenTaxedTotal
  )
)

const runSingleScenarioShoppingCart = (source: string) =>
  Bdd.run(singleScenarioShoppingCart, source).pipe(
    Effect.provide(Bdd.layerCucumber),
    Effect.provideService(TaxRate, { rate: 0.1 })
  )

const parseFailureShoppingCart = Bdd.feature("Shopping cart").pipe(
  Bdd.scenario("Capture based item with a service-backed assertion").pipe(givenEmptyCart)
)

const feature = `
@checkout
Feature: Shopping cart
  This file is the source of truth for the behavior.

  Background:
    Given an empty cart

  Scenario: Capture based item with a service-backed assertion
    When 2 book are added at 21 each
    Then the subtotal is 42
    And the taxed total is 46

  @happy-path
  Scenario: DataTable plus And / But keyword inheritance
    When the following items are added:
      | sku      | qty | price |
      | book     | 2   | 21    |
      | notebook | 3   | 5     |
    And 1 pen are added at 15 each
    Then the subtotal is 72
    But no duplicate charge is made

  @json
  Scenario: DocString JSON payload
    When the request body is:
      """json
      { "sku": "book", "qty": 2 }
      """
    Then the payload is accepted

  @keyword-agnostic
  Scenario: Bdd.step can match any concrete keyword
    Given the cart starts empty
    Then the scenario can finish with any keyword
`

const stepFailureFeature = `
Feature: Shopping cart

  Scenario: Capture based item with a service-backed assertion
    Given an empty cart
    When 2 book are added at 21 each
    Then the subtotal is 99
    And the taxed total is 46
`

const matchFailureFeature = `
Feature: Shopping cart

  Scenario: Capture based item with a service-backed assertion
    Given an empty cart
    When 1 pencil is added
    Then the subtotal is 1
    And the taxed total is 1
`

const parseFailureFeature = `
Feature: Shopping cart

  Scenario: Capture based item with a service-backed assertion
    And an empty cart
`

describe("developer experience", () => {
  it.effect("runs a feature as explicit scenario chains", () =>
    Effect.gen(function*() {
      const report = yield* runShoppingCart(feature)

      assert.deepStrictEqual(report, {
        feature: "Shopping cart",
        scenarios: [
          { name: "Capture based item with a service-backed assertion", steps: 4, tags: ["@checkout"] },
          { name: "DataTable plus And / But keyword inheritance", steps: 5, tags: ["@checkout", "@happy-path"] },
          { name: "DocString JSON payload", steps: 3, tags: ["@checkout", "@json"] },
          { name: "Bdd.step can match any concrete keyword", steps: 3, tags: ["@checkout", "@keyword-agnostic"] }
        ]
      })
    }))

  it.effect("surfaces ParseError, MatchError, and StepError as typed failures", () =>
    Effect.gen(function*() {
      const stepError = yield* runError(runSingleScenarioShoppingCart(stepFailureFeature))
      assert.strictEqual(stepError._tag, "StepError")
      assert.strictEqual((stepError as { readonly cause: unknown }).cause, "expected subtotal 99, got 42")

      const matchError = yield* runError(runSingleScenarioShoppingCart(matchFailureFeature))
      assert.strictEqual(matchError._tag, "MatchError")
      assert.deepStrictEqual((matchError as { readonly candidates: ReadonlyArray<string> }).candidates, [
        "{qty} {sku} are added at {price} each"
      ])

      const parseError = yield* runError(Bdd.run(parseFailureShoppingCart, parseFailureFeature).pipe(
        Effect.provide(Bdd.layerCucumber)
      ))
      assert.strictEqual(parseError._tag, "ParseError")
      assert.strictEqual(
        (parseError as { readonly message: string }).message,
        "And found before a Given, When, or Then step"
      )
    }))
})
