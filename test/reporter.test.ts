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
        const fixture = yield* makeFixture;
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
        const text = yield* fs.readFileString(report);

        assert.match(text, /FAIL .*counter\.feature:7 Counter \/ Fails/);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});

const makeFixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({
    directory: path.dirname(fileURLToPath(import.meta.url)),
    prefix: ".effect-bdd-reporter-",
  });
  yield* fs.writeFileString(
    path.join(directory, "counter.feature"),
    `
Feature: Counter

  Scenario: Fails
    Given a clean counter
    When the counter is read
    Then the counter is 1
`,
  );
  yield* fs.writeFileString(path.join(directory, "steps.mjs"), counterSteps);
  return {
    path: (name: string) => path.join(directory, name),
  };
});

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
