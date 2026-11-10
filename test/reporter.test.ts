import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Command } from "effect/cli";
import { Effect, FileSystem, Path } from "effect";
import { fileURLToPath } from "node:url";
import { cli } from "../src/main.ts";
import { renderDefectError } from "../src/internal/cli/reporter.ts";

const runCli = (args: ReadonlyArray<string>) => Command.runWith(cli, { version: "0.0.0" })(args);

describe("text reporter", () => {
  it("prints defect stack frames without a file URL", () => {
    const error = new Error("boom");
    error.stack = "Error: boom\n    at fn (file:///tmp/steps.mjs:3:4)";

    const text = renderDefectError(error);

    assert.match(text, /at \/tmp\/steps\.mjs:3:4/);
    assert.strictEqual(text.includes("file://"), false);
  });

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

  it.effect("puts the summary after the failures and lists them", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({ feature: counterFeature, steps: counterSteps });
        const text = yield* reportFailure(fixture);

        assert.match(text, /Scenarios: 1 total, 1 failed, 0 passed \(\d+ms\)/);
        assert.match(text, /Failed scenarios:\n {2}.*counter\.feature:4 Counter \/ Fails/);
        assert.ok(text.indexOf("FAIL ") < text.indexOf("Scenarios: 1 total"));
        assert.ok(text.indexOf("Scenarios: 1 total") < text.indexOf("Failed scenarios:"));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("shows failure paths relative to the working directory", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({ feature: counterFeature, steps: counterSteps });
        const text = yield* reportFailure(fixture);

        assert.match(text, /FAIL test\/\.effect-bdd-reporter-[^/]+\/counter\.feature:7/);
        assert.strictEqual(text.includes(process.cwd()), false);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("ends the file report with a newline", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({ feature: counterFeature, steps: counterSteps });
        const text = yield* reportFailure(fixture);

        assert.strictEqual(text.endsWith("\n"), true);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reports a thrown defect and continues the run", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({ feature: defectFeature, steps: defectSteps });
        const text = yield* reportFailure(fixture);

        assert.match(text, /Defect: kaboom: the cart repository is null/);
        assert.match(text, /at .*steps\.mjs:\d+/);
        assert.strictEqual(/file:\/\//.test(text), false);
        assert.match(text, /Scenarios: 2 total, 1 failed, 1 passed \(\d+ms\)/);
        assert.match(text, /A step throws/);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("writes structured failure data to JSON", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({ feature: counterFeature, steps: counterSteps });
        const report = fixture.path("report.json");

        yield* Effect.exit(
          runCli([
            "--features",
            fixture.path("*.feature"),
            "--steps",
            fixture.path("*.mjs"),
            "--reporter",
            "json",
            "--output-file.json",
            report,
          ]),
        );

        const fs = yield* FileSystem.FileSystem;
        const json = JSON.parse(yield* fs.readFileString(report)) as JsonFailureReport;
        const outcome = json.scenarios[0]?.outcome;

        assert.strictEqual(outcome?.status, "failed");
        assert.match(outcome?.error ?? "", /StepError/);
        assert.strictEqual(outcome?.failure?._tag, "RunError");
        assert.strictEqual(outcome?.failure?.error?._tag, "StepError");
        assert.strictEqual(outcome?.failure?.error?.step, "the counter is 1");
        assert.strictEqual(outcome?.failure?.error?.line, 7);
        assert.match(outcome?.failure?.error?.cause ?? "", /expected 1, got 0/);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("prints the step definition location", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          feature: counterFeature,
          steps: counterStepsFromSource,
        });
        const text = yield* reportFailure(fixture);

        assert.match(
          text,
          /Definition: test\/\.effect-bdd-reporter-[^/]+\/steps\.mjs:8/,
        );
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps discovery details out of the default report", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({ feature: counterFeature, steps: counterSteps });
        const text = yield* reportFailure(fixture);

        assert.strictEqual(text.includes("Discovery:"), false);
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

const counterStepsFromSource = `
import { Bdd } from "../../src/Bdd.ts"
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

const defectFeature = `
Feature: Defects

  Scenario: A step throws
    Given a step that throws
    Then the run continues

  Scenario: The next scenario runs
    Given a step that works
    Then the run continues
`;

const defectSteps = `
import { Bdd } from "effect-bdd"
import { Effect } from "effect"

const givenThrows = Bdd.given\`a step that throws\`(() =>
  Effect.sync(() => {
    throw new Error("kaboom: the cart repository is null")
  })
)
const givenWorks = Bdd.given\`a step that works\`(() => Effect.void)
const thenContinues = Bdd.then\`the run continues\`(() => Effect.void)

export const defects = Bdd.feature("Defects").pipe(
  Bdd.scenario("A step throws").pipe(givenThrows, thenContinues),
  Bdd.scenario("The next scenario runs").pipe(givenWorks, thenContinues)
)
`;

interface JsonFailureReport {
  readonly scenarios: ReadonlyArray<{
    readonly outcome: {
      readonly status: string;
      readonly error?: string;
      readonly failure?: {
        readonly _tag: string;
        readonly error?: {
          readonly _tag: string;
          readonly step?: string;
          readonly line?: number;
          readonly cause?: string;
        };
      };
    };
  }>;
}
