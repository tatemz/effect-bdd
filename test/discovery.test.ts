import { Bdd } from "effect-bdd";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import * as Discovery from "../src/internal/discovery.ts";
import * as Parser from "../src/internal/parser.ts";

const parseFeature = (source: string) =>
  Parser.parse(source, "test.feature").pipe(Effect.provide(Bdd.layerCucumber));

describe("discovery", () => {
  it.effect("reports feature title mismatches before task discovery", () =>
    Effect.gen(function* () {
      const feature = Bdd.feature("Counter definition").pipe(
        Bdd.scenario("Starts clean").pipe(Bdd.given`zero`(() => Effect.void)),
      );
      const parsed = yield* parseFeature(`
Feature: Counter source

  Scenario: Starts clean
    Given zero
`);

      const result = Discovery.buildScenarioTasks(feature, parsed);

      assert.deepStrictEqual(result, {
        tasks: [],
        issues: [
          {
            _tag: "FeatureTitleMismatch",
            definitionTitle: "Counter definition",
            featureTitle: "Counter source",
            line: 2,
          },
        ],
      });
    }),
  );

  it.effect("builds shared scenario task metadata", () =>
    Effect.gen(function* () {
      const feature = Bdd.feature("Shopping cart").pipe(
        Bdd.scenario("Adding items").pipe(Bdd.given`an empty cart`(() => Effect.void)),
      );
      const parsed = yield* parseFeature(`
Feature: Shopping cart

  Rule: Pricing

    @fast
    Scenario: Adding items
      Given an empty cart
`);

      const result = Discovery.buildScenarioTasks(feature, parsed);

      assert.deepStrictEqual(result.issues, []);
      assert.strictEqual(result.tasks.length, 1);
      assert.deepStrictEqual(
        {
          featureTitle: result.tasks[0].featureTitle,
          scenarioTitle: result.tasks[0].scenarioTitle,
          sourceScenarioTitle: result.tasks[0].sourceScenarioTitle,
          ruleTitle: result.tasks[0].ruleTitle,
          tags: result.tasks[0].tags,
        },
        {
          featureTitle: "Shopping cart",
          scenarioTitle: "Adding items",
          sourceScenarioTitle: "Adding items",
          ruleTitle: "Pricing",
          tags: ["@fast"],
        },
      );
    }),
  );

  it.effect("reports unmatched source scenarios", () =>
    Effect.gen(function* () {
      const feature = Bdd.feature("Counter").pipe(
        Bdd.scenario("Starts clean").pipe(Bdd.given`zero`(() => Effect.void)),
      );
      const parsed = yield* parseFeature(`
Feature: Counter

  Scenario: Starts clean
    Given zero

  Scenario: Increments
    When increment
`);

      const result = Discovery.buildScenarioTasks(feature, parsed);

      assert.deepStrictEqual(result.issues, [
        {
          _tag: "UnmatchedScenario",
          scenarioTitle: "Increments",
          scenarioLine: 7,
          candidates: ["Starts clean"],
        },
      ]);
    }),
  );

  it.effect("orders source issues before unused definitions", () =>
    Effect.gen(function* () {
      const feature = Bdd.feature("Counter").pipe(
        Bdd.scenario("Starts clean").pipe(Bdd.given`zero`(() => Effect.void)),
        Bdd.scenario("Unused chain").pipe(Bdd.when`unused`(() => Effect.void)),
      );
      const parsed = yield* parseFeature(`
Feature: Counter

  Scenario: Starts clean
    Given zero

  Scenario: Increments
    When increment
`);

      const result = Discovery.buildScenarioTasks(feature, parsed);

      assert.deepStrictEqual(result.issues, [
        {
          _tag: "UnmatchedScenario",
          scenarioTitle: "Increments",
          scenarioLine: 7,
          candidates: ["Starts clean", "Unused chain"],
        },
        {
          _tag: "UnusedScenarioDefinition",
          scenarioTitle: "Unused chain",
          candidates: ["Starts clean", "Increments"],
        },
      ]);
    }),
  );

  it.effect("reports unused scenario chains", () =>
    Effect.gen(function* () {
      const feature = Bdd.feature("Counter").pipe(
        Bdd.scenario("Starts clean").pipe(Bdd.given`zero`(() => Effect.void)),
        Bdd.scenario("Unused chain").pipe(Bdd.when`unused`(() => Effect.void)),
      );
      const parsed = yield* parseFeature(`
Feature: Counter

  Scenario: Starts clean
    Given zero
`);

      const result = Discovery.buildScenarioTasks(feature, parsed);

      assert.deepStrictEqual(result.issues, [
        {
          _tag: "UnusedScenarioDefinition",
          scenarioTitle: "Unused chain",
          candidates: ["Starts clean"],
        },
      ]);
    }),
  );

  it.effect("reports duplicate scenario chain titles", () =>
    Effect.gen(function* () {
      const feature = Bdd.feature("Counter").pipe(
        Bdd.scenario("Duplicate").pipe(Bdd.given`zero`(() => Effect.void)),
        Bdd.scenario("Duplicate").pipe(Bdd.when`one`(() => Effect.void)),
      );
      const parsed = yield* parseFeature(`
Feature: Counter

  Scenario: Duplicate
    Given zero
`);

      const result = Discovery.buildScenarioTasks(feature, parsed);

      assert.deepStrictEqual(result.issues, [
        {
          _tag: "DuplicateScenarioDefinition",
          scenarioTitle: "Duplicate",
        },
      ]);
    }),
  );

  it.effect("reports duplicate Gherkin titles before unused definitions", () =>
    Effect.gen(function* () {
      const feature = Bdd.feature("Counter").pipe(
        Bdd.scenario("Duplicate").pipe(Bdd.given`zero`(() => Effect.void)),
        Bdd.scenario("Unused chain").pipe(Bdd.when`unused`(() => Effect.void)),
      );
      const parsed = yield* parseFeature(`
Feature: Counter

  Scenario: Duplicate
    Given zero

  Scenario: Duplicate
    Given zero
`);

      const result = Discovery.buildScenarioTasks(feature, parsed);

      assert.deepStrictEqual(result.issues, [
        {
          _tag: "DuplicateSourceScenario",
          scenarioTitle: "Duplicate",
          scenarioLine: 7,
        },
        {
          _tag: "UnusedScenarioDefinition",
          scenarioTitle: "Unused chain",
          candidates: ["Duplicate", "Duplicate"],
        },
      ]);
    }),
  );

  it.effect("reuses resolved source metadata for large scenario outlines", () =>
    Effect.gen(function* () {
      const feature = Bdd.feature("Outline scale").pipe(
        Bdd.scenario("generated outline").pipe(Bdd.given`generated value`(() => Effect.void)),
      );
      const examples = Array.from({ length: 100 }, (_, index) => `      | ${index + 1} |`).join(
        "\n",
      );
      const parsed = yield* parseFeature(`
Feature: Outline scale

  Scenario Outline: generated outline
    Given generated value

    Examples:
      | value |
${examples}
`);

      const result = Discovery.buildScenarioTasks(feature, parsed);

      assert.strictEqual(result.tasks.length, 100);
      assert.deepStrictEqual(result.issues, []);
      assert.strictEqual(result.tasks[0].sourceScenarioTitle, "generated outline");
      assert.strictEqual(result.tasks[99].scenarioTitle, "generated outline");
    }),
  );

  it.effect("indexes unused definitions at scale without changing their order", () =>
    Effect.gen(function* () {
      const scenarios = Array.from({ length: 100 }, (_, index) =>
        Bdd.scenario(`Scenario ${index + 1}`).pipe(Bdd.given`generated step`(() => Effect.void)),
      );
      const feature = Bdd.feature("Unused scale").pipe(...scenarios);
      const parsed = yield* parseFeature(`
Feature: Unused scale

  Scenario: Scenario 1
    Given generated step
`);

      const result = Discovery.buildScenarioTasks(feature, parsed);

      assert.strictEqual(result.tasks.length, 1);
      assert.strictEqual(result.issues.length, 99);
      assert.deepStrictEqual(result.issues[0], {
        _tag: "UnusedScenarioDefinition",
        scenarioTitle: "Scenario 2",
        candidates: ["Scenario 1"],
      });
      assert.deepStrictEqual(result.issues[98], {
        _tag: "UnusedScenarioDefinition",
        scenarioTitle: "Scenario 100",
        candidates: ["Scenario 1"],
      });
    }),
  );

  it.effect("indexes JavaScript object property names safely", () =>
    Effect.gen(function* () {
      const step = Bdd.given`generated step`(() => Effect.void);
      const feature = Bdd.feature("Index safety").pipe(
        Bdd.scenario("__proto__").pipe(step),
        Bdd.scenario("constructor").pipe(step),
      );
      const parsed = yield* parseFeature(`
Feature: Index safety

  Scenario: __proto__
    Given generated step

  Scenario: constructor
    Given generated step
`);

      const result = Discovery.buildScenarioTasks(feature, parsed);

      assert.strictEqual(result.tasks.length, 2);
      assert.deepStrictEqual(result.issues, []);
    }),
  );
});
