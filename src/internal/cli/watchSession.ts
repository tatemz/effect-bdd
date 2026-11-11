import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Fn from "effect/Function";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Str from "effect/String";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type { PlatformError } from "effect/PlatformError";
import type { CliOptions } from "./models.ts";
import {
  narrowEnvName,
  narrowEnvValue,
  watchChildEnvName,
  watchChildEnvValue,
} from "./watchNarrowing.ts";
import * as Watch from "./watch.ts";

/** @internal */
export type WatchSessionError = PlatformError | Schema.SchemaError;

/**
 * Everything the watch session needs that does not change between reruns:
 * the parsed CLI options, and the child process invocation (interpreter, its
 * exec arguments, the script path, and the user's flags with `--watch`
 * removed).
 *
 * @internal
 */
export interface WatchSessionOptions {
  readonly cli: CliOptions;
  readonly invocation: {
    readonly executable: string;
    readonly execArgv: ReadonlyArray<string>;
    readonly script: string;
    readonly args: ReadonlyArray<string>;
  };
}

/**
 * Build the child process invocation from the raw process argv and exec argv:
 * the interpreter, the interpreter's own options (`--import tsx` and friends,
 * which must reach the child or TypeScript step modules will not load), the
 * script path, and the user's flags with any `--watch` spelling removed so a
 * child process does not start its own watcher. Node's own watch options are
 * removed from `execArgv` for the same reason.
 *
 * @internal
 */
export const childInvocation = (
  argv: ReadonlyArray<string>,
  execArgv: ReadonlyArray<string>,
): WatchSessionOptions["invocation"] => {
  const [executable, script, ...flags] = argv;
  return {
    executable: executable ?? process.execPath,
    execArgv: Arr.filter(execArgv, (token) => !isNodeWatchArg(token)),
    script: script ?? "",
    args: Arr.filter(flags, (token) => !isWatchFlag(token)),
  };
};

const isWatchFlag = (token: string): boolean =>
  token === "--watch" || Fn.pipe(token, Str.startsWith("--watch="));

const isNodeWatchArg = (token: string): boolean =>
  isWatchFlag(token) || isNodeWatchPath(token) || isNodeWatchOutput(token);

const isNodeWatchPath = (token: string): boolean =>
  token === "--watch-path" || Fn.pipe(token, Str.startsWith("--watch-path="));

const isNodeWatchOutput = (token: string): boolean =>
  token === "--watch-preserve-output" ||
  token === "--no-watch-preserve-output" ||
  Fn.pipe(token, Str.startsWith("--watch-preserve-output="));

/**
 * Execute one child CLI run with inherited stdio, so reports stream to the
 * user's terminal as they are produced. The child's argv is always the user's
 * original flags; a narrowed plan is passed through the environment instead,
 * so aliases, repeated flags, and interpreter options cannot be mangled. The
 * child is also marked as a watch child so it never starts its own watcher,
 * whatever argv spelling reached it.
 *
 * @internal
 */
const runChildOnce = Effect.fnUntraced(function* (
  session: WatchSessionOptions,
  plan: Watch.WatchRunPlan,
): Effect.fn.Return<void, WatchSessionError, ChildProcessSpawner.ChildProcessSpawner> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const { executable, execArgv, script } = session.invocation;
  const narrowFeatures = plan.full ? undefined : yield* narrowEnvValue(plan.features);
  const env = {
    [watchChildEnvName]: watchChildEnvValue,
    [narrowEnvName]: narrowFeatures,
  };
  yield* spawner.exitCode(
    ChildProcess.make(executable, [...execArgv, script, ...session.invocation.args], {
      env,
      extendEnv: true,
      stdout: "inherit",
      stderr: "inherit",
    }),
  );
});

/**
 * Run the watch loop: execute the initial full run, then consume trigger
 * batches from the queue, executing one child run per batch until the queue
 * ends.
 *
 * @internal
 */
export const watchLoop = Effect.fnUntraced(function* (
  session: WatchSessionOptions,
  triggers: Queue.Dequeue<ReadonlyArray<Watch.WatchTrigger>>,
  patterns: Watch.WatchPatterns,
): Effect.fn.Return<void, WatchSessionError, ChildProcessSpawner.ChildProcessSpawner> {
  const classifyTrigger = Watch.makeTriggerClassifier(patterns);
  yield* runChildOnce(session, { full: true, features: session.cli.features });
  yield* Watch.rerunLoop(triggers, Schedule.spaced("100 millis"), (batch) =>
    Effect.gen(function* () {
      const plan = Watch.planForTriggers(batch, session.cli.features, classifyTrigger);
      yield* runChildOnce(session, plan);
    }),
  );
});

/**
 * Run a full watch session: initial run, then rerun on file changes until the
 * process is interrupted. The watcher pump and the rerun loop run as sibling
 * fibers joined at the end, so Ctrl+C interrupts both through the session
 * scope.
 *
 * @internal
 */
export const watchSession = Effect.fnUntraced(function* (
  session: WatchSessionOptions,
): Effect.fn.Return<
  void,
  WatchSessionError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path | Scope.Scope
> {
  const path = yield* Path.Path;
  const patterns = {
    features: Arr.map(session.cli.features, (pattern) => path.resolve(pattern)),
    steps: Arr.map(session.cli.steps, (pattern) => path.resolve(pattern)),
  };
  const paths = Watch.watchPaths(patterns);
  const events = yield* Watch.mergedWatchEvents(paths);
  const triggers = yield* Watch.makeTriggerQueue;
  // The pump and the rerun loop are sibling fibers on the session scope:
  // all([pump.await, loop]) runs them concurrently and joins when the loop
  // ends, so a watcher teardown cannot outlive a rerun in flight.
  yield* Effect.all(
    [
      Effect.flatMap(Effect.forkScoped(Watch.pumpTriggerQueue(events, triggers)), Fiber.join),
      watchLoop(session, triggers, patterns),
    ],
    { concurrency: 2 },
  ).pipe(Effect.asVoid);
}, Effect.scoped);
