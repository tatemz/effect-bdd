import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Command } from "effect/cli";
import { Effect, FileSystem, Path } from "effect";
import { fileURLToPath } from "node:url";
import { cli } from "../src/main.ts";

const runCli = (args: ReadonlyArray<string>) => Command.runWith(cli, { version: "0.0.0" })(args);

describe("text reporter", () => {
  it.effect("reports the failing step line, not the scenario line", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({ feature: counterFeature, steps: counterSteps });
        const text = yield* reportFailure(fixture);

        assert.match(text, /FAIL .*counter\.feature:7 Counter \/ Fails/);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("renders an Error cause with its stack", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({ feature: errorFeature, steps: errorSteps });
        const text = yield* reportFailure(fixture);

        assert.match(text, /Cause: Error: expected 42, got 7/);
        assert.match(text, /at .*steps\.mjs:\d+/);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("quotes the failing step from the feature file", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({ feature: counterFeature, steps: counterSteps });
        const text = yield* reportFailure(fixture);

        assert.match(
          text,
          /  5 \|     Given a clean counter\n  6 \|     When the counter is read\n> 7 \|     Then the counter is 1/,
        );
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("renders the fields of a tagged cause", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({ feature: stockFeature, steps: stockSteps });
        const text = yield* reportFailure(fixture);

        assert.match(text, /Cause: OutOfStock: not enough stock/);
        assert.match(text, /sku: lamp/);
        assert.match(text, /available: 0/);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("indents the path of a schema issue", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({ feature: tableFeature, steps: tableSteps });
        const text = yield* reportFailure(fixture);

        assert.match(text, /Cause: Expected number/);
        assert.match(text, /\n {4,}at \["quantity"\]/);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});

const reportFailure = Effect.fnUntraced(function* (fixture: {
  readonly path: (name: string) => string;
}) {
  const report = fixture.path("report.txt");
  yield* Effect.exit(
    runCli([
      "--features",
      fixture.path("*.feature"),
      "--steps",
      fixture.path("*.mjs"),
      "--reporter",
      "text",
      "--output-file.text",
      report,
    ]),
  );
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(report);
});

const makeFixture = (options: { readonly feature: string; readonly steps: string }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({
      directory: path.dirname(fileURLToPath(import.meta.url)),
      prefix: ".effect-bdd-reporter-",
    });
    yield* fs.writeFileString(path.join(directory, "counter.feature"), options.feature);
    yield* fs.writeFileString(path.join(directory, "steps.mjs"), options.steps);
    return {
      path: (name: string) => path.join(directory, name),
    };
  });

const counterFeature = `
Feature: Counter

  Scenario: Fails
    Given a clean counter
    When the counter is read
    Then the counter is 1
`;

const counterSteps = `
import { Bdd } from "effect-bdd"
import { Effect, Schema } from "effect"

const expected = Bdd.capture("expected", Schema.NumberFromString)
const givenCleanCounter = Bdd.given\`a clean counter\`(() => Effect.succeed(0))
const whenRead = Bdd.when\`the counter is read\`((state) => Effect.succeed(state ?? 0))
const thenCounterIs = Bdd.then\`the counter is \${expected}\`(({ expected }, state) =>
  (state ?? 0) === expected
    ? Effect.succeed(state ?? 0)
    : Effect.fail(\`expected \${expected}, got \${state ?? 0}\`)
)

export const counter = Bdd.feature("Counter").pipe(
  Bdd.scenario("Fails").pipe(givenCleanCounter, whenRead, thenCounterIs)
)
`;

const errorFeature = `
Feature: Errors

  Scenario: An Error failure keeps its stack
    Given a repository lookup fails
    Then the scenario reports it
`;

const errorSteps = `
import { Bdd } from "effect-bdd"
import { Effect } from "effect"

const givenLookup = Bdd.given\`a repository lookup fails\`(() =>
  Effect.fail(new Error("expected 42, got 7"))
)
const thenReports = Bdd.then\`the scenario reports it\`(() => Effect.void)

export const errors = Bdd.feature("Errors").pipe(
  Bdd.scenario("An Error failure keeps its stack").pipe(givenLookup, thenReports)
)
`;

const stockFeature = `
Feature: Failure values

  Scenario: A typed error is returned
    Given stock is checked for lamp
    Then the order is placed
`;

const stockSteps = `
import { Bdd } from "effect-bdd"
import { Effect } from "effect"

const givenStock = Bdd.given\`stock is checked for lamp\`(() =>
  Effect.fail({ _tag: "OutOfStock", message: "not enough stock", sku: "lamp", available: 0 })
)
const thenOrder = Bdd.then\`the order is placed\`(() => Effect.void)

export const causes = Bdd.feature("Failure values").pipe(
  Bdd.scenario("A typed error is returned").pipe(givenStock, thenOrder)
)
`;

const tableFeature = `
Feature: Table decoding

  Scenario: The table carries a bad row
    Given these products
      | name | quantity |
      | lamp | abc      |
    Then the cart has items
`;

const tableSteps = `
import { Bdd } from "effect-bdd"
import { Effect, Schema } from "effect"

const products = Bdd.table(Schema.Struct({ name: Schema.String, quantity: Schema.Int }))
const givenProducts = Bdd.given\`these products\`(products, () => Effect.void)
const thenItems = Bdd.then\`the cart has items\`(() => Effect.void)

export const tables = Bdd.feature("Table decoding").pipe(
  Bdd.scenario("The table carries a bad row").pipe(givenProducts, thenItems)
)
`;
