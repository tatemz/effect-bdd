import { Bdd } from "effect-bdd"
import { assert, describe, it } from "@effect/vitest"
import { Cause, Effect, Option, Schema } from "effect"
import * as Arr from "effect/Array"
import { assertMatchError, runBdd } from "./helpers.ts"

type Cart = {
  readonly items: ReadonlyArray<{
    readonly sku: string
    readonly qty: number
    readonly price: number
  }>
}

const emptyCart: Cart = { items: [] }

const addItem = (cart: Cart, sku: string, qty: number, price: number): Cart => ({
  items: [...cart.items, { sku, qty, price }]
})

const totalOf = (cart: Cart): number => cart.items.reduce((sum, item) => sum + item.qty * item.price, 0)

describe("runner", () => {
  it.effect("runs scenario chains with evolving immutable state", () => {
    const qty = Bdd.capture("qty", Schema.NumberFromString)
    const sku = Bdd.capture("sku", Schema.String)
    const price = Bdd.capture("price", Schema.NumberFromString)
    const expected = Bdd.capture("expected", Schema.NumberFromString)

    const givenEmptyCart = Bdd.given`an empty cart`(() => Effect.succeed(emptyCart))
    const whenItemAdded = Bdd.when`${qty} ${sku} are added at ${price} each`(
      ({ qty, sku, price }, state: Cart) => Effect.succeed(addItem(state, sku, qty, price))
    )
    const thenTotal = Bdd.then`the cart total is ${expected}`(({ expected }, state: Cart) =>
      Effect.sync(() => {
        assert.strictEqual(totalOf(state), expected)
        return state
      })
    )

    const cart = Bdd.feature("Shopping cart").pipe(
      Bdd.scenario("Adding items computes the total").pipe(
        givenEmptyCart,
        whenItemAdded,
        thenTotal
      )
    )

    return Effect.gen(function*() {
      const report = yield* runBdd(
        cart,
        `
Feature: Shopping cart

  Scenario: Adding items computes the total
    Given an empty cart
    When 2 book are added at 21 each
    Then the cart total is 42
`
      )

      assert.deepStrictEqual(report, {
        feature: "Shopping cart",
        scenarios: [{ name: "Adding items computes the total", steps: 3, tags: [] }]
      })
    })
  })

  it.effect("fails when the feature definition name does not match the Gherkin feature", () =>
    assertMatchError(
      runBdd(
        Bdd.feature("Counter definition").pipe(
          Bdd.scenario("Starts clean").pipe(
            Bdd.then`the counter is 0`(() => Effect.succeed(0))
          )
        ),
        `
Feature: Counter source

  Scenario: Starts clean
    Then the counter is 0
`
      ),
      /Feature definition "Counter definition" does not match Gherkin feature "Counter source"/
    ))

  it.effect("fails when a source scenario has no chain", () =>
    assertMatchError(
      runBdd(
        Bdd.feature("Shopping cart").pipe(
          Bdd.scenario("Different scenario").pipe(
            Bdd.given`an empty cart`(() => Effect.succeed(emptyCart))
          )
        ),
        `
Feature: Shopping cart

  Scenario: Missing chain
    Given an empty cart
`
      ),
      /No scenario chain matched source scenario "Missing chain"/
    ))

  it.effect("fails when a chain has an extra or missing step", () =>
    assertMatchError(
      runBdd(
        Bdd.feature("Shopping cart").pipe(
          Bdd.scenario("Missing step").pipe(
            Bdd.given`an empty cart`(() => Effect.succeed(emptyCart))
          )
        ),
        `
Feature: Shopping cart

  Scenario: Missing step
    Given an empty cart
    Then the cart total is 0
`
      ),
      /has 2 source step\(s\), but its chain has 1 step\(s\)/
    ))

  it.effect("fails when a chain step has the wrong keyword", () =>
    assertMatchError(
      runBdd(
        Bdd.feature("Keyword semantics").pipe(
          Bdd.scenario("Given requires given").pipe(
            Bdd.when`shared phrase`(() => Effect.succeed(0))
          )
        ),
        `
Feature: Keyword semantics

  Scenario: Given requires given
    Given shared phrase
`
      ),
      /keyword mismatch/
    ))

  it.effect("allows Bdd.step to satisfy any concrete keyword position", () => {
    const shared = Bdd.step`shared phrase`(() => Effect.succeed(0))
    const feature = Bdd.feature("Keyword wildcard").pipe(
      Bdd.scenario("Given wildcard").pipe(shared),
      Bdd.scenario("When wildcard").pipe(shared),
      Bdd.scenario("Then wildcard").pipe(shared)
    )

    return Effect.gen(function*() {
      const report = yield* runBdd(
        feature,
        `
Feature: Keyword wildcard

  Scenario: Given wildcard
    Given shared phrase

  Scenario: When wildcard
    When shared phrase

  Scenario: Then wildcard
    Then shared phrase
`
      )

      assert.deepStrictEqual(report.scenarios, [
        { name: "Given wildcard", steps: 1, tags: [] },
        { name: "When wildcard", steps: 1, tags: [] },
        { name: "Then wildcard", steps: 1, tags: [] }
      ])
    })
  })

  it.effect("inherits concrete keyword semantics for And and But", () => {
    const setup = Bdd.given`setup`(() => Effect.succeed(["setup"] as ReadonlyArray<string>))
    const moreSetup = Bdd.given`more setup`((state: ReadonlyArray<string>) =>
      Effect.succeed(Arr.append(state, "more setup"))
    )
    const act = Bdd.when`act`((state: ReadonlyArray<string>) => Effect.succeed(Arr.append(state, "act")))
    const fallback = Bdd.when`fallback action`((state: ReadonlyArray<string>) =>
      Effect.succeed(Arr.append(state, "fallback action"))
    )
    const done = Bdd.then`done`((state: ReadonlyArray<string>) =>
      Effect.sync(() => {
        assert.deepStrictEqual(state, ["setup", "more setup", "act", "fallback action"])
        return state
      })
    )
    const feature = Bdd.feature("Keyword inheritance").pipe(
      Bdd.scenario("And and But inherit").pipe(setup, moreSetup, act, fallback, done)
    )

    return runBdd(
      feature,
      `
Feature: Keyword inheritance

  Scenario: And and But inherit
    Given setup
    And more setup
    When act
    But fallback action
    Then done
`
    )
  })

  it.effect("decodes DataTables and DocStrings", () => {
    const Item = Schema.Struct({
      sku: Schema.String,
      qty: Schema.NumberFromString,
      price: Schema.NumberFromString
    })
    const Payload = Schema.Struct({
      sku: Schema.String,
      qty: Schema.Number
    })
    type State = {
      readonly cart: Cart
      readonly payload?: Schema.Schema.Type<typeof Payload>
    }
    const givenEmpty = Bdd.given`an empty cart`(() => Effect.succeed({ cart: emptyCart } as State))
    const whenItems = Bdd.when`the following items are added:`(
      Bdd.table(Item),
      (items, state: State) =>
        Effect.succeed({
          ...state,
          cart: items.reduce((cart, item) => addItem(cart, item.sku, item.qty, item.price), state.cart)
        })
    )
    const whenPayload = Bdd.when`the request body is:`(
      Bdd.docString(Schema.fromJsonString(Payload)),
      (payload, state: State) => Effect.succeed({ ...state, payload })
    )
    const thenAccepted = Bdd.then`the payload is accepted`((state: State) =>
      Effect.sync(() => {
        assert.strictEqual(totalOf(state.cart), 57)
        assert.deepStrictEqual(state.payload, { sku: "book", qty: 2 })
        return state
      })
    )
    const feature = Bdd.feature("Shopping cart").pipe(
      Bdd.scenario("Structured arguments").pipe(givenEmpty, whenItems, whenPayload, thenAccepted)
    )

    return runBdd(
      feature,
      `
Feature: Shopping cart

  Scenario: Structured arguments
    Given an empty cart
    When the following items are added:
      | sku      | qty | price |
      | book     | 2   | 21    |
      | notebook | 3   | 5     |
    When the request body is:
      """json
      { "sku": "book", "qty": 2 }
      """
    Then the payload is accepted
`
    )
  })

  it.effect("preserves decode causes on MatchError", () => {
    const Item = Schema.Struct({
      sku: Schema.String,
      qty: Schema.Literal("2")
    })
    const feature = Bdd.feature("Shopping cart").pipe(
      Bdd.scenario("Invalid table").pipe(
        Bdd.when`the following items are added:`(
          Bdd.table(Item),
          (items) => Effect.succeed(items)
        )
      )
    )

    return Effect.gen(function*() {
      const result = yield* Effect.exit(runBdd(
        feature,
        `
Feature: Shopping cart

  Scenario: Invalid table
    When the following items are added:
      | sku  | qty |
      | book | nope |
`
      ))

      assert.strictEqual(result._tag, "Failure")
      if (result._tag === "Failure") {
        const error = Option.getOrThrow(Cause.findErrorOption(result.cause)) as Bdd.RunError
        assert.strictEqual(error._tag, "MatchError")
        assert.notStrictEqual(error.cause, undefined)
      }
    })
  })

  it.effect("fails with StepError when a step implementation fails", () => {
    const feature = Bdd.feature("Shopping cart").pipe(
      Bdd.scenario("Failed assertion").pipe(
        Bdd.then`the cart total is wrong`(() => Effect.fail("wrong total" as const))
      )
    )

    return Effect.gen(function*() {
      const result = yield* Effect.exit(runBdd(
        feature,
        `
Feature: Shopping cart

  Scenario: Failed assertion
    Then the cart total is wrong
`
      ))

      assert.strictEqual(result._tag, "Failure")
      if (result._tag === "Failure") {
        const error = Option.getOrThrow(Cause.findErrorOption(result.cause)) as Bdd.RunError
        assert.strictEqual(error._tag, "StepError")
        assert.strictEqual(error.cause, "wrong total")
      }
    })
  })

  it.effect("runs feature and rule backgrounds as explicit leading chain steps", () => {
    type State = ReadonlyArray<string>
    const featureSetup = Bdd.given`feature setup`(() => Effect.succeed(["feature"] as State))
    const ruleSetup = Bdd.given`rule setup`((state: State) => Effect.succeed(Arr.append(state, "rule")))
    const scenarioRuns = Bdd.when`scenario runs`((state: State) => Effect.succeed(Arr.append(state, "scenario")))
    const thenDone = Bdd.then`rule setup ran after feature setup`((state: State) =>
      Effect.sync(() => {
        assert.deepStrictEqual(state, ["feature", "rule", "scenario"])
        return state
      })
    )
    const feature = Bdd.feature("Checkout").pipe(
      Bdd.scenario("Uses rule background").pipe(featureSetup, ruleSetup, scenarioRuns, thenDone)
    )

    return Effect.gen(function*() {
      const report = yield* runBdd(
        feature,
        `
@feature
Feature: Checkout

  Background:
    Given feature setup

  @rule
  Rule: Paid accounts
    Background:
      Given rule setup

    @scenario
    Scenario: Uses rule background
      When scenario runs
      Then rule setup ran after feature setup
`
      )

      assert.deepStrictEqual(report.scenarios, [{
        name: "Uses rule background",
        steps: 4,
        tags: ["@feature", "@rule", "@scenario"]
      }])
    })
  })
})
