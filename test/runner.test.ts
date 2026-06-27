import { Bdd } from "effect-bdd";
import { assert, describe, it } from "@effect/vitest";
import { Context, Cause, Duration, Effect, Fiber, Layer, Option, Schema } from "effect";
import * as Arr from "effect/Array";
import * as Fn from "effect/Function";
import { TestClock } from "effect/testing";
import { assertMatchError, runBdd } from "./helpers.ts";

type Cart = {
  readonly items: ReadonlyArray<{
    readonly sku: string;
    readonly qty: number;
    readonly price: number;
  }>;
};

const emptyCart: Cart = { items: [] };

const addItem = (cart: Cart, sku: string, qty: number, price: number): Cart => ({
  items: [...cart.items, { sku, qty, price }],
});

const totalOf = (cart: Cart): number =>
  cart.items.reduce((sum, item) => sum + item.qty * item.price, 0);

describe("runner", () => {
  it.effect("runs scenario chains with evolving immutable state", () => {
    const qty = Bdd.capture("qty", Schema.NumberFromString);
    const sku = Bdd.capture("sku", Schema.String);
    const price = Bdd.capture("price", Schema.NumberFromString);
    const expected = Bdd.capture("expected", Schema.NumberFromString);

    const givenEmptyCart = Bdd.given`an empty cart`(() => Effect.succeed(emptyCart));
    const whenItemAdded = Bdd.when`${qty} ${sku} are added at ${price} each`(
      ({ qty, sku, price }, state: Cart) => Effect.succeed(addItem(state, sku, qty, price)),
    );
    const thenTotal = Bdd.then`the cart total is ${expected}`(({ expected }, state: Cart) =>
      Effect.sync(() => {
        assert.strictEqual(totalOf(state), expected);
        return state;
      }),
    );

    const cart = Bdd.feature("Shopping cart").pipe(
      Bdd.scenario("Adding items computes the total").pipe(
        givenEmptyCart,
        whenItemAdded,
        thenTotal,
      ),
    );

    return Effect.gen(function* () {
      const report = yield* runBdd(
        cart,
        `
Feature: Shopping cart

  Scenario: Adding items computes the total
    Given an empty cart
    When 2 book are added at 21 each
    Then the cart total is 42
`,
      );

      assert.deepStrictEqual(report, {
        feature: "Shopping cart",
        scenarios: [{ title: "Adding items computes the total", steps: 3, tags: [] }],
      });
    });
  });

  it.effect("fails when the feature definition name does not match the Gherkin feature", () =>
    assertMatchError(
      runBdd(
        Bdd.feature("Counter definition").pipe(
          Bdd.scenario("Starts clean").pipe(Bdd.then`the counter is 0`(() => Effect.succeed(0))),
        ),
        `
Feature: Counter source

  Scenario: Starts clean
    Then the counter is 0
`,
      ),
      /Feature definition "Counter definition" does not match Gherkin feature "Counter source"/,
    ),
  );

  it.effect("fails when a source scenario has no chain", () =>
    assertMatchError(
      runBdd(
        Bdd.feature("Shopping cart").pipe(
          Bdd.scenario("Different scenario").pipe(
            Bdd.given`an empty cart`(() => Effect.succeed(emptyCart)),
          ),
        ),
        `
Feature: Shopping cart

  Scenario: Missing chain
    Given an empty cart
`,
      ),
      /No scenario chain matched source scenario "Missing chain"/,
    ),
  );

  it.effect("fails when a chain has an extra or missing step", () =>
    assertMatchError(
      runBdd(
        Bdd.feature("Shopping cart").pipe(
          Bdd.scenario("Missing step").pipe(
            Bdd.given`an empty cart`(() => Effect.succeed(emptyCart)),
          ),
        ),
        `
Feature: Shopping cart

  Scenario: Missing step
    Given an empty cart
    Then the cart total is 0
`,
      ),
      /has 2 source step\(s\), but its chain has 1 step\(s\)/,
    ),
  );

  it.effect("fails when a chain step has the wrong keyword", () =>
    assertMatchError(
      runBdd(
        Bdd.feature("Keyword semantics").pipe(
          Bdd.scenario("Given requires given").pipe(
            Bdd.when`shared phrase`(() => Effect.succeed(0)),
          ),
        ),
        `
Feature: Keyword semantics

  Scenario: Given requires given
    Given shared phrase
`,
      ),
      /keyword mismatch/,
    ),
  );

  it.effect("allows Bdd.step to satisfy any concrete keyword position", () => {
    const shared = Bdd.step`shared phrase`(() => Effect.succeed(0));
    const feature = Bdd.feature("Keyword wildcard").pipe(
      Bdd.scenario("Given wildcard").pipe(shared),
      Bdd.scenario("When wildcard").pipe(shared),
      Bdd.scenario("Then wildcard").pipe(shared),
    );

    return Effect.gen(function* () {
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
`,
      );

      assert.deepStrictEqual(report.scenarios, [
        { title: "Given wildcard", steps: 1, tags: [] },
        { title: "When wildcard", steps: 1, tags: [] },
        { title: "Then wildcard", steps: 1, tags: [] },
      ]);
    });
  });

  it.effect("inherits concrete keyword semantics for And and But", () => {
    const setupState: ReadonlyArray<string> = ["setup"];
    const setup = Bdd.given`setup`(() => Effect.succeed(setupState));
    const moreSetup = Bdd.given`more setup`((state: ReadonlyArray<string>) =>
      Effect.succeed(Arr.append(state, "more setup")),
    );
    const act = Bdd.when`act`((state: ReadonlyArray<string>) =>
      Effect.succeed(Arr.append(state, "act")),
    );
    const fallback = Bdd.when`fallback action`((state: ReadonlyArray<string>) =>
      Effect.succeed(Arr.append(state, "fallback action")),
    );
    const done = Bdd.then`done`((state: ReadonlyArray<string>) =>
      Effect.sync(() => {
        assert.deepStrictEqual(state, ["setup", "more setup", "act", "fallback action"]);
        return state;
      }),
    );
    const feature = Bdd.feature("Keyword inheritance").pipe(
      Bdd.scenario("And and But inherit").pipe(setup, moreSetup, act, fallback, done),
    );

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
`,
    );
  });

  it.effect("decodes DataTables and DocStrings", () => {
    const Item = Schema.Struct({
      sku: Schema.String,
      qty: Schema.NumberFromString,
      price: Schema.NumberFromString,
    });
    const Payload = Schema.Struct({
      sku: Schema.String,
      qty: Schema.Number,
    });
    type State = {
      readonly cart: Cart;
      readonly payload?: Schema.Schema.Type<typeof Payload>;
    };
    const initialState: State = { cart: emptyCart };
    const givenEmpty = Bdd.given`an empty cart`(() => Effect.succeed(initialState));
    const whenItems = Bdd.when`the following items are added:`(
      Bdd.table(Item),
      (items, state: State) =>
        Effect.succeed({
          ...state,
          cart: items.reduce(
            (cart, item) => addItem(cart, item.sku, item.qty, item.price),
            state.cart,
          ),
        }),
    );
    const whenPayload = Bdd.when`the request body is:`(
      Bdd.docString(Schema.fromJsonString(Payload)),
      (payload, state: State) => Effect.succeed({ ...state, payload }),
    );
    const thenAccepted = Bdd.then`the payload is accepted`((state: State) =>
      Effect.sync(() => {
        assert.strictEqual(totalOf(state.cart), 57);
        assert.deepStrictEqual(state.payload, { sku: "book", qty: 2 });
        return state;
      }),
    );
    const feature = Bdd.feature("Shopping cart").pipe(
      Bdd.scenario("Structured arguments").pipe(givenEmpty, whenItems, whenPayload, thenAccepted),
    );

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
`,
    );
  });

  it.effect("preserves decode causes on MatchError", () => {
    const Item = Schema.Struct({
      sku: Schema.String,
      qty: Schema.Literal("2"),
    });
    const feature = Bdd.feature("Shopping cart").pipe(
      Bdd.scenario("Invalid table").pipe(
        Bdd.when`the following items are added:`(Bdd.table(Item), (items) => Effect.succeed(items)),
      ),
    );

    return Effect.gen(function* () {
      const result = yield* Effect.exit(
        runBdd(
          feature,
          `
Feature: Shopping cart

  Scenario: Invalid table
    When the following items are added:
      | sku  | qty |
      | book | nope |
`,
        ),
      );

      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        const error = Option.getOrThrow(Cause.findErrorOption(result.cause));
        assert.strictEqual(error._tag, "MatchError");
        assert.notStrictEqual(error.cause, undefined);
      }
    });
  });

  it.effect("fails with StepError when a step implementation fails", () => {
    const feature = Bdd.feature("Shopping cart").pipe(
      Bdd.scenario("Failed assertion").pipe(
        Bdd.then`the cart total is wrong`(() => Effect.fail("wrong total" as const)),
      ),
    );

    return Effect.gen(function* () {
      const result = yield* Effect.exit(
        runBdd(
          feature,
          `
Feature: Shopping cart

  Scenario: Failed assertion
    Then the cart total is wrong
`,
        ),
      );

      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        const error = Option.getOrThrow(Cause.findErrorOption(result.cause));
        assert.strictEqual(error._tag, "StepError");
        assert.strictEqual(error.cause, "wrong total");
      }
    });
  });

  it.effect("fails with StepError when a step exceeds the run timeout", () => {
    const feature = Bdd.feature("Timeouts").pipe(
      Bdd.scenario("Slow step").pipe(
        Bdd.when`the step hangs`(() => Effect.sleep(Duration.millis(50))),
      ),
    );

    return Effect.gen(function* () {
      const fiber = yield* Fn.pipe(
        runBdd(
          feature,
          `
Feature: Timeouts

  Scenario: Slow step
    When the step hangs
`,
          { stepTimeout: Duration.millis(1) },
        ),
        Effect.forkChild,
      );
      yield* TestClock.adjust(Duration.millis(1));
      const result = yield* Effect.exit(Fiber.join(fiber));

      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        const error = Option.getOrThrow(Cause.findErrorOption(result.cause));
        assert.strictEqual(error instanceof Bdd.StepError, true);
        if (error instanceof Bdd.StepError) {
          assert.match(error.message, /Step timed out after .*: the step hangs/);
          assert.strictEqual(error.cause instanceof Bdd.StepTimeoutError, true);
          if (error.cause instanceof Bdd.StepTimeoutError) {
            assert.deepStrictEqual(error.cause.timeout, Duration.millis(1));
          }
        }
      }
    });
  });

  it.effect("allows a step timeout override to replace the run timeout", () => {
    const feature = Bdd.feature("Timeouts").pipe(
      Bdd.scenario("Slow allowed step").pipe(
        Bdd.when`the step is slow but allowed`(() =>
          Effect.as(Effect.sleep(Duration.millis(5)), "ok"),
        ).pipe(Bdd.withTimeout(Duration.millis(100))),
        Bdd.then`the result is ok`((state: string) =>
          Effect.sync(() => {
            assert.strictEqual(state, "ok");
            return state;
          }),
        ),
      ),
    );

    return Effect.gen(function* () {
      const fiber = yield* Fn.pipe(
        runBdd(
          feature,
          `
Feature: Timeouts

  Scenario: Slow allowed step
    When the step is slow but allowed
    Then the result is ok
`,
          { stepTimeout: Duration.millis(1) },
        ),
        Effect.forkChild,
      );
      yield* TestClock.adjust(Duration.millis(100));
      const report = yield* Fiber.join(fiber);

      assert.deepStrictEqual(report, {
        feature: "Timeouts",
        scenarios: [{ title: "Slow allowed step", steps: 2, tags: [] }],
      });
    });
  });

  it.effect("keeps scoped step resources open until the scenario finishes", () => {
    const events: Array<string> = [];
    const givenPage = Bdd.given`the app is open`(() =>
      Effect.acquireRelease(
        Effect.sync(() => {
          events.push("open");
          return { open: true };
        }),
        () =>
          Effect.sync(() => {
            events.push("close");
          }),
      ),
    );
    const whenPageIsUsed = Bdd.when`the page is used`((page: { readonly open: boolean }) =>
      Effect.sync(() => {
        assert.deepStrictEqual(events, ["open"]);
        return page;
      }),
    );
    const thenPageIsStillOpen = Bdd.then`the page is still open`(
      (page: { readonly open: boolean }) =>
        Effect.sync(() => {
          assert.deepStrictEqual(events, ["open"]);
          return page;
        }),
    );
    const feature = Bdd.feature("Scoped resources").pipe(
      Bdd.scenario("Resource survives steps").pipe(givenPage, whenPageIsUsed, thenPageIsStillOpen),
    );

    return Effect.gen(function* () {
      yield* runBdd(
        feature,
        `
Feature: Scoped resources

  Scenario: Resource survives steps
    Given the app is open
    When the page is used
    Then the page is still open
`,
      );

      assert.deepStrictEqual(events, ["open", "close"]);
    });
  });

  it.effect("closes scoped step resources when a later step fails", () => {
    const events: Array<string> = [];
    const givenPage = Bdd.given`the app is open`(() =>
      Effect.acquireRelease(
        Effect.sync(() => {
          events.push("open");
          return {};
        }),
        () =>
          Effect.sync(() => {
            events.push("close");
          }),
      ),
    );
    const whenActionFails = Bdd.when`the action fails`(() => Effect.fail("boom" as const));
    const feature = Bdd.feature("Scoped resources").pipe(
      Bdd.scenario("Failure closes resource").pipe(givenPage, whenActionFails),
    );

    return Effect.gen(function* () {
      const result = yield* Effect.exit(
        runBdd(
          feature,
          `
Feature: Scoped resources

  Scenario: Failure closes resource
    Given the app is open
    When the action fails
`,
        ),
      );

      assert.strictEqual(result._tag, "Failure");
      assert.deepStrictEqual(events, ["open", "close"]);
    });
  });

  it.effect("closes scoped step resources when a later step times out", () => {
    const events: Array<string> = [];
    const givenPage = Bdd.given`the app is open`(() =>
      Effect.acquireRelease(
        Effect.sync(() => {
          events.push("open");
          return {};
        }),
        () =>
          Effect.sync(() => {
            events.push("close");
          }),
      ),
    );
    const whenActionHangs = Bdd.when`the action hangs`(() => Effect.sleep(Duration.millis(50)));
    const feature = Bdd.feature("Scoped resources").pipe(
      Bdd.scenario("Timeout closes resource").pipe(givenPage, whenActionHangs),
    );

    return Effect.gen(function* () {
      const fiber = yield* Fn.pipe(
        runBdd(
          feature,
          `
Feature: Scoped resources

  Scenario: Timeout closes resource
    Given the app is open
    When the action hangs
`,
          { stepTimeout: Duration.millis(1) },
        ),
        Effect.forkChild,
      );
      yield* TestClock.adjust(Duration.millis(1));
      const result = yield* Effect.exit(Fiber.join(fiber));

      assert.strictEqual(result._tag, "Failure");
      assert.deepStrictEqual(events, ["open", "close"]);
    });
  });

  it.effect("reports teardown failures against the scenario instead of the final step", () => {
    const givenBadResource = Bdd.given`a bad resource is open`(() =>
      Effect.acquireRelease(Effect.succeed({}), () => Effect.die("teardown failed")),
    );
    const thenAssertionPasses = Bdd.then`the assertion passes`((state: {}) =>
      Effect.succeed(state),
    );
    const feature = Bdd.feature("Scoped resources").pipe(
      Bdd.scenario("Teardown fails").pipe(givenBadResource, thenAssertionPasses),
    );

    return Effect.gen(function* () {
      const result = yield* Effect.exit(
        runBdd(
          feature,
          `
Feature: Scoped resources

  Scenario: Teardown fails
    Given a bad resource is open
    Then the assertion passes
`,
        ),
      );

      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        const error = Option.getOrThrow(Cause.findErrorOption(result.cause));
        assert.strictEqual(error instanceof Bdd.ScenarioTeardownError, true);
        if (error instanceof Bdd.ScenarioTeardownError) {
          assert.strictEqual(error.scenario, "Teardown fails");
        }
      }
    });
  });

  it.effect("provides scenario-local services to steps", () => {
    class Greeting extends Context.Service<
      Greeting,
      {
        readonly message: string;
      }
    >()("Greeting") {}

    const whenGreetingRead = Bdd.when`the greeting is read`(() =>
      Effect.gen(function* () {
        const greeting = yield* Greeting;
        return greeting.message;
      }),
    );
    const thenGreetingMatches = Bdd.then`the greeting is hello`((message: string) =>
      Effect.sync(() => {
        assert.strictEqual(message, "hello");
        return message;
      }),
    );
    const feature = Bdd.feature("Scenario providers").pipe(
      Bdd.scenario("Uses a provider").pipe(
        whenGreetingRead,
        thenGreetingMatches,
        Bdd.provide(Layer.succeed(Greeting, { message: "hello" })),
      ),
    );

    return runBdd(
      feature,
      `
Feature: Scenario providers

  Scenario: Uses a provider
    When the greeting is read
    Then the greeting is hello
`,
    );
  });

  it.effect("runs feature and rule backgrounds as explicit leading chain steps", () => {
    type State = ReadonlyArray<string>;
    const featureSetupState: State = ["feature"];
    const featureSetup = Bdd.given`feature setup`(() => Effect.succeed(featureSetupState));
    const ruleSetup = Bdd.given`rule setup`((state: State) =>
      Effect.succeed(Arr.append(state, "rule")),
    );
    const scenarioRuns = Bdd.when`scenario runs`((state: State) =>
      Effect.succeed(Arr.append(state, "scenario")),
    );
    const thenDone = Bdd.then`rule setup ran after feature setup`((state: State) =>
      Effect.sync(() => {
        assert.deepStrictEqual(state, ["feature", "rule", "scenario"]);
        return state;
      }),
    );
    const feature = Bdd.feature("Checkout").pipe(
      Bdd.scenario("Uses rule background").pipe(featureSetup, ruleSetup, scenarioRuns, thenDone),
    );

    return Effect.gen(function* () {
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
`,
      );

      assert.deepStrictEqual(report.scenarios, [
        {
          title: "Uses rule background",
          steps: 4,
          tags: ["@feature", "@rule", "@scenario"],
        },
      ]);
    });
  });
});
