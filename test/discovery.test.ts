import { Bdd } from "effect-bdd";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import * as Discovery from "../src/internal/discovery.ts";
import * as Parser from "../src/internal/parser.ts";

const parseFeature = (source: string) =>
  Parser.parse(source, "test.feature").pipe(Effect.provide(Bdd.layerCucumber));

describe("discovery", () => {
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

  it.effect("reports duplicate Gherkin scenario titles", () =>
    Effect.gen(function* () {
      const feature = Bdd.feature("Counter").pipe(
        Bdd.scenario("Duplicate").pipe(Bdd.given`zero`(() => Effect.void)),
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
      ]);
    }),
  );
});
