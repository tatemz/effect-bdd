import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { fileURLToPath } from "node:url";
import {
  globMatcher,
  makeTriggerClassifier,
  makeTriggerQueue,
  planForTriggers,
  repeatFlag,
  stepTimeoutArg,
  takePendingTriggers,
  type WatchPatterns,
  type WatchTrigger,
  watchPaths,
  watchRoot,
} from "../src/internal/cli/watch.ts";
import {
  childInvocation,
  type WatchSessionOptions,
  watchLoop,
} from "../src/internal/cli/watchSession.ts";
import {
  applyFeatureNarrowing,
  isWatchChildEnv,
  narrowEnvName,
  narrowEnvValue,
  narrowFromEnv,
  watchChildEnvName,
} from "../src/internal/cli/watchNarrowing.ts";

const update = (path: string): WatchTrigger => ({ _tag: "Update", path });
const remove = (path: string): WatchTrigger => ({ _tag: "Remove", path });
const testWatchPatterns: WatchPatterns = {
  features: ["features/**/*.feature"],
  steps: ["steps/**/*.ts"],
};
const classifyTestTrigger = makeTriggerClassifier(testWatchPatterns);

describe("watch trigger classification", () => {
  it("classifies by configured globs rather than file extensions", () => {
    const classify = makeTriggerClassifier({
      features: ["specs/**/*.case"],
      steps: ["steps/**/*.feature"],
    });

    assert.strictEqual(classify(update("specs/login.case")), "features");
    assert.strictEqual(classify(update("steps/login.feature")), "steps");
  });

  it("treats overlapping feature and step globs as a step change", () => {
    const classify = makeTriggerClassifier({
      features: ["shared/**/*.feature"],
      steps: ["shared/**/*.feature"],
    });

    assert.strictEqual(classify(update("shared/login.feature")), "steps");
  });
});

describe("watch run plans", () => {
  it("narrows a feature-only batch to the changed files", () => {
    const plan = planForTriggers(
      [update("features/a/one.feature"), update("features/b/two.feature")],
      testWatchPatterns.features,
      classifyTestTrigger,
    );
    assert.deepStrictEqual(plan, {
      full: false,
      features: ["features/a/one.feature", "features/b/two.feature"],
    });
  });

  it("deduplicates repeated feature triggers", () => {
    const plan = planForTriggers(
      [update("features/a/one.feature"), update("features/a/one.feature")],
      testWatchPatterns.features,
      classifyTestTrigger,
    );
    assert.deepStrictEqual(plan, { full: false, features: ["features/a/one.feature"] });
  });

  it("widens to a full rerun when a step file changes", () => {
    const plan = planForTriggers(
      [update("features/a/one.feature"), update("steps/login.step.ts")],
      testWatchPatterns.features,
      classifyTestTrigger,
    );
    assert.deepStrictEqual(plan, { full: true, features: testWatchPatterns.features });
  });

  it("widens to a full rerun when a feature file is removed", () => {
    const plan = planForTriggers(
      [remove("features/a/one.feature")],
      testWatchPatterns.features,
      classifyTestTrigger,
    );
    assert.deepStrictEqual(plan, { full: true, features: testWatchPatterns.features });
  });

  it("treats a feature file creation as a narrowed rerun", () => {
    const plan = planForTriggers(
      [{ _tag: "Create", path: "features/a/new.feature" }],
      testWatchPatterns.features,
      classifyTestTrigger,
    );
    assert.deepStrictEqual(plan, { full: false, features: ["features/a/new.feature"] });
  });

  it("returns an empty plan for an empty batch", () => {
    assert.deepStrictEqual(planForTriggers([], testWatchPatterns.features, classifyTestTrigger), {
      full: false,
      features: [],
    });
  });
});

describe("watch paths", () => {
  it("deduplicates feature and step patterns", () => {
    assert.deepStrictEqual(
      watchPaths({ features: ["a/*.feature"], steps: ["a/*.feature", "steps/*.ts"] }),
      ["a/*.feature", "steps/*.ts"],
    );
  });
});

describe("watch roots", () => {
  it.effect("uses the literal directory prefix of a glob", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const root = yield* watchRoot("features/**/*.feature");
      assert.strictEqual(root, path.resolve("features"));
    }).pipe(Effect.provide(Path.layer)),
  );

  it.effect("uses the parent directory of a literal file path", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const root = yield* watchRoot("features/login.feature");
      assert.strictEqual(root, path.resolve("features"));
    }).pipe(Effect.provide(Path.layer)),
  );

  it.effect("resolves a bare glob to the working directory", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const root = yield* watchRoot("*.feature");
      assert.strictEqual(root, path.resolve("."));
    }).pipe(Effect.provide(Path.layer)),
  );
});

describe("glob matcher", () => {
  it("matches paths covered by the patterns", () => {
    const matches = globMatcher(["features/**/*.feature", "steps/*.ts"]);
    assert.strictEqual(matches("features/login.feature"), true);
    assert.strictEqual(matches("features/a/b/login.feature"), true);
    assert.strictEqual(matches("steps/login.step.ts"), true);
    assert.strictEqual(matches("src/login.ts"), false);
    assert.strictEqual(matches("features/login.txt"), false);
    assert.strictEqual(matches("node_modules/pkg/index.js"), false);
  });

  it("ignores absolute-path differences outside the pattern", () => {
    const matches = globMatcher(["features/*.feature"]);
    assert.strictEqual(matches("node_modules/effect/index.js"), false);
  });
});

describe("child invocation", () => {
  it("strips --watch from the child invocation and keeps exec argv", () => {
    assert.deepStrictEqual(
      childInvocation(["node", "bin.ts", "--watch", "--tags", "@smoke"], ["--import", "tsx"]),
      {
        executable: "node",
        execArgv: ["--import", "tsx"],
        script: "bin.ts",
        args: ["--tags", "@smoke"],
      },
    );
  });

  it("strips --watch=value spellings, not just the bare flag", () => {
    const invocation = childInvocation(["node", "bin.ts", "--watch=true"], []);
    assert.deepStrictEqual(invocation.args, []);
  });

  it("keeps similarly named user flags", () => {
    const invocation = childInvocation(["node", "bin.ts", "--watchdog", "true"], []);
    assert.deepStrictEqual(invocation.args, ["--watchdog", "true"]);
  });

  it("falls back to the running interpreter when argv is empty", () => {
    const invocation = childInvocation([], []);
    assert.strictEqual(invocation.executable, process.execPath);
    assert.strictEqual(invocation.script, "");
  });
});

describe("watch narrowing environment", () => {
  it.effect("preserves feature paths containing colons", () =>
    Effect.gen(function* () {
      const features = ["a:one.feature", "b/two.feature"];
      const encoded = yield* narrowEnvValue(features);
      assert.strictEqual(encoded, '["a:one.feature","b/two.feature"]');
      assert.deepStrictEqual(narrowFromEnv({ [narrowEnvName]: encoded }), Option.some(features));
    }),
  );

  it("reads a narrowed feature list back from the environment", () => {
    assert.deepStrictEqual(
      narrowFromEnv({ [narrowEnvName]: '["a/b.feature","c/d.feature"]' }),
      Option.some(["a/b.feature", "c/d.feature"]),
    );
  });

  it("returns None when the narrowing variable is absent", () => {
    assert.deepStrictEqual(narrowFromEnv({}), Option.none());
  });

  it("returns an empty list when the narrowing variable is empty", () => {
    assert.deepStrictEqual(narrowFromEnv({ [narrowEnvName]: "[]" }), Option.some([]));
  });

  it("returns None for malformed narrowing JSON", () => {
    assert.deepStrictEqual(narrowFromEnv({ [narrowEnvName]: "not-json" }), Option.none());
  });

  it("applies narrowing only to marked watch children", () => {
    const options = { features: ["features/*.feature"], parallel: 2 };
    const env = {
      [watchChildEnvName]: "1",
      [narrowEnvName]: '["features/login.feature"]',
    };
    assert.deepStrictEqual(applyFeatureNarrowing(options, env), {
      ...options,
      features: ["features/login.feature"],
    });
    assert.strictEqual(
      applyFeatureNarrowing(options, { [narrowEnvName]: env[narrowEnvName] }),
      options,
    );
  });

  it("detects a watch child by its marker variable", () => {
    assert.strictEqual(isWatchChildEnv({ [watchChildEnvName]: "1" }), true);
    assert.strictEqual(isWatchChildEnv({}), false);
  });
});

describe("repeatFlag", () => {
  it("emits one flag per value", () => {
    assert.deepStrictEqual(repeatFlag("--tags", ["@a", "@b"]), ["--tags", "@a", "--tags", "@b"]);
    assert.deepStrictEqual(repeatFlag("--tags", []), []);
  });
});

describe("stepTimeoutArg", () => {
  it("renders finite durations as millis", () => {
    assert.strictEqual(stepTimeoutArg(Duration.seconds(5)), "5000 millis");
  });

  it("renders infinite durations literally", () => {
    assert.strictEqual(stepTimeoutArg(Duration.infinity), "Infinity");
  });
});

describe("trigger queue batching", () => {
  it.effect("takePendingTriggers merges batches that arrived while waiting", () =>
    Effect.gen(function* () {
      const queue = yield* makeTriggerQueue;
      yield* Queue.offer(queue, [update("a.feature")]);
      yield* Queue.offer(queue, [update("b.feature"), update("c.feature")]);
      const batch = yield* takePendingTriggers(queue);
      assert.deepStrictEqual(batch, [
        update("a.feature"),
        update("b.feature"),
        update("c.feature"),
      ]);
    }),
  );
});

describe("watchLoop", () => {
  // The stub handle resolves its exit code immediately; the loop never needs
  // the real process streams.
  const stubHandle = ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(0),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    stdout: Stream.empty,
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });

  const recordingSpawner = (
    commands: Ref.Ref<Array<ReadonlyArray<string>>>,
    envs: Ref.Ref<Array<Record<string, string | undefined>>>,
  ) =>
    ChildProcessSpawner.make((command) => {
      if (command._tag !== "StandardCommand") {
        return Effect.die("unexpected command form");
      }
      return Effect.as(
        Effect.all([
          Ref.update(commands, (recorded) => [...recorded, command.args]),
          Ref.update(envs, (recorded) => [...recorded, command.options.env ?? {}]),
        ]),
        stubHandle,
      );
    });

  it.live(
    "runs the initial full run, then one run per poll batch",
    () =>
      // This live fiber test intentionally coordinates setup, a poll delay, and
      // assertions over the captured process boundary.
      // oxlint-disable-next-line complexity
      Effect.gen(function* () {
        const commands = yield* Ref.make<Array<ReadonlyArray<string>>>([]);
        const envs = yield* Ref.make<Array<Record<string, string | undefined>>>([]);
        const session: WatchSessionOptions = {
          cli: {
            features: ["features/*.feature"],
            steps: ["steps/*.ts"],
            reporters: ["text"],
            outputFiles: {},
            verbose: false,
            strict: false,
            filters: { tags: ["@smoke"], titles: ["login"], failFast: false },
            parallel: 1,
          },
          invocation: childInvocation(
            [
              "node",
              "bin.ts",
              "-f",
              "features/*.feature",
              "-s",
              "steps/*.ts",
              "--tags",
              "@smoke",
              "--title",
              "login",
              "--watch",
            ],
            ["--import", "tsx"],
          ),
        };
        const triggers = yield* makeTriggerQueue;
        yield* Queue.offer(triggers, [update("features/one.feature")]);
        yield* Effect.forkScoped(
          watchLoop(session, triggers, testWatchPatterns).pipe(
            Effect.provideService(
              ChildProcessSpawner.ChildProcessSpawner,
              recordingSpawner(commands, envs),
            ),
          ),
        );
        // Wait for the initial run plus at least one poll tick, then stop.
        yield* Effect.sleep("600 millis");
        const recorded = yield* Ref.get(commands);
        const recordedEnvs = yield* Ref.get(envs);
        // The interpreter's exec argv precedes the script in every invocation;
        // argv is otherwise left intact, including the -f/-s aliases and filters.
        // A feature-only batch passes its narrowed paths through the environment,
        // leaving the user's original --features glob unchanged.
        assert.deepStrictEqual(recorded, [
          [
            "--import",
            "tsx",
            "bin.ts",
            "-f",
            "features/*.feature",
            "-s",
            "steps/*.ts",
            "--tags",
            "@smoke",
            "--title",
            "login",
          ],
          [
            "--import",
            "tsx",
            "bin.ts",
            "-f",
            "features/*.feature",
            "-s",
            "steps/*.ts",
            "--tags",
            "@smoke",
            "--title",
            "login",
          ],
        ]);
        assert.strictEqual(isWatchChildEnv(recordedEnvs[0] ?? {}), true);
        assert.deepStrictEqual(narrowFromEnv(recordedEnvs[0] ?? {}), Option.none());
        assert.strictEqual((recordedEnvs[0] ?? {})[narrowEnvName], undefined);
        assert.strictEqual(isWatchChildEnv(recordedEnvs[1] ?? {}), true);
        assert.deepStrictEqual(
          narrowFromEnv(recordedEnvs[1] ?? {}),
          Option.some(["features/one.feature"]),
        );
      }),
    15000,
  );
});

describe("watch session end to end", () => {
  it.live(
    "reruns only the changed feature through the real CLI and refreshes step modules",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const testDir = path.dirname(fileURLToPath(import.meta.url));
          const directory = yield* fs.makeTempDirectoryScoped({
            directory: testDir,
            prefix: ".effect-bdd-watch-",
          });
          const featurePath = path.join(directory, "counter.feature");
          const otherFeaturePath = path.join(directory, "other.feature");
          const stepsPath = path.join(directory, "steps.ts");
          const textReport = path.join(directory, "watch-report.txt");
          const writeFeature = (name: string, expected = 1) =>
            fs.writeFileString(
              featurePath,
              `Feature: Counter\n\n  Scenario: ${name}\n    When increment\n    Then the counter is ${expected}\n`,
            );
          const writeOtherFeature = () =>
            fs.writeFileString(
              otherFeaturePath,
              "Feature: Other\n\n  Scenario: Untouched\n    When increment\n    Then the counter is 1\n",
            );
          const writeSteps = (name: string) => fs.writeFileString(stepsPath, watchSteps(name));

          yield* Effect.all([
            writeFeature("Increment"),
            writeOtherFeature(),
            writeSteps("Increment"),
          ]);

          const binPath = path.join(testDir, "..", "src", "bin.ts");
          const inheritedNarrowing = yield* narrowEnvValue([featurePath]);
          const handle = yield* spawner.spawn(
            ChildProcess.make(
              process.execPath,
              [
                "--experimental-strip-types",
                binPath,
                "-f",
                path.join(directory, "*.feature"),
                "-s",
                stepsPath,
                "--reporter",
                "text",
                "--output-file.text",
                textReport,
                "--verbose",
                "--watch",
              ],
              {
                env: { [narrowEnvName]: inheritedNarrowing },
                extendEnv: true,
              },
            ),
          );

          // Initial run writes a report containing both features. The report
          // lists selected scenarios with --verbose.
          yield* waitForReport(textReport, "Counter / Increment");
          yield* waitForReport(textReport, "Other / Untouched");

          // Editing only the counter feature should rerun only that file. This
          // checks the parent-to-child environment handoff actually changes
          // Runner.run's --features input; the untouched feature must be absent
          // from the rewritten report.
          yield* Effect.sleep("400 millis");
          yield* writeFeature("Increment", 2);
          yield* waitForReport(textReport, "Scenarios: 1 total, 1 failed, 0 passed");
          const narrowedReport = yield* fs.readFileString(textReport);
          assert.strictEqual(narrowedReport.includes("Other / Untouched"), false);

          // Now edit the feature and step module together. A step change widens
          // the run, and the new chain title must be loaded by a fresh child
          // process. The Node type-stripping flag must also reach that child.
          yield* Effect.sleep("400 millis");
          yield* Effect.all([writeFeature("Renamed"), writeSteps("Renamed")]);
          yield* waitForReport(textReport, "Counter / Renamed");
          yield* waitForReport(textReport, "Other / Untouched");

          yield* handle.kill();
        }),
      ).pipe(Effect.provide(NodeServices.layer)),
    30000,
  );
});

class ReportNotReady extends Data.TaggedError("ReportNotReady")<{ readonly contains: string }> {}

const waitForReport = Effect.fnUntraced(function* (file: string, contains: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.readFileString(file).pipe(
    Effect.filterOrFail(
      (text) => text.includes(contains),
      () => new ReportNotReady({ contains }),
    ),
    // 75 attempts spaced 200ms apart bounds the wait at ~15 seconds.
    Effect.retry(Schedule.addDelay(Schedule.recurs(75), () => Effect.succeed("200 millis"))),
    Effect.asVoid,
  );
});

const watchSteps = (scenarioName: string) => `
import { Bdd } from "effect-bdd";
import { Effect, Schema } from "effect";

const expected = Bdd.capture("expected", Schema.NumberFromString);
const whenIncrement = Bdd.when\`increment\`((state) => Effect.succeed((state ?? 0) + 1));
const thenCounterIs = Bdd.then\`the counter is \${expected}\`(({ expected }, state) =>
  (state ?? 0) === expected
    ? Effect.succeed(state ?? 0)
    : Effect.fail(\`expected \${expected}, got \${state ?? 0}\`)
);

export const counter = Bdd.feature("Counter").pipe(
  Bdd.scenario("${scenarioName}").pipe(whenIncrement, thenCounterIs),
);

export const other = Bdd.feature("Other").pipe(
  Bdd.scenario("Untouched").pipe(whenIncrement, thenCounterIs),
);
`;
