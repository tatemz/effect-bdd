import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Bdd } from "effect-bdd"
import { MatchError, ParseError, StepError } from "effect-bdd/Errors"

describe("public API", () => {
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
                    id: "step-ast-1"
                  }
                ],
                examples: [],
                id: "scenario-ast-1"
              }
            }
          ]
        }
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
              text: "increment"
            }
          ],
          tags: [],
          astNodeIds: ["scenario-ast-1"]
        }
      ]
    }

    const layerStub = Layer.succeed(
      Bdd.GherkinCompiler,
      Bdd.GherkinCompiler.of({
        compile: () => Effect.succeed(canned)
      })
    )

    it.effect("Bdd.run compiles through the provided service", () =>
      Effect.gen(function*() {
        const feature = Bdd.feature("Counter").pipe(
          Bdd.scenario("Stubbed increment").pipe(
            Bdd.when`increment`(() => Effect.succeed(1))
          )
        )

        // Not valid Gherkin: proves the stub compiler is used instead of Cucumber.
        const report = yield* Bdd.run(feature, "this is not gherkin").pipe(
          Effect.provide(layerStub)
        )

        assert.deepStrictEqual(report, {
          feature: "Counter",
          scenarios: [{ name: "Stubbed increment", steps: 1, tags: [] }]
        })
      }))
  })

  describe("effect-bdd/Errors subpath", () => {
    it("exposes constructable tagged errors", () => {
      const parse = new ParseError({ message: "boom", line: 1, column: 2 })
      const match = new MatchError({
        message: "no match",
        scenario: "S",
        step: "increment",
        line: 3,
        candidates: ["decrement"]
      })
      const step = new StepError({
        message: "failed",
        scenario: "S",
        step: "increment",
        line: 4,
        cause: "expected 1, got 0"
      })

      assert.strictEqual(parse._tag, "ParseError")
      assert.strictEqual(match._tag, "MatchError")
      assert.strictEqual(step._tag, "StepError")
      assert.instanceOf(parse, Error)
    })

    it("matches the error types surfaced by Bdd.run", () => {
      const error: Bdd.RunError = new ParseError({ message: "boom", line: 1, column: 1 })
      assert.strictEqual(error._tag, "ParseError")
    })
  })
})
