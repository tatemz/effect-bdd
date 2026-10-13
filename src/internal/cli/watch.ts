import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fn from "effect/Function";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Match from "effect/Match";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Str from "effect/String";
import * as Stream from "effect/Stream";
import type * as FileSystemTypes from "effect/FileSystem";

/**
 * A file-watch event: a Create, Update, or Remove with the affected path.
 *
 * @internal
 */
export type WatchTrigger = FileSystemTypes.WatchEvent;

/**
 * What part of the test surface a watch trigger invalidates.
 *
 * - `features`: a `.feature` file changed, so only that file's scenarios need
 *   to rerun.
 * - `steps`: any other watched file changed. Step definitions may live there,
 *   and they can affect every feature, so the rerun cannot be narrowed.
 *
 * @internal
 */
export type WatchScope = "features" | "steps";

/**
 * Which features a watch-mode rerun should execute. When `full` is true the
 * rerun executes every feature matching the user's `--features` globs;
 * otherwise only the accumulated feature paths. Step definitions are always
 * reloaded from their original globs, so a plan never narrows them.
 *
 * @internal
 */
export interface WatchRunPlan {
  readonly full: boolean;
  readonly features: ReadonlyArray<string>;
}

/** @internal */
export const classifyTrigger = (trigger: WatchTrigger): WatchScope =>
  Fn.pipe(trigger.path, Str.endsWith(".feature")) ? "features" : "steps";

const isFeatureRerunTrigger = (trigger: WatchTrigger): boolean =>
  Match.value(trigger).pipe(
    Match.when({ _tag: "Remove" }, () => false),
    Match.orElse((event) => classifyTrigger(event) === "features"),
  );

/**
 * Merge a trigger into an accumulating plan. A removed feature file, or any
 * change that could affect step definitions, widens the plan to a full rerun.
 *
 * @internal
 */
const mergePlan = (accumulator: WatchRunPlan, trigger: WatchTrigger): WatchRunPlan =>
  isFeatureRerunTrigger(trigger)
    ? { full: accumulator.full, features: Arr.append(accumulator.features, trigger.path) }
    : { full: true, features: [] };

/**
 * Finish a plan: deduplicate accumulated feature paths and, for a full rerun,
 * replace them with the user's feature globs.
 *
 * @internal
 */
const finalizePlan = (
  plan: WatchRunPlan,
  featurePatterns: ReadonlyArray<string>,
): WatchRunPlan => ({
  full: plan.full,
  features: plan.full ? featurePatterns : Arr.dedupe(plan.features),
});

/** @internal */
export const planForTriggers = (
  triggers: ReadonlyArray<WatchTrigger>,
  featurePatterns: ReadonlyArray<string>,
): WatchRunPlan =>
  finalizePlan(Arr.reduce(triggers, { full: false, features: [] }, mergePlan), featurePatterns);

/**
 * The watched paths for a session: the user's feature and step globs, kept as
 * supplied so events can be matched back against what the user asked to watch.
 *
 * @internal
 */
export const watchPaths = (options: {
  readonly features: ReadonlyArray<string>;
  readonly steps: ReadonlyArray<string>;
}): ReadonlyArray<string> => Arr.dedupe(Arr.appendAll(options.features, options.steps));

/**
 * The glob matcher used to decide whether a watched path belongs to a pattern.
 * Mirrors the pattern language of the project's own `GlobResolver`: `*` matches
 * within a path segment, `?` a single character, and `**` zero or more
 * segments.
 *
 * @internal
 */
export const globMatcher: (patterns: ReadonlyArray<string>) => (path: string) => boolean = (
  patterns,
) => {
  const matchers = Arr.map(patterns, compileGlob);
  return (path) => Arr.some(matchers, (matcher) => matcher.test(path));
};

const compileGlob = (pattern: string): RegExp => {
  const segments = Fn.pipe(
    Str.split(pattern, "/"),
    Arr.filter((segment) => segment.length > 0),
  );
  const last = segments.length - 1;
  const body = Fn.pipe(
    segments,
    Arr.map((segment, index) =>
      segment === "**"
        ? index === last
          ? ".*"
          : "(?:[^/]+/)*"
        : `${segmentToRegExpSource(segment)}${index === last ? "" : "/"}`,
    ),
    Arr.join(""),
  );
  // Absolute patterns root at the filesystem root; relative patterns match
  // anywhere the caller resolves them to.
  const prefix = Fn.pipe(pattern, Str.startsWith("/")) ? "/" : "";
  return new RegExp(`^${prefix}${body}$`);
};

const segmentToRegExpSource = (segment: string): string =>
  Fn.pipe(
    segment,
    Str.replace(/[.+^${}()|[\]\\]/g, "\\$&"),
    Str.replace(/\*/g, "[^/]*"),
    Str.replace(/\?/g, "[^/]"),
  );

const hasWildcard = (segment: string): boolean =>
  Fn.pipe(segment, Str.includes("*")) || Fn.pipe(segment, Str.includes("?"));

/**
 * The deepest directory of a pattern that contains no wildcard characters: the
 * directory prefix of a glob, or the parent directory of a literal file path.
 * This is what the file watcher can actually watch: `fs.watch` cannot watch a
 * glob, and the Effect Node wrapper stats the watched path first, so a glob
 * string would fail the stat and kill the stream.
 *
 * @internal
 */
export const watchRoot: (pattern: string) => Effect.Effect<string, never, Path.Path> = (pattern) =>
  Effect.map(Path.Path, (path) => {
    const resolved = path.resolve(pattern);
    const segments = Fn.pipe(
      Str.split(resolved, "/"),
      Arr.filter((segment) => segment.length > 0),
    );
    const magicIndex = Arr.findFirstIndex(segments, hasWildcard);
    const literal = Option.match(magicIndex, {
      onNone: () => Arr.dropRight(segments, 1),
      onSome: (index) => Arr.splitAt(segments, index)[0],
    });
    return `/${Arr.join(literal, "/")}`;
  });

/**
 * Watch every pattern's root directory recursively and merge the per-root
 * event streams into one, keeping only events inside the patterns the user
 * asked to watch. Watching the roots (not resolved files) means newly created
 * files are picked up without restarting the watcher. Watch failures are
 * defects: a broken watcher must not silently stop rerunning.
 *
 * @internal
 */
export const mergedWatchEvents: (
  patterns: ReadonlyArray<string>,
) => Effect.Effect<Stream.Stream<WatchTrigger, never>, never, FileSystem.FileSystem | Path.Path> =
  Effect.fnUntraced(function* (patterns) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const absolutePatterns = Arr.map(patterns, (pattern) => path.resolve(pattern));
    const matches = globMatcher(absolutePatterns);
    const roots = yield* Effect.forEach(absolutePatterns, watchRoot);
    return Fn.pipe(
      Arr.dedupe(roots),
      Arr.map((root) =>
        Fn.pipe(
          fs.watch(root, { recursive: true }),
          Stream.orDie,
          // Node reports event paths relative to the watched root; make them
          // absolute so they match the resolved patterns.
          Stream.map((trigger) => ({ ...trigger, path: path.resolve(root, trigger.path) })),
        ),
      ),
      (streams) => Stream.mergeAll(streams, { concurrency: "unbounded" }),
      Stream.filter((trigger) => matches(trigger.path)),
    );
  });

/**
 * A sliding queue of trigger batches. Sliding so a burst of edits during a
 * rerun cannot grow without bound; any overflow still leaves the most recent
 * batches, which see the current file state when they execute.
 *
 * @internal
 */
export const makeTriggerQueue = Queue.sliding<ReadonlyArray<WatchTrigger>>(64);

/**
 * Forward raw watch events into the trigger queue. Events accumulate in the
 * queue; the rerun side drains with `Queue.takeAll`, which waits for at least
 * one event and sweeps up everything buffered behind it, coalescing bursts
 * without a timer.
 *
 * @internal
 */
export const pumpTriggerQueue: (
  events: Stream.Stream<WatchTrigger>,
  queue: Queue.Enqueue<ReadonlyArray<WatchTrigger>>,
) => Effect.Effect<void, never, never> = (events, queue) =>
  Stream.runDrain(
    Fn.pipe(
      events,
      Stream.mapEffect((trigger) => Effect.asVoid(Queue.offer(queue, [trigger]))),
    ),
  );

/**
 * Take one batch from the queue and fold in any batches that arrived while
 * waiting, so a burst of edits runs once rather than once per event.
 *
 * @internal
 */
export const takePendingTriggers: (
  queue: Queue.Dequeue<ReadonlyArray<WatchTrigger>>,
) => Effect.Effect<ReadonlyArray<WatchTrigger>> = (queue) =>
  Effect.map(Queue.takeAll(queue), (batches) => Arr.flatten(batches));

/**
 * Poll the trigger queue on a schedule, running one rerun per drained batch.
 * `Queue.takeAll` never blocks, so each poll coalesces every batch that
 * arrived since the last rerun and cannot wedge on an empty or ended queue the
 * way a blocking consumer can. Runs until interrupted: a watch session lives
 * for the whole process.
 *
 * @internal
 */
export const rerunLoop: <E, R>(
  queue: Queue.Dequeue<ReadonlyArray<WatchTrigger>>,
  interval: Schedule.Schedule<unknown, unknown, never, never>,
  onRerun: (triggers: ReadonlyArray<WatchTrigger>) => Effect.Effect<void, E, R>,
) => Effect.Effect<void, E, R> = (queue, interval, onRerun) =>
  Stream.runDrain(
    Stream.mapEffect(Stream.fromSchedule(interval), () =>
      Effect.gen(function* () {
        const batches = yield* Queue.takeAll(queue);
        if (batches.length > 0) {
          yield* onRerun(Arr.flatten(batches));
        }
      }),
    ),
  );
