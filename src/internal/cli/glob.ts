import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fn from "effect/Function";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Path from "effect/Path";
import * as Str from "effect/String";
import type { DiscoveryError } from "./errors.ts";

/**
 * Resolves file glob patterns against the file system.
 *
 * Supports a deliberately minimal pattern language: `*` (within a path
 * segment), `?` (single character within a segment), and `**` (zero or more
 * segments). Patterns without wildcards are treated as literal file paths.
 *
 * @internal
 */
export class GlobResolver extends Context.Service<
  GlobResolver,
  {
    readonly resolve: (
      patterns: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<string>, DiscoveryError>;
  }
>()("effect-bdd/cli/GlobResolver") {
  static readonly layer: Layer.Layer<GlobResolver, never, FileSystem.FileSystem | Path.Path> =
    Layer.effect(
      GlobResolver,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        return GlobResolver.of({
          resolve: Effect.fnUntraced(function* (patterns) {
            const matches = yield* Effect.forEach(patterns, (pattern) =>
              resolvePattern(fs, path, pattern),
            );
            return Fn.pipe(matches, Arr.flatten, Arr.dedupe, Arr.sort(Order.String));
          }),
        });
      }),
    );
}

const resolvePattern = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  pattern: string,
): Effect.Effect<ReadonlyArray<string>, DiscoveryError> => {
  const segments = Fn.pipe(
    Str.split(path.resolve(pattern), "/"),
    Arr.filter((segment) => segment.length > 0),
  );
  return Fn.pipe(
    Arr.findFirstIndex(segments, hasWildcard),
    Option.match({
      onNone: () => fileOrEmpty(fs, `/${Arr.join(segments, "/")}`),
      onSome: (magicIndex) => {
        const [literal, magic] = Arr.splitAt(segments, magicIndex);
        return matchWildcards(fs, `/${Arr.join(literal, "/")}`, magic);
      },
    }),
  );
};

const fileOrEmpty = Effect.fnUntraced(function* (fs: FileSystem.FileSystem, file: string) {
  const info = yield* Effect.orElseSucceed(fs.stat(file), () => undefined);
  return info?.type === "File" ? [file] : [];
});

const matchWildcards = Effect.fnUntraced(function* (
  fs: FileSystem.FileSystem,
  base: string,
  segments: ReadonlyArray<string>,
) {
  if (!Arr.contains("**")(segments)) {
    return yield* matchSegments(fs, base, segments);
  }
  const matcher = compileMatcher(segments);
  const entries = yield* Fn.pipe(
    fs.readDirectory(base, { recursive: true }),
    Effect.orElseSucceed((): Array<string> => []),
  );
  const matched = Arr.filter(entries, (entry) => matcher.test(entry));
  const files = yield* Effect.forEach(matched, (entry) => fileOrEmpty(fs, `${base}/${entry}`));
  return Arr.flatten(files);
});

const matchSegments: (
  fs: FileSystem.FileSystem,
  base: string,
  segments: ReadonlyArray<string>,
) => Effect.Effect<ReadonlyArray<string>> = Effect.fnUntraced(function* (
  fs: FileSystem.FileSystem,
  base: string,
  segments: ReadonlyArray<string>,
) {
  if (segments.length === 0) {
    return yield* fileOrEmpty(fs, base);
  }
  const [segment, ...rest] = segments;
  return yield* hasWildcard(segment)
    ? matchWildcardSegment(fs, base, segment, rest)
    : matchSegments(fs, `${base}/${segment}`, rest);
});

const matchWildcardSegment: (
  fs: FileSystem.FileSystem,
  base: string,
  segment: string,
  rest: ReadonlyArray<string>,
) => Effect.Effect<ReadonlyArray<string>> = Effect.fnUntraced(function* (
  fs: FileSystem.FileSystem,
  base: string,
  segment: string,
  rest: ReadonlyArray<string>,
) {
  const entries = yield* Fn.pipe(
    fs.readDirectory(base),
    Effect.orElseSucceed((): Array<string> => []),
  );
  const matcher = new RegExp(`^${segmentToRegExp(segment)}$`);
  const nested = yield* Effect.forEach(
    Arr.filter(entries, (entry) => matcher.test(entry)),
    (entry) => matchSegments(fs, `${base}/${entry}`, rest),
  );
  return Arr.flatten(nested);
});

const hasWildcard = (segment: string): boolean =>
  Fn.pipe(segment, Str.includes("*")) || Fn.pipe(segment, Str.includes("?"));

const compileMatcher = (segments: ReadonlyArray<string>): RegExp =>
  new RegExp(
    `^${Fn.pipe(
      segments,
      Arr.map((segment, index) => {
        const last = index === segments.length - 1;
        return segment === "**"
          ? last
            ? ".*"
            : "(?:[^/]+/)*"
          : `${segmentToRegExp(segment)}${last ? "" : "/"}`;
      }),
      Arr.join(""),
    )}$`,
  );

const segmentToRegExp = (segment: string): string =>
  Fn.pipe(
    segment,
    Str.replace(/[.+^${}()|[\]\\]/g, "\\$&"),
    Str.replace(/\*/g, "[^/]*"),
    Str.replace(/\?/g, "[^/]"),
  );
