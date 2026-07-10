import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, FileSystem, Option, Path } from "effect";
import { TestClock } from "effect/testing";
import * as CliError from "effect/unstable/cli/CliError";
import * as Command from "effect/unstable/cli/Command";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { cli } from "../src/main.ts";

const execFilePromise = promisify(execFile);

const runCli = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    return yield* Command.runWith(cli, { version: "0.0.0" })(args);
  });

describe("cli", () => {
  it.effect("runs through the Node bin entrypoint", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const bddRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
        const repoRoot = path.dirname(path.dirname(bddRoot));
        const fixtureRoot = path.join(bddRoot, "test", "fixtures");
        const result = yield* Effect.promise(() =>
          execFilePromise(
            process.execPath,
            [
              path.join(bddRoot, "src", "bin.ts"),
              "--features",
              path.join(fixtureRoot, "*.feature"),
              "--steps",
              path.join(fixtureRoot, "*.step.ts"),
              "--reporter",
              "text",
              "--parallel",
              "2",
            ],
            { cwd: repoRoot },
          ),
        );

        assert.match(result.stdout, /Features: 9, Scenarios: 27, passed: 27, failed: 0/);
        assert.match(
          result.stdout,
          /Discovery: 9 feature file\(s\), 2 step module\(s\), 9 feature definition\(s\), 27 scenario\(s\) \(27 selected\)/,
        );
        assert.strictEqual(/RUNNING .*fixtures/.test(result.stdout), false);
        assert.strictEqual(/PASS .*fixtures/.test(result.stdout), false);
        assert.match(result.stderr, /RUNNING .*fixtures/);
        assert.strictEqual(/PASS .*fixtures/.test(result.stderr), false);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("streams passing scenario results to stderr in verbose text output", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const bddRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
        const repoRoot = path.dirname(path.dirname(bddRoot));
        const fixtureRoot = path.join(bddRoot, "test", "fixtures");
        const result = yield* Effect.promise(() =>
          execFilePromise(
            process.execPath,
            [
              path.join(bddRoot, "src", "bin.ts"),
              "--features",
              path.join(fixtureRoot, "*.feature"),
              "--steps",
              path.join(fixtureRoot, "*.step.ts"),
              "--reporter",
              "text",
              "--verbose",
            ],
            { cwd: repoRoot },
          ),
        );

        assert.match(result.stdout, /Features: 9, Scenarios: 27, passed: 27, failed: 0/);
        assert.strictEqual(/PASS .*Minimal \/ minimalistic/.test(result.stdout), false);
        assert.match(result.stderr, /RUNNING .*Minimal \/ minimalistic/);
        assert.match(result.stderr, /PASS .*Minimal \/ minimalistic/);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("runs checked-in feature and step fixtures", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
        const textReport = yield* makeReportFile("e2e-report.txt");

        yield* runCli([
          "--features",
          path.join(fixtureRoot, "*.feature"),
          "--steps",
          path.join(fixtureRoot, "*.step.ts"),
          "--reporter",
          "text",
          "--output-file.text",
          textReport,
          "--verbose",
          "--parallel",
          "2",
        ]);

        const fs = yield* FileSystem.FileSystem;
        const text = yield* fs.readFileString(textReport);

        assert.match(text, /Features: 9, Scenarios: 27, passed: 27, failed: 0/);
        assert.match(text, /Feature files:/);
        assert.match(text, /Step modules:/);
        assert.match(text, /Feature definitions:/);
        assert.match(text, /Selected scenarios:/);
        assert.match(text, /Minimal \/ minimalistic/);
        assert.match(text, /Some rules \/ A \/ Example A/);
        assert.match(text, /DocString variations \/ minimalistic/);
        assert.match(
          text,
          /Effect BDD kitchen sink \/ Checkout totals \/ capture totals include tax/,
        );
        assert.match(
          text,
          /Effect BDD kitchen sink \/ Checkout totals \/ outline examples start from initial state/,
        );
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("runs repeated feature and step globs with text and html reporters", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          feature: `
Feature: Counter

  Scenario: Increment
    When increment
    Then the counter is 1

  Scenario: Starts clean
    Then the counter is 0
`,
          steps: counterStepsFor(`
  Bdd.scenario("Increment").pipe(whenIncrement, thenCounterIs),
  Bdd.scenario("Starts clean").pipe(thenCounterIs)
`),
        });

        const textReport = fixture.path("report.txt");
        const htmlReport = fixture.path("report.html");

        yield* runCli([
          "--features",
          fixture.path("*.feature"),
          "--steps",
          fixture.path("*.mjs"),
          "--reporter",
          "text",
          "--reporter",
          "html",
          "--output-file.text",
          textReport,
          "--output-file.html",
          htmlReport,
          "--verbose",
          "--parallel",
          "2",
        ]).pipe(Effect.provide(NodeServices.layer));

        const fs = yield* FileSystem.FileSystem;
        const text = yield* fs.readFileString(textReport);
        const html = yield* fs.readFileString(htmlReport);

        assert.match(text, /Features: 1, Scenarios: 2, passed: 2, failed: 0/);
        assert.match(
          text,
          /Discovery: 1 feature file\(s\), 1 step module\(s\), 1 feature definition\(s\), 2 scenario\(s\) \(2 selected\)/,
        );
        assert.ok(text.indexOf("PASS ") < text.lastIndexOf("PASS "));
        assert.match(html, /effect-bdd report/);
        assert.match(html, /Starts clean/);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("emits reports before failing the command when a scenario fails", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          feature: `
Feature: Counter

  Scenario: Fails
    Then the counter is 1
`,
          steps: counterStepsFor(`
  Bdd.scenario("Fails").pipe(thenCounterIs)
`),
        });
        const textReport = fixture.path("failure.txt");

        const exit = yield* Effect.exit(
          runCli([
            "--features",
            fixture.path("*.feature"),
            "--steps",
            fixture.path("*.mjs"),
            "--reporter",
            "text",
            "--output-file.text",
            textReport,
          ]).pipe(Effect.provide(NodeServices.layer)),
        );

        assert.strictEqual(Exit.isFailure(exit), true);

        const fs = yield* FileSystem.FileSystem;
        const text = yield* fs.readFileString(textReport);

        assert.match(text, /Features: 1, Scenarios: 1, passed: 0, failed: 1/);
        assert.match(text, /FAIL .*counter\.feature:\d+ Counter \/ Fails/);
        assert.match(text, /Cause: expected 1, got 0/);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("fails a scenario when a step exceeds --step-timeout", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          feature: `
Feature: Timeouts

  Scenario: Hangs
    When the step hangs
`,
          steps: `
import { Bdd } from "effect-bdd"
import { Effect } from "effect"

export const timeouts = Bdd.feature("Timeouts").pipe(
  Bdd.scenario("Hangs").pipe(
    Bdd.when\`the step hangs\`(() => Effect.sleep("50 millis"))
  )
)
`,
        });
        const textReport = fixture.path("timeout.txt");

        const exit = yield* Effect.exit(
          TestClock.withLive(
            runCli([
              "--features",
              fixture.path("*.feature"),
              "--steps",
              fixture.path("*.mjs"),
              "--reporter",
              "text",
              "--output-file.text",
              textReport,
              "--step-timeout",
              "1 millis",
            ]).pipe(Effect.provide(NodeServices.layer)),
          ),
        );

        assert.strictEqual(Exit.isFailure(exit), true);

        const fs = yield* FileSystem.FileSystem;
        const text = yield* fs.readFileString(textReport);

        assert.match(text, /Features: 1, Scenarios: 1, passed: 0, failed: 1/);
        assert.match(text, /StepError: Step timed out after .*: the step hangs/);
        assert.match(text, /Cause: StepTimeoutError: Timed out after .* \(timeout: .*\)/);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reports unmatched feature files and unused feature definitions", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          feature: `
Feature: Missing source

  Scenario: Cannot run
    Then the counter is 0
`,
          steps: counterStepsFor(`
  Bdd.scenario("Starts clean").pipe(thenCounterIs)
`),
        });
        const textReport = fixture.path("unmatched-feature.txt");
        const jsonReport = fixture.path("unmatched-feature.json");

        const exit = yield* Effect.exit(
          runCli([
            "--features",
            fixture.path("*.feature"),
            "--steps",
            fixture.path("*.mjs"),
            "--reporter",
            "text",
            "--reporter",
            "json",
            "--output-file.text",
            textReport,
            "--output-file.json",
            jsonReport,
          ]).pipe(Effect.provide(NodeServices.layer)),
        );

        assert.strictEqual(Exit.isFailure(exit), true);

        const fs = yield* FileSystem.FileSystem;
        const text = yield* fs.readFileString(textReport);
        const json = yield* fs.readFileString(jsonReport);

        assert.match(text, /Unmatched source:/);
        assert.match(text, /Feature: Missing source/);
        assert.match(text, /Scenario: Cannot run/);
        assert.match(text, /Unused definitions:/);
        assert.match(text, /Feature definition exported but no feature file matched: Counter/);
        assert.match(json, /"featureTitle": "Missing source"/);
        assert.match(json, /"scenarioTitle": "Cannot run"/);
        assert.match(json, /"featureTitle": "Counter"/);
        assert.strictEqual(/"featureName"/.test(json), false);
        assert.strictEqual(/"scenarioName"/.test(json), false);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("allows unused definitions during focused runs by default", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          feature: `
Feature: Counter

  Scenario: Starts clean
    Then the counter is 0
`,
          steps: `${counterStepsFor(`
  Bdd.scenario("Starts clean").pipe(thenCounterIs),
  Bdd.scenario("Unused counter chain").pipe(thenCounterIs)
`)}

export const other = Bdd.feature("Other").pipe(
  Bdd.scenario("Unused other chain").pipe(thenCounterIs)
)
`,
        });
        const textReport = fixture.path("unused-default.txt");
        const junitReport = fixture.path("unused-default.xml");

        yield* runCli([
          "--features",
          fixture.path("*.feature"),
          "--steps",
          fixture.path("*.mjs"),
          "--reporter",
          "text",
          "--reporter",
          "junit",
          "--output-file.text",
          textReport,
          "--output-file.junit",
          junitReport,
        ]).pipe(Effect.provide(NodeServices.layer));

        const fs = yield* FileSystem.FileSystem;
        const text = yield* fs.readFileString(textReport);
        const junit = yield* fs.readFileString(junitReport);

        assert.match(text, /Features: 1, Scenarios: 1, passed: 1, failed: 0/);
        assert.match(text, /Unused definitions:/);
        assert.match(text, /Scenario chain exported but no source scenario matched/);
        assert.match(text, /Feature definition exported but no feature file matched: Other/);
        assert.match(junit, /failures="0"/);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("fails unused definitions in strict mode", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          feature: `
Feature: Counter

  Scenario: Starts clean
    Then the counter is 0
`,
          steps: `${counterStepsFor(`
  Bdd.scenario("Starts clean").pipe(thenCounterIs),
  Bdd.scenario("Unused counter chain").pipe(thenCounterIs)
`)}

export const other = Bdd.feature("Other").pipe(
  Bdd.scenario("Unused other chain").pipe(thenCounterIs)
)
`,
        });

        const exit = yield* Effect.exit(
          runCli([
            "--features",
            fixture.path("*.feature"),
            "--steps",
            fixture.path("*.mjs"),
            "--reporter",
            "text",
            "--output-file.text",
            fixture.path("unused-strict.txt"),
            "--strict",
          ]).pipe(Effect.provide(NodeServices.layer)),
        );

        assert.strictEqual(Exit.isFailure(exit), true);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reports unmatched source steps", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          feature: `
Feature: Counter

  Scenario: Unknown step
    Then a missing transition runs
`,
          steps: counterStepsFor(`
  Bdd.scenario("Unknown step").pipe(thenCounterIs)
`),
        });
        const textReport = fixture.path("unmatched-step.txt");

        const exit = yield* Effect.exit(
          runCli([
            "--features",
            fixture.path("*.feature"),
            "--steps",
            fixture.path("*.mjs"),
            "--reporter",
            "text",
            "--output-file.text",
            textReport,
          ]).pipe(Effect.provide(NodeServices.layer)),
        );

        assert.strictEqual(Exit.isFailure(exit), true);

        const fs = yield* FileSystem.FileSystem;
        const text = yield* fs.readFileString(textReport);

        assert.match(text, /FAIL .*counter\.feature:\d+ Counter \/ Unknown step/);
        assert.match(text, /Step 1 text mismatch/);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reports source steps that only match a different keyword", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          feature: `
Feature: Counter

  Scenario: Wrong keyword
    Given increment
`,
          steps: counterStepsFor(`
  Bdd.scenario("Wrong keyword").pipe(whenIncrement)
`),
        });
        const textReport = fixture.path("wrong-keyword.txt");

        const exit = yield* Effect.exit(
          runCli([
            "--features",
            fixture.path("*.feature"),
            "--steps",
            fixture.path("*.mjs"),
            "--reporter",
            "text",
            "--output-file.text",
            textReport,
          ]).pipe(Effect.provide(NodeServices.layer)),
        );

        assert.strictEqual(Exit.isFailure(exit), true);

        const fs = yield* FileSystem.FileSystem;
        const text = yield* fs.readFileString(textReport);

        assert.match(text, /FAIL .*counter\.feature:\d+ Counter \/ Wrong keyword/);
        assert.match(text, /keyword mismatch/);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("filters scenarios by tag expression", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          feature: `
Feature: Counter

  @fast
  Scenario: Increment
    When increment
    Then the counter is 1

  @slow
  Scenario: Starts clean
    Then a missing transition runs
`,
          steps: counterStepsFor(`
  Bdd.scenario("Increment").pipe(whenIncrement, thenCounterIs),
  Bdd.scenario("Starts clean").pipe(thenCounterIs)
`),
        });
        const textReport = fixture.path("tags.txt");

        yield* runCli([
          "--features",
          fixture.path("*.feature"),
          "--steps",
          fixture.path("*.mjs"),
          "--reporter",
          "text",
          "--output-file.text",
          textReport,
          "--tags",
          "@fast and not @slow",
          "--verbose",
        ]).pipe(Effect.provide(NodeServices.layer));

        const fs = yield* FileSystem.FileSystem;
        const text = yield* fs.readFileString(textReport);

        assert.match(text, /Features: 1, Scenarios: 1, passed: 1, failed: 0/);
        assert.match(
          text,
          /Discovery: 1 feature file\(s\), 1 step module\(s\), 1 feature definition\(s\), 2 scenario\(s\) \(1 selected\)/,
        );
        assert.match(text, /Increment/);
        assert.strictEqual(/Starts clean/.test(text), false);
        assert.strictEqual(/Unmatched source/.test(text), false);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("filters scenarios by name", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          feature: `
Feature: Counter

  Scenario: Increment
    When increment
    Then the counter is 1

  Scenario: Starts clean
    Then the counter is 0
`,
          steps: counterStepsFor(`
  Bdd.scenario("Increment").pipe(whenIncrement, thenCounterIs),
  Bdd.scenario("Starts clean").pipe(thenCounterIs)
`),
        });
        const textReport = fixture.path("name.txt");

        yield* runCli([
          "--features",
          fixture.path("*.feature"),
          "--steps",
          fixture.path("*.mjs"),
          "--reporter",
          "text",
          "--output-file.text",
          textReport,
          "--title",
          "Starts",
          "--verbose",
        ]).pipe(Effect.provide(NodeServices.layer));

        const fs = yield* FileSystem.FileSystem;
        const text = yield* fs.readFileString(textReport);

        assert.match(text, /Features: 1, Scenarios: 1, passed: 1, failed: 0/);
        assert.match(text, /Starts clean/);
        assert.strictEqual(/Increment/.test(text), false);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("stops after the first failure with fail-fast", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          feature: `
Feature: Counter

  Scenario: Fails first
    Then the counter is 1

  Scenario: Fails later
    Then the counter is 2
`,
          steps: counterStepsFor(`
  Bdd.scenario("Fails first").pipe(thenCounterIs),
  Bdd.scenario("Fails later").pipe(thenCounterIs)
`),
        });
        const textReport = fixture.path("fail-fast.txt");

        const exit = yield* Effect.exit(
          runCli([
            "--features",
            fixture.path("*.feature"),
            "--steps",
            fixture.path("*.mjs"),
            "--reporter",
            "text",
            "--output-file.text",
            textReport,
            "--fail-fast",
            "--verbose",
          ]).pipe(Effect.provide(NodeServices.layer)),
        );

        assert.strictEqual(Exit.isFailure(exit), true);

        const fs = yield* FileSystem.FileSystem;
        const text = yield* fs.readFileString(textReport);

        assert.match(text, /Features: 1, Scenarios: 1, passed: 0, failed: 1/);
        assert.match(text, /Fails first/);
        assert.strictEqual(/(?:PASS|FAIL) .*Fails later/.test(text), false);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("writes json and junit reports", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          feature: `
Feature: Counter

  Scenario: Increment
    When increment
    Then the counter is 1

  Scenario: Starts clean
    Then the counter is 0
`,
          steps: counterStepsFor(`
  Bdd.scenario("Increment").pipe(whenIncrement, thenCounterIs),
  Bdd.scenario("Starts clean").pipe(thenCounterIs)
`),
        });
        const jsonReport = fixture.path("report.json");
        const junitReport = fixture.path("report.xml");

        yield* runCli([
          "--features",
          fixture.path("*.feature"),
          "--steps",
          fixture.path("*.mjs"),
          "--reporter",
          "json",
          "--reporter",
          "junit",
          "--output-file.json",
          jsonReport,
          "--output-file.junit",
          junitReport,
        ]).pipe(Effect.provide(NodeServices.layer));

        const fs = yield* FileSystem.FileSystem;
        const json = yield* fs.readFileString(jsonReport);
        const junit = yield* fs.readFileString(junitReport);

        assert.match(json, /"summary"/);
        assert.match(json, /"discovery"/);
        assert.match(json, /"status": "passed"/);
        assert.match(json, /"featureDiscoveryMillis": \d+/);
        assert.match(json, /"stepModuleLoadMillis": \d+/);
        assert.match(json, /"taskBuildMillis": \d+/);
        assert.match(json, /"filteringMillis": \d+/);
        assert.match(json, /"executionMillis": \d+/);
        assert.match(junit, /<testsuite name="effect-bdd"/);
        assert.match(junit, /<testcase classname="Counter"/);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("releases scoped step resources before the CLI returns from a failing scenario", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          feature: `
Feature: Scoped resources

  Scenario: Fails after acquiring resource
    Given a scoped resource is open
    When the scenario fails
`,
          steps: `
import { Bdd } from "effect-bdd";
import { Effect } from "effect";
import { writeFileSync } from "node:fs";

const givenResource = Bdd.given\`a scoped resource is open\`(() =>
  Effect.acquireRelease(
    Effect.succeed({}),
    () => Effect.sync(() => writeFileSync(${JSON.stringify("${RELEASED}")}, "released"))
  )
);
const whenFails = Bdd.when\`the scenario fails\`(() => Effect.fail("boom"));

export const scopedResources = Bdd.feature("Scoped resources").pipe(
  Bdd.scenario("Fails after acquiring resource").pipe(givenResource, whenFails)
);
`,
        });
        const releasedPath = fixture.path("released.txt");
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(
          fixture.path("steps.mjs"),
          (yield* fs.readFileString(fixture.path("steps.mjs"))).replace(
            "${RELEASED}",
            releasedPath,
          ),
        );

        const exit = yield* Effect.exit(
          runCli([
            "--features",
            fixture.path("*.feature"),
            "--steps",
            fixture.path("steps.mjs"),
            "--reporter",
            "text",
            "--output-file.text",
            fixture.path("scoped-failure.txt"),
          ]).pipe(Effect.provide(NodeServices.layer)),
        );

        assert.strictEqual(Exit.isFailure(exit), true);
        assert.strictEqual(yield* fs.readFileString(releasedPath), "released");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("fails when multiple step modules export the same feature definition", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          feature: `
Feature: Counter

  Scenario: Starts clean
    Then the counter is 0
`,
          steps: counterStepsFor(`
  Bdd.scenario("Starts clean").pipe(thenCounterIs)
`),
        });
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(
          fixture.path("duplicate.mjs"),
          counterStepsFor(`
  Bdd.scenario("Starts clean").pipe(thenCounterIs)
`),
        );

        const exit = yield* Effect.exit(
          runCli([
            "--features",
            fixture.path("*.feature"),
            "--steps",
            fixture.path("*.mjs"),
            "--reporter",
            "text",
            "--output-file.text",
            fixture.path("duplicate.txt"),
          ]).pipe(Effect.provide(NodeServices.layer)),
        );

        assert.strictEqual(Exit.isFailure(exit), true);
        if (Exit.isFailure(exit)) {
          const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
          assert.strictEqual(error instanceof CliError.UserError, true);
          if (error instanceof CliError.UserError) {
            assert.match(String(error.cause), /Multiple feature definitions matched/);
          }
        }
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("fails when a feature file has duplicate scenario titles", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          feature: `
Feature: Counter

  Scenario: Duplicate
    Then the counter is 0

  Scenario: Duplicate
    Then the counter is 0
`,
          steps: counterStepsFor(`
  Bdd.scenario("Duplicate").pipe(thenCounterIs)
`),
        });

        const exit = yield* Effect.exit(
          runCli([
            "--features",
            fixture.path("*.feature"),
            "--steps",
            fixture.path("*.mjs"),
            "--reporter",
            "text",
            "--output-file.text",
            fixture.path("duplicate-source.txt"),
          ]).pipe(Effect.provide(NodeServices.layer)),
        );

        assert.strictEqual(Exit.isFailure(exit), true);
        if (Exit.isFailure(exit)) {
          const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
          assert.strictEqual(error instanceof CliError.UserError, true);
          if (error instanceof CliError.UserError) {
            assert.match(String(error.cause), /Duplicate scenario title in Gherkin feature/);
          }
        }
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("surfaces the underlying reason when a step module fails to load", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          feature: `
Feature: Counter

  Scenario: Starts clean
    Then the counter is 0
`,
          steps: `throw new Error("boom while importing step module")`,
        });

        const exit = yield* Effect.exit(
          runCli([
            "--features",
            fixture.path("*.feature"),
            "--steps",
            fixture.path("steps.mjs"),
            "--reporter",
            "text",
            "--output-file.text",
            fixture.path("load-error.txt"),
          ]).pipe(Effect.provide(NodeServices.layer)),
        );

        assert.strictEqual(Exit.isFailure(exit), true);
        if (Exit.isFailure(exit)) {
          const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
          assert.strictEqual(error instanceof CliError.UserError, true);
          if (error instanceof CliError.UserError) {
            const cause = String(error.cause);
            assert.match(cause, /Could not load step module/);
            assert.match(cause, /boom while importing step module/);
          }
        }
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("requires an output file for the html reporter", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          feature: `
Feature: Counter

  Scenario: Starts clean
    Then the counter is 0
`,
          steps: counterStepsFor(`
  Bdd.scenario("Starts clean").pipe(thenCounterIs)
`),
        });

        const exit = yield* Effect.exit(
          runCli([
            "--features",
            fixture.path("*.feature"),
            "--steps",
            fixture.path("*.mjs"),
            "--reporter",
            "html",
          ]).pipe(Effect.provide(NodeServices.layer)),
        );

        assert.strictEqual(Exit.isFailure(exit), true);
        if (Exit.isFailure(exit)) {
          const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
          assert.strictEqual(error instanceof CliError.UserError, true);
        }
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});

const makeReportFile = Effect.fnUntraced(function* (name: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({
    directory: path.dirname(fileURLToPath(import.meta.url)),
    prefix: ".effect-bdd-report-",
  });
  return path.join(directory, name);
});

const makeFixture = Effect.fnUntraced(function* (options: {
  readonly feature: string;
  readonly steps: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({
    directory: path.dirname(fileURLToPath(import.meta.url)),
    prefix: ".effect-bdd-",
  });
  yield* fs.writeFileString(path.join(directory, "counter.feature"), options.feature);
  yield* fs.writeFileString(path.join(directory, "steps.mjs"), options.steps);
  return {
    path: (name: string) => path.join(directory, name),
  };
});

const counterStepsFor = (scenarios: string) => `
import { Bdd } from "effect-bdd"
import { Effect, Schema } from "effect"

const expected = Bdd.capture("expected", Schema.NumberFromString)
const whenIncrement = Bdd.when\`increment\`((state) => Effect.succeed((state ?? 0) + 1))
const thenCounterIs = Bdd.then\`the counter is \${expected}\`(({ expected }, state) =>
  (state ?? 0) === expected
    ? Effect.succeed(state ?? 0)
    : Effect.fail(\`expected \${expected}, got \${state ?? 0}\`)
)

export const counter = Bdd.feature("Counter").pipe(
${scenarios}
)
`;
