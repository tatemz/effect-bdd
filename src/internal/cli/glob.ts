import * as Arr from "effect/Array"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import { pipe } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Path from "effect/Path"
import * as Str from "effect/String"
import type { DiscoveryError } from "./errors.ts"

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
    readonly resolve: (patterns: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<string>, DiscoveryError>
  }
>()("effect-bdd/cli/GlobResolver") {
  static readonly layer: Layer.Layer<GlobResolver, never, FileSystem.FileSystem | Path.Path> = Layer.effect(
    GlobResolver,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      return GlobResolver.of({
        resolve: Effect.fnUntraced(function* (patterns) {
          const matches = yield* Effect.forEach(patterns, (pattern) => resolvePattern(fs, path, pattern))
          return pipe(matches, Arr.flatten, Arr.dedupe, Arr.sort(Order.String))
        })
      })
    })
  )
}

const resolvePattern = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  pattern: string
): Effect.Effect<ReadonlyArray<string>, DiscoveryError> => {
  const segments = pipe(
    Str.split(path.resolve(pattern), "/"),
    Arr.filter((segment) => segment.length > 0)
  )
  return pipe(
    Arr.findFirstIndex(segments, hasWildcard),
    Option.match({
      onNone: () => fileOrEmpty(fs, `/${Arr.join(segments, "/")}`),
      onSome: (magicIndex) => {
        const [literal, magic] = Arr.splitAt(segments, magicIndex)
        return matchWildcards(fs, `/${Arr.join(literal, "/")}`, magic)
      }
    })
  )
}

const fileOrEmpty = Effect.fnUntraced(function* (fs: FileSystem.FileSystem, file: string) {
  const info = yield* Effect.orElseSucceed(fs.stat(file), () => undefined)
  return info?.type === "File" ? [file] : []
})

const matchWildcards = Effect.fnUntraced(function* (
  fs: FileSystem.FileSystem,
  base: string,
  segments: ReadonlyArray<string>
) {
  const matcher = compileMatcher(segments)
  const entries = yield* pipe(
    fs.readDirectory(base, { recursive: true }),
    Effect.orElseSucceed((): Array<string> => [])
  )
  const matched = Arr.filter(entries, (entry) => matcher.test(entry))
  const files = yield* Effect.forEach(matched, (entry) => fileOrEmpty(fs, `${base}/${entry}`))
  return Arr.flatten(files)
})

const hasWildcard = (segment: string): boolean => pipe(segment, Str.includes("*")) || pipe(segment, Str.includes("?"))

const compileMatcher = (segments: ReadonlyArray<string>): RegExp =>
  new RegExp(
    `^${pipe(
      segments,
      Arr.map((segment, index) => {
        const last = index === segments.length - 1
        return segment === "**" ? (last ? ".*" : "(?:[^/]+/)*") : `${segmentToRegExp(segment)}${last ? "" : "/"}`
      }),
      Arr.join("")
    )}$`
  )

const segmentToRegExp = (segment: string): string =>
  pipe(segment, Str.replace(/[.+^${}()|[\]\\]/g, "\\$&"), Str.replace(/\*/g, "[^/]*"), Str.replace(/\?/g, "[^/]"))
