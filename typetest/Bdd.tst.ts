import { Bdd } from "effect-bdd";
import { Context, Duration, Effect, Layer, Schema, Scope } from "effect";
import { describe, expect, test } from "tstyche";

interface TimeoutInventory {
  readonly _: unique symbol;
}

const runTimeoutStep = (state: number): Effect.Effect<string, "boom", TimeoutInventory> =>
  Effect.succeed(String(state));

describe("Bdd", () => {
  test("captures infer a named struct", () => {
    const qty = Bdd.capture("qty", Schema.NumberFromString);
    const sku = Bdd.capture("sku", Schema.String);

    Bdd.when`${qty} ${sku} are added`(
      (captures: { readonly qty: number; readonly sku: string }, state: number) => {
        const { qty, sku } = captures;
        expect(qty).type.toBe<number>();
        expect(sku).type.toBe<string>();
        expect(state).type.toBe<number>();
        return Effect.succeed(state);
      },
    );

    expect(Bdd.when`${qty} ${sku} are added`).type.not.toBeCallableWith(
      (_captures: { readonly qty: number; readonly missing: never }, state: number) =>
        Effect.succeed(state),
    );
  });

  test("captures require string encoded schemas", () => {
    expect(Bdd.capture).type.not.toBeCallableWith("qty", Schema.Number);
  });

  test("isFeature narrows unknown values to Feature", () => {
    const value: unknown = Bdd.feature("Counter");

    if (Bdd.isFeature(value)) {
      expect(value).type.toBe<Bdd.Feature<unknown, unknown>>();
    }

    expect(Bdd.isFeature).type.toBeCallableWith({});
  });

  test("feature definitions carry the Feature brand", () => {
    const feature = Bdd.feature("Counter");

    expect(feature).type.toBeAssignableTo<Bdd.Feature>();
    expect(feature.title).type.toBe<string>();
    expect<Bdd.Feature>().type.not.toBeAssignableTo<{ readonly name: string }>();
    expect<{
      readonly title: string;
      readonly scenarios: ReadonlyArray<never>;
    }>().type.not.toBeAssignableTo<Bdd.Feature>();
  });

  test("scenario chains evolve state through pipe", () => {
    const givenNoCounter = Bdd.given`no counter exists`(() => Effect.void);
    const whenCreated = Bdd.when`the counter is created`(() => Effect.succeed({ value: 0 }));
    const thenZero = Bdd.then`the counter value is zero`((state: { readonly value: number }) => {
      expect(state.value).type.toBe<number>();
      return Effect.succeed(state);
    });

    const scenario = Bdd.scenario("Creating a counter").pipe(givenNoCounter, whenCreated, thenZero);

    expect(scenario).type.toBe<Bdd.Scenario<{ readonly value: number }, never, never>>();
    expect(scenario.title).type.toBe<string>();
  });

  test("scenario pipe rejects incompatible step state", () => {
    const givenNumber = Bdd.given`a number`(() => Effect.succeed(1));
    const thenString = Bdd.then`a string`((state: string) => Effect.succeed(state));
    const scenario = Bdd.scenario("Bad chain").pipe(givenNumber);

    expect(thenString).type.not.toBeCallableWith(scenario);
  });

  test("features accumulate errors and services from scenario chains", () => {
    interface Inventory {
      readonly _: unique symbol;
    }
    interface Pricing {
      readonly _: unique symbol;
    }

    const scenario = Bdd.scenario("Failure").pipe(
      Bdd.given`zero`((): Effect.Effect<number, "given failed", Inventory> => Effect.succeed(0)),
      Bdd.when`increment`(
        (state: number): Effect.Effect<number, "when failed", Pricing> => Effect.succeed(state + 1),
      ),
      Bdd.then`one`((state: number): Effect.Effect<number, "then failed"> => Effect.succeed(state)),
    );

    const feature = Bdd.feature("Counter").pipe(scenario);

    expect(feature).type.toBe<
      Bdd.Feature<"given failed" | "when failed" | "then failed", Inventory | Pricing>
    >();
  });

  test("run returns a report with run errors and feature services", () => {
    interface Inventory {
      readonly _: unique symbol;
    }

    const feature = Bdd.feature("Counter").pipe(
      Bdd.scenario("Needs inventory").pipe(
        Bdd.when`needs inventory`((): Effect.Effect<number, never, Inventory> => Effect.succeed(0)),
      ),
    );

    expect(Bdd.run(feature, "Feature: Counter")).type.toBe<
      Effect.Effect<Bdd.Report, Bdd.RunError, Inventory | Bdd.GherkinCompiler>
    >();
    expect(Bdd.run(feature, "Feature: Counter", { stepTimeout: Duration.seconds(1) })).type.toBe<
      Effect.Effect<Bdd.Report, Bdd.RunError, Inventory | Bdd.GherkinCompiler>
    >();
    expect(Bdd.run).type.not.toBeCallableWith(feature, "Feature: Counter", {
      stepTimeout: "1 second",
    });
    expect<Bdd.Report["scenarios"][number]>().type.toBe<{
      readonly title: string;
      readonly steps: number;
      readonly tags: ReadonlyArray<string>;
    }>();
    expect<Bdd.Report["scenarios"][number]>().type.not.toBeAssignableTo<{
      readonly name: string;
    }>();
  });

  test("withTimeout preserves step type information", () => {
    const step = Bdd.when`needs inventory`(runTimeoutStep);
    const timed = step.pipe(Bdd.withTimeout(Duration.seconds(1)));
    const timedDataFirst = Bdd.withTimeout(step, Duration.seconds(1));

    expect(timed).type.toBe<
      Bdd.Step<"When", number, string, "boom", TimeoutInventory, {}, undefined>
    >();
    expect(timedDataFirst).type.toBe<
      Bdd.Step<"When", number, string, "boom", TimeoutInventory, {}, undefined>
    >();
    expect(Bdd.withTimeout).type.not.toBeCallableWith(step, "1 second");
  });

  test("run consumes Scope requirements from scenario steps", () => {
    interface Inventory {
      readonly _: unique symbol;
    }

    const feature = Bdd.feature("Scoped").pipe(
      Bdd.scenario("Needs scope").pipe(
        Bdd.given`a scoped resource`(
          (): Effect.Effect<number, never, Scope.Scope | Inventory> => Effect.succeed(1),
        ),
      ),
    );

    expect(Bdd.run(feature, "Feature: Scoped")).type.toBe<
      Effect.Effect<Bdd.Report, Bdd.RunError, Inventory | Bdd.GherkinCompiler>
    >();
  });

  test("provide removes layer services from scenario requirements", () => {
    class Inventory extends Context.Service<
      Inventory,
      {
        readonly count: number;
      }
    >()("Inventory") {}
    interface Database {
      readonly _: unique symbol;
    }

    const providerEffect: Effect.Effect<{ readonly count: number }, "provider failed", Database> =
      Effect.succeed({ count: 1 });

    const scenario = Bdd.scenario("Needs inventory").pipe(
      Bdd.given`inventory is available`(
        (): Effect.Effect<number, "step failed", Inventory> => Effect.succeed(1),
      ),
      Bdd.provide(Layer.effect(Inventory, providerEffect)),
    );
    const dataFirst = Bdd.provide(
      Bdd.scenario("Data first"),
      Layer.succeed(Inventory, { count: 1 }),
    );

    expect(scenario).type.toBe<Bdd.Scenario<number, "step failed" | "provider failed", Database>>();
    expect(dataFirst).type.toBe<Bdd.Scenario<void, never, never>>();
    expect(Bdd.provide).type.not.toBeCallableWith(Bdd.scenario("Bad"), "not a layer");
  });

  test("docstrings and data tables infer decoded argument types", () => {
    const Payload = Schema.Struct({
      sku: Schema.String,
    });
    const Item = Schema.Struct({
      sku: Schema.String,
      qty: Schema.NumberFromString,
    });

    Bdd.when`the request body is:`(
      Bdd.docString(Schema.fromJsonString(Payload)),
      (payload: { readonly sku: string }, state: number) => {
        expect(payload).type.toBe<{ readonly sku: string }>();
        expect(state).type.toBe<number>();
        return Effect.succeed(state);
      },
    );

    Bdd.when`the following items are added:`(
      Bdd.table(Item),
      (items: ReadonlyArray<{ readonly sku: string; readonly qty: number }>, state: number) => {
        expect(items).type.toBe<ReadonlyArray<{ readonly sku: string; readonly qty: number }>>();
        expect(state).type.toBe<number>();
        return Effect.succeed(state);
      },
    );
  });

  test("step argument handlers reject the wrong decoded argument type", () => {
    const Payload = Schema.Struct({
      sku: Schema.String,
    });
    const Item = Schema.Struct({
      sku: Schema.String,
      qty: Schema.NumberFromString,
    });

    expect(Bdd.when`the request body is:`).type.not.toBeCallableWith(
      Bdd.docString(Schema.fromJsonString(Payload)),
      (_payload: { readonly sku: number }, state: number) => Effect.succeed(state),
    );

    expect(Bdd.when`the following items are added:`).type.not.toBeCallableWith(
      Bdd.table(Item),
      (_items: ReadonlyArray<{ readonly sku: string; readonly qty: string }>, state: number) =>
        Effect.succeed(state),
    );
  });
});
