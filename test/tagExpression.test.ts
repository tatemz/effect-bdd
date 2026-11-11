import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Option } from "effect";

interface TagExpressionModule {
  readonly compileAll: (
    expressions: ReadonlyArray<string>,
  ) => Effect.Effect<(tags: ReadonlyArray<string>) => boolean, unknown>;
}

const loadTagExpression: Effect.Effect<TagExpressionModule> = Effect.promise(
  async (): Promise<TagExpressionModule> =>
    import(["../src/internal/cli", "tagExpression.ts"].join("/")),
);

describe("tagExpression", () => {
  it.effect("matches tags with and, or, not, and parentheses", () =>
    Effect.gen(function* () {
      const TagExpression = yield* loadTagExpression;
      const predicate = yield* TagExpression.compileAll([
        "@checkout and not @slow",
        "(@happy or @smoke)",
      ]);

      assert.strictEqual(predicate(["@checkout", "@happy"]), true);
      assert.strictEqual(predicate(["@checkout", "@smoke"]), true);
      assert.strictEqual(predicate(["@checkout", "@slow", "@happy"]), false);
      assert.strictEqual(predicate(["@checkout"]), false);
    }),
  );

  it.effect("combines repeated tag expressions with and", () =>
    Effect.gen(function* () {
      const TagExpression = yield* loadTagExpression;
      const predicate = yield* TagExpression.compileAll(["@checkout", "not @slow"]);

      assert.strictEqual(predicate(["@checkout"]), true);
      assert.strictEqual(predicate(["@checkout", "@slow"]), false);
      assert.strictEqual(predicate(["@other"]), false);
    }),
  );

  it.effect("rejects malformed expressions", () =>
    Effect.gen(function* () {
      const TagExpression = yield* loadTagExpression;
      const result = yield* Effect.exit(TagExpression.compileAll(["@checkout and"]));

      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        const error = Option.getOrThrow(Cause.findErrorOption(result.cause));
        assert.strictEqual(error instanceof Error, true);
        if (error instanceof Error) {
          assert.match(error.message, /Could not parse tag expression/);
        }
      }
    }),
  );

  it.effect("accepts tag names with punctuation and non-ASCII characters", () =>
    Effect.gen(function* () {
      const TagExpression = yield* loadTagExpression;
      const predicate = yield* TagExpression.compileAll([
        "@issue:123 and @v1.2.3 and @slow/path and @comment_tag#2 and @日本語",
      ]);

      assert.strictEqual(
        predicate(["@issue:123", "@v1.2.3", "@slow/path", "@comment_tag#2", "@日本語"]),
        true,
      );
      assert.strictEqual(predicate(["@issue:123", "@v1.2.3"]), false);
    }),
  );

  it.effect("decodes escaped reserved characters in tag names", () =>
    Effect.gen(function* () {
      const TagExpression = yield* loadTagExpression;
      const predicate = yield* TagExpression.compileAll(["@x\\(y\\) and @back\\\\slash"]);

      assert.strictEqual(predicate(["@x(y)", "@back\\slash"]), true);
      assert.strictEqual(predicate(["@x(y)"]), false);
    }),
  );

  it.effect("rejects illegal escapes", () =>
    Effect.gen(function* () {
      const TagExpression = yield* loadTagExpression;
      const result = yield* Effect.exit(TagExpression.compileAll(["@tag\\q"]));

      assert.strictEqual(result._tag, "Failure");
    }),
  );

  it.effect("decodes escaped whitespace in tag names", () =>
    Effect.gen(function* () {
      const TagExpression = yield* loadTagExpression;
      const predicate = yield* TagExpression.compileAll(["@two\\ words"]);

      assert.strictEqual(predicate(["@two words"]), true);
      assert.strictEqual(predicate(["@two"]), false);
    }),
  );

  it.effect("rejects a trailing backslash", () =>
    Effect.gen(function* () {
      const TagExpression = yield* loadTagExpression;
      const result = yield* Effect.exit(TagExpression.compileAll(["@tag\\"]));

      assert.strictEqual(result._tag, "Failure");
    }),
  );

  it.effect("rejects operators glued to a tag", () =>
    Effect.gen(function* () {
      const TagExpression = yield* loadTagExpression;
      const result = yield* Effect.exit(TagExpression.compileAll(["@a and@b"]));

      assert.strictEqual(result._tag, "Failure");
    }),
  );
});
