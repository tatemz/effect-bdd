import { assert, describe, it } from "@effect/vitest";
import { Context, Duration, Effect, Layer } from "effect";
import { Bdd } from "effect-bdd";
import {
  MatchError,
  ParseError,
  ScenarioSetupError,
  ScenarioTeardownError,
  ScenarioTeardownTimeoutError,
  StepError,
  StepTimeoutError,
} from "effect-bdd/Errors";

describe("public API", () => {
  describe("model titles", () => {
    it("exposes feature and scenario titles as domain labels", () => {
      const scenario = Bdd.scenario("Stubbed increment");
      const feature = Bdd.feature("Counter").pipe(scenario);

      assert.strictEqual(scenario.title, "Stubbed increment");
      assert.strictEqual(feature.title, "Counter");
    });

    it("freezes model values after construction", () => {
      const step = Bdd.when`increment`(() => Effect.succeed(1));
      const scenario = Bdd.scenario("Stubbed increment").pipe(step);
      const feature = Bdd.feature("Counter").pipe(scenario);

      assert.strictEqual(Object.isFrozen(step), true);
      assert.strictEqual(Object.isFrozen(scenario), true);
      assert.strictEqual(Object.isFrozen(feature), true);
      assert.throws(() => {
        Object.defineProperty(feature, "title", { value: "Mutated" });
      }, TypeError);
      assert.throws(() => {
        Object.defineProperty(scenario, "title", { value: "Mutated" });
      }, TypeError);
      assert.throws(() => {
        Object.defineProperty(step, "timeout", { value: Duration.seconds(1) });
      }, TypeError);
    });
  });

  describe("custom GherkinCompiler layer", () => {
    // A compiled feature equivalent to:
    //   Feature: Counter
    //     Scenario: Stubbed increment
    //       When increment
    const canned = {
      document: {
        comments: [],
        feature: {
          location: { line: 1, column: 1 },
          tags: [],
          language: "en",
          keyword: "Feature",
          name: "Counter",
          description: "",
          children: [
            {
              scenario: {
                location: { line: 2, column: 3 },
                tags: [],
                keyword: "Scenario",
                name: "Stubbed increment",
                description: "",
                steps: [
                  {
                    location: { line: 3, column: 5 },
                    keyword: "When ",
                    text: "increment",
                    id: "step-ast-1",
                  },
                ],
                examples: [],
                id: "scenario-ast-1",
              },
            },
          ],
        },
      },
      pickles: [
        {
          id: "pickle-1",
          uri: "<stub>",
          name: "Stubbed increment",
          language: "en",
          steps: [
            {
              id: "pickle-step-1",
              astNodeIds: ["step-ast-1"],
              type: "Action" as const,
              text: "increment",
            },
          ],
          tags: [],
          astNodeIds: ["scenario-ast-1"],
        },
      ],
    };

    const layerStub = Layer.succeed(
      Bdd.GherkinCompiler,
      Bdd.GherkinCompiler.of({
        compile: () => Effect.succeed(canned),
      }),
    );

    it.effect("Bdd.run compiles through the provided service", () =>
      Effect.gen(function* () {
        const feature = Bdd.feature("Counter").pipe(
          Bdd.scenario("Stubbed increment").pipe(Bdd.when`increment`(() => Effect.succeed(1))),
        );

        // Not valid Gherkin: proves the stub compiler is used instead of Cucumber.
        const report = yield* Bdd.run(feature, "this is not gherkin").pipe(
          Effect.provide(layerStub),
        );

        assert.deepStrictEqual(report, {
          feature: "Counter",
          scenarios: [{ title: "Stubbed increment", steps: 1, tags: [] }],
        });
      }),
    );
  });

  describe("step timeout metadata", () => {
    it("exposes a pipeable step timeout helper", () => {
      const step = Bdd.when`increment`(() => Effect.succeed(1)).pipe(
        Bdd.withTimeout(Duration.seconds(1)),
      );

      assert.strictEqual(step.kind, "When");
      assert.deepStrictEqual(step.timeout, Duration.seconds(1));
    });

    it("exposes a data-first step timeout helper", () => {
      const step = Bdd.withTimeout(
        Bdd.when`increment`(() => Effect.succeed(1)),
        Duration.seconds(1),
      );

      assert.strictEqual(step.kind, "When");
      assert.deepStrictEqual(step.timeout, Duration.seconds(1));
    });
  });

  describe("scenario providers", () => {
    class Greeting extends Context.Service<
      Greeting,
      {
        readonly message: string;
      }
    >()("Greeting") {}

    it("exposes a pipeable scenario provider helper", () => {
      const provider = Layer.succeed(Greeting, { message: "hello" });
      const scenario = Bdd.scenario("Uses provider").pipe(Bdd.provide(provider));

      assert.strictEqual(scenario.title, "Uses provider");
      assert.deepStrictEqual(scenario.providers, [provider]);
      assert.strictEqual(Object.isFrozen(scenario), true);
    });

    it("exposes a data-first scenario provider helper", () => {
      const provider = Layer.succeed(Greeting, { message: "hello" });
      const scenario = Bdd.provide(Bdd.scenario("Uses provider"), provider);

      assert.strictEqual(scenario.title, "Uses provider");
      assert.deepStrictEqual(scenario.providers, [provider]);
    });
  });

  describe("effect-bdd/Errors subpath", () => {
    it("exposes constructable tagged errors", () => {
      const parse = new ParseError({ message: "boom", line: 1, column: 2 });
      const match = new MatchError({
        message: "no match",
        scenario: "S",
        step: "increment",
        line: 3,
        candidates: ["decrement"],
      });
      const step = new StepError({
        message: "failed",
        scenario: "S",
        step: "increment",
        line: 4,
        cause: "expected 1, got 0",
      });
      const setup = new ScenarioSetupError({
        message: "setup failed",
        scenario: "S",
        line: 2,
        cause: "browser failed",
      });
      const teardown = new ScenarioTeardownError({
        message: "teardown failed",
        scenario: "S",
        line: 2,
        cause: "browser failed",
      });
      const teardownTimeout = new ScenarioTeardownTimeoutError({
        message: "Timed out after 1s",
        timeout: Duration.seconds(1),
      });
      const timeout = new StepTimeoutError({
        message: "Timed out after 1s",
        timeout: Duration.seconds(1),
      });

      assert.strictEqual(parse._tag, "ParseError");
      assert.strictEqual(match._tag, "MatchError");
      assert.strictEqual(step._tag, "StepError");
      assert.strictEqual(setup._tag, "ScenarioSetupError");
      assert.strictEqual(teardown._tag, "ScenarioTeardownError");
      assert.strictEqual(teardownTimeout._tag, "ScenarioTeardownTimeoutError");
      assert.strictEqual(timeout._tag, "StepTimeoutError");
      assert.instanceOf(parse, Error);
    });

    it("matches the error types surfaced by Bdd.run", () => {
      const error: Bdd.RunError = new ParseError({ message: "boom", line: 1, column: 1 });
      assert.strictEqual(error._tag, "ParseError");
    });

    it("exposes StepTimeoutError through the Bdd namespace", () => {
      const timeout = new Bdd.StepTimeoutError({
        message: "Timed out after 1s",
        timeout: Duration.seconds(1),
      });

      assert.strictEqual(Bdd.StepTimeoutError, StepTimeoutError);
      assert.strictEqual(Bdd.isStepTimeoutError(timeout), true);
      assert.strictEqual(Bdd.isStepTimeoutError(new Error("boom")), false);
    });
  });
});
