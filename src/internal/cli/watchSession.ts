import * as Effect from "effect/Effect";
import type * as FileSystemTypes from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Match from "effect/Match";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import type { PlatformError } from "effect/PlatformError";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import type { CliOptions, CliRunResult } from "./models.ts";
import type { ModuleLoader } from "./moduleLoader.ts";
import type { ReporterError } from "./errors.ts";
import type { GherkinCompiler } from "../parser.ts";
import type { CliRunError } from "./runner.ts";
import type { GlobResolver } from "./glob.ts";
import * as Reporter from "./reporter.ts";
import * as Runner from "./runner.ts";
import * as Watch from "./watch.ts";
import { reloadableModuleLoader } from "./watchModuleLoader.ts";

/** @internal */
export type WatchSessionError = PlatformError | ReporterError;

/**
 * The services an in-process watch session needs on top of the platform
 * services the entrypoint already provides.
 *
 * @internal
 */
export type SessionServices =
  | FileSystemTypes.FileSystem
  | GlobResolver
  | GherkinCompiler
  | ModuleLoader
  | Path.Path
  | Stdio.Stdio;

/**
 * Everything the watch session needs: the parsed CLI options. The session runs
 * in this process, so reruns reuse the loaded runtime instead of re-executing
 * the CLI.
 *
 * @internal
 */
export interface WatchSessionOptions {
  readonly cli: CliOptions;
}

/**
 * Run one in-process run for a plan and emit its full report. A narrowed plan
 * replaces the feature patterns with the changed feature files; every other
 * option (tag/title filters, reporters, timeouts) forwards unchanged, so a
 * rerun behaves identically to a normal CLI run.
 *
 * @internal
 */
export const runPlanOnce = (
  session: WatchSessionOptions,
  plan: Watch.WatchRunPlan,
  reporters: ReadonlyArray<Reporter.Reporter>,
): Effect.Effect<CliRunResult, CliRunError | ReporterError, SessionServices> => {
  const features = plan.full ? session.cli.features : plan.features;
  const runOptions: CliOptions = { ...session.cli, features };
  return Effect.gen(function* () {
    const result = yield* Runner.run(runOptions, {
      onEvent: (event) =>
        Reporter.emitEventAll(reporters, event).pipe(Effect.orElseSucceed(() => undefined)),
    });
    yield* Reporter.emitAll(reporters, result);
    yield* writeStderrLine(
      `[watch] ${result.summary.passed} passed, ${result.summary.failed} failed (${result.summary.total} scenario(s))`,
    );
    return result;
  });
};

/**
 * Make the reporters for the whole session. They are constructed once and
 * reused; a reporter holds no per-run state.
 *
 * @internal
 */
const makeSessionReporters: (
  session: WatchSessionOptions,
) => Effect.Effect<ReadonlyArray<Reporter.Reporter>, ReporterError> = (session) =>
  Reporter.makeReporters(session.cli.reporters, session.cli.outputFiles, {
    verbose: session.cli.verbose,
  });

/**
 * The layers a watch session supplies itself: the re-loadable module loader,
 * which cache-busts step modules on every rerun so edits are seen in this
 * process.
 *
 * @internal
 */
export const sessionLayers: Layer.Layer<ModuleLoader, never, Path.Path> = reloadableModuleLoader;

/**
 * Run the watch loop: execute the initial full run, then consume trigger
 * batches from the queue, running one in-process rerun per batch. A failed
 * rerun (broken edit, unloadable module, no matches) prints and keeps
 * watching; the next change retries. The loop never fails, so a watcher pump
 * defect is what ends the session — a broken watcher must not silently stop
 * rerunning.
 *
 * @internal
 */
const watchLoop: (
  session: WatchSessionOptions,
  triggers: Queue.Dequeue<ReadonlyArray<Watch.WatchTrigger>>,
  reporters: ReadonlyArray<Reporter.Reporter>,
) => Effect.Effect<void, never, SessionServices> = (session, triggers, reporters) =>
  watchLoopWith((plan) =>
    Effect.asVoid(
      Effect.result(runPlanOnce(session, plan, reporters)).pipe(
        Effect.flatMap((outcome) =>
          Match.value(outcome).pipe(
            Match.when({ _tag: "Success" }, () => Effect.void),
            Match.orElse((failure) =>
              Effect.map(writeStderrLine(failureMessage(plan, failure.failure)), () => undefined),
            ),
          ),
        ),
      ),
    ),
  )(session.cli.features, triggers);

/**
 * The watch loop with the run step replaced by `onRun`, which receives each
 * plan. Exposes the loop's scheduling (initial full run, then one run per
 * trigger batch) for tests without real runs.
 *
 * @internal
 */
export const watchLoopWith: <R>(
  onRun: (plan: Watch.WatchRunPlan) => Effect.Effect<void, never, R>,
) => (
  featurePatterns: ReadonlyArray<string>,
  triggers: Queue.Dequeue<ReadonlyArray<Watch.WatchTrigger>>,
) => Effect.Effect<void, never, R> = (onRun) => (featurePatterns, triggers) =>
  Effect.gen(function* () {
    yield* onRun({ full: true, features: featurePatterns });
    yield* Watch.rerunLoop(triggers, Schedule.spaced("100 millis"), (batch) =>
      onRun(Watch.planForTriggers(batch, featurePatterns)),
    );
  });

const errorMessage = (error: CliRunError | ReporterError): string => error.message;

const failureMessage = (plan: Watch.WatchRunPlan, error: CliRunError | ReporterError): string =>
  plan.full
    ? `[watch] initial run failed: ${errorMessage(error)}`
    : `[watch] rerun failed, still watching: ${errorMessage(error)}`;

const writeStderrLine = (line: string): Effect.Effect<void, never, Stdio.Stdio> =>
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    yield* Stream.run(Stream.make(`${line}\n`), stdio.stderr()).pipe(Effect.ignore);
  });

/**
 * Run a full watch session: initial run, then rerun on file changes until the
 * process is interrupted. The watcher pump and the rerun loop run as sibling
 * fibers joined at the end, so Ctrl+C interrupts both through the session
 * scope.
 *
 * @internal
 */
export const watchSession: (
  session: WatchSessionOptions,
) => Effect.Effect<void, WatchSessionError, SessionServices> = (session) =>
  Effect.gen(function* () {
    const reporters = yield* makeSessionReporters(session);
    const paths = Watch.watchPaths({ features: session.cli.features, steps: session.cli.steps });
    const events = yield* Watch.mergedWatchEvents(paths);
    const triggers = yield* Watch.makeTriggerQueue;
    // The pump and the rerun loop are sibling fibers on the session scope:
    // all([pump.await, loop]) runs them concurrently and joins when the loop
    // ends, so a watcher teardown cannot outlive a rerun in flight.
    yield* Effect.all(
      [
        Effect.flatMap(Effect.forkScoped(Watch.pumpTriggerQueue(events, triggers)), Fiber.join),
        watchLoop(session, triggers, reporters),
      ],
      { concurrency: 2 },
    ).pipe(Effect.asVoid);
  }).pipe(Effect.scoped);
