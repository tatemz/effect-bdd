import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { fileURLToPath } from "node:url";
import { GlobResolver } from "../src/internal/cli/glob.ts";

const TestLayer = GlobResolver.layer.pipe(Layer.provideMerge(NodeServices.layer));

const makeTree = Effect.fnUntraced(function* (files: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({
    directory: path.dirname(fileURLToPath(import.meta.url)),
    prefix: ".effect-bdd-glob-",
  });
  yield* Effect.forEach(files, (file) =>
    Effect.gen(function* () {
      const target = path.join(root, file);
      yield* fs.makeDirectory(path.dirname(target), { recursive: true });
      yield* fs.writeFileString(target, "");
    }),
  );
  return root;
});

const resolveRelative = (root: string, patterns: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const glob = yield* GlobResolver;
    const paths = yield* glob.resolve(patterns.map((pattern) => path.join(root, pattern)));
    return paths.map((resolved) => path.relative(root, resolved));
  });

describe("GlobResolver", () => {
  it.effect("matches files in a single directory with *", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* makeTree(["a.feature", "b.feature", "notes.txt", "nested/c.feature"]);
        const paths = yield* resolveRelative(root, ["*.feature"]);
        assert.deepStrictEqual(paths, ["a.feature", "b.feature"]);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("matches nested files at any depth with **", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* makeTree([
          "a.feature",
          "x/b.feature",
          "x/y/c.feature",
          "x/y/notes.txt",
        ]);
        const paths = yield* resolveRelative(root, ["**/*.feature"]);
        assert.deepStrictEqual(paths, ["a.feature", "x/b.feature", "x/y/c.feature"]);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("matches a single character with ?", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* makeTree(["a1.txt", "a22.txt", "b1.txt"]);
        const paths = yield* resolveRelative(root, ["a?.txt"]);
        assert.deepStrictEqual(paths, ["a1.txt"]);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("matches wildcards in intermediate segments", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* makeTree(["one/file.txt", "two/file.txt", "one/deep/file.txt"]);
        const paths = yield* resolveRelative(root, ["*/file.txt"]);
        assert.deepStrictEqual(paths, ["one/file.txt", "two/file.txt"]);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("treats patterns without wildcards as literal file paths", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* makeTree(["exact.feature"]);
        const found = yield* resolveRelative(root, ["exact.feature"]);
        const missing = yield* resolveRelative(root, ["missing.feature"]);
        assert.deepStrictEqual(found, ["exact.feature"]);
        assert.deepStrictEqual(missing, []);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("never returns directories", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* makeTree(["dir.feature/inner.txt"]);
        const paths = yield* resolveRelative(root, ["*.feature"]);
        assert.deepStrictEqual(paths, []);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("returns no matches for directories that do not exist", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* makeTree(["a.feature"]);
        const paths = yield* resolveRelative(root, ["missing/**/*.feature"]);
        assert.deepStrictEqual(paths, []);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("dedupes and sorts results across overlapping patterns", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* makeTree(["b.feature", "a.feature"]);
        const paths = yield* resolveRelative(root, ["*.feature", "a.*", "**/*.feature"]);
        assert.deepStrictEqual(paths, ["a.feature", "b.feature"]);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );
});
