import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import { RuleTester } from "oxlint/plugins-dev";
import { rules } from "../oxlint-rules/effect-bdd.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

const error = (messageId: string) => [{ messageId }];

describe("effect-bdd oxlint rules", () => {
  tester.run("no-inline-nested-effect-gen", rules["no-inline-nested-effect-gen"], {
    valid: [
      "const program = Effect.gen(function* () { return yield* Effect.succeed(1) })",
      "const selected = flag ? Effect.succeed(1) : Effect.succeed(0)",
    ],
    invalid: [
      {
        code: "const program = flag ? Effect.gen(function* () { return 1 }) : Effect.succeed(0)",
        errors: error("nestedGen"),
      },
      {
        code: "function* run() { yield* Effect.gen(function* () { return 1 }) }",
        errors: error("nestedGen"),
      },
      {
        code: "const program = Effect.flatMap(effect, () => Effect.gen(function* () { return 1 }))",
        errors: error("nestedGen"),
      },
    ],
  });

  tester.run("no-process-env", rules["no-process-env"], {
    valid: ['const home = Config.string("HOME")'],
    invalid: [{ code: "const home = process.env.HOME", errors: error("directEnv") }],
  });

  tester.run("no-effect-or-die", rules["no-effect-or-die"], {
    valid: ['const program = Effect.mapError(Effect.fail("no"), String)'],
    invalid: [
      { code: 'const program = Effect.orDie(Effect.fail("no"))', errors: error("orDie") },
      { code: 'const program = Effect.fail("no").pipe(Effect.orDie)', errors: error("orDie") },
    ],
  });

  tester.run("no-for-loops-in-src", rules["no-for-loops-in-src"], {
    valid: ["const total = Arr.reduce(values, 0, (sum, value) => sum + value)"],
    invalid: [
      { code: "for (const value of values) { console.log(value) }", errors: error("forLoop") },
      {
        code: "for (let index = 0; index < values.length; index += 1) { console.log(index) }",
        errors: error("forLoop"),
      },
      { code: "for (const key in record) { console.log(key) }", errors: error("forLoop") },
    ],
  });

  tester.run("no-native-array-methods-in-src", rules["no-native-array-methods-in-src"], {
    valid: [
      "const doubled = Arr.map(values, (value) => value * 2)",
      "const values = Effect.forEach(items, identity)",
      "const isList = Arr.isArray(value)",
    ],
    invalid: [
      { code: "const doubled = values.map((value) => value * 2)", errors: error("nativeArray") },
      { code: "const isList = Array.isArray(value)", errors: error("nativeArray") },
    ],
  });

  tester.run("no-native-string-methods-in-src", rules["no-native-string-methods-in-src"], {
    valid: [
      "const shout = Str.toUpperCase(text)",
      'const segments = Str.split(path, "/")',
      "const decoded = definition.expression.match(value)",
    ],
    invalid: [
      { code: "const shout = text.toUpperCase()", errors: error("nativeString") },
      { code: 'const segments = path.split("/")', errors: error("nativeString") },
      { code: "const text = String.fromCharCode(65)", errors: error("nativeString") },
    ],
  });

  tester.run("no-native-object-methods-in-src", rules["no-native-object-methods-in-src"], {
    valid: ["const keys = Record_.keys(record)"],
    invalid: [{ code: "const keys = Object.keys(record)", errors: error("nativeObject") }],
  });

  tester.run("no-effect-named-imports-in-src", rules["no-effect-named-imports-in-src"], {
    valid: [
      'import * as Effect from "effect/Effect"',
      'import * as Platform from "@effect/platform"',
    ],
    invalid: [
      { code: 'import { Effect } from "effect"', errors: error("effectImport") },
      { code: 'import Effect from "effect"', errors: error("effectImport") },
      {
        code: 'import { NodeFileSystem } from "@effect/platform-node"',
        errors: error("effectImport"),
      },
    ],
  });

  tester.run("no-throw-statements", rules["no-throw-statements"], {
    valid: ['const program = Effect.fail(new Error("no"))'],
    invalid: [{ code: 'throw new Error("no")', errors: error("throwStatement") }],
  });

  tester.run("no-try-catch", rules["no-try-catch"], {
    valid: ["const program = Effect.try({ try: read, catch: identity })"],
    invalid: [
      { code: "try { read() } catch (error) { console.error(error) }", errors: error("tryCatch") },
    ],
  });

  tester.run("no-native-date-url-json-boundaries", rules["no-native-date-url-json-boundaries"], {
    valid: [
      "const now = Clock.currentTimeMillis",
      "const decoded = Schema.decodeUnknownEffect(schema)(value)",
    ],
    invalid: [
      { code: "const now = Date.now()", errors: error("nativeBoundary") },
      { code: "const date = new Date()", errors: error("nativeBoundary") },
      { code: "const parsed = JSON.parse(raw)", errors: error("nativeBoundary") },
      { code: "const params = new URLSearchParams(raw)", errors: error("nativeBoundary") },
    ],
  });
});

describe("effect-bdd oxlint config scoping", () => {
  it("applies global, src-only, and reporter boundary rules", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const temporaryRoot = mkdtempSync(join(tmpdir(), "effect-bdd-oxlint-"));
    const oxlint = join(root, "node_modules", ".bin", "oxlint");
    const plugin = join(root, "oxlint-rules", "effect-bdd.mjs");

    try {
      mkdirSync(join(temporaryRoot, "src", "internal", "cli"), { recursive: true });
      mkdirSync(join(temporaryRoot, "test"), { recursive: true });
      writeFileSync(
        join(temporaryRoot, ".oxlintrc.json"),
        JSON.stringify({
          jsPlugins: [plugin],
          rules: {
            "effect-bdd/no-process-env": "error",
          },
          overrides: [
            {
              files: ["src/**"],
              rules: {
                "effect-bdd/no-throw-statements": "error",
              },
            },
            {
              files: ["src/**"],
              rules: {
                "effect-bdd/no-native-date-url-json-boundaries": [
                  "error",
                  { allowedFiles: ["src/internal/cli/reporter.ts"] },
                ],
              },
            },
          ],
        }),
      );
      writeFileSync(join(temporaryRoot, "test", "env.ts"), "const home = process.env.HOME\n");
      writeFileSync(
        join(temporaryRoot, "test", "throw.ts"),
        'throw new Error("allowed outside src")\n',
      );
      writeFileSync(
        join(temporaryRoot, "src", "domain.ts"),
        'throw new Error("no")\nconst parsed = JSON.parse(raw)\n',
      );
      writeFileSync(
        join(temporaryRoot, "src", "internal", "cli", "reporter.ts"),
        "const text = JSON.stringify(report)\n",
      );

      const result = spawnSync(oxlint, [".", "--format", "json"], {
        cwd: temporaryRoot,
        encoding: "utf8",
      });

      const output = JSON.parse(result.stdout) as {
        diagnostics: Array<{ code: string; filename: string }>;
      };
      const codes = new Set(output.diagnostics.map((diagnostic) => diagnostic.code));
      const diagnosticsByFile = (filename: string) =>
        output.diagnostics
          .filter((diagnostic) => diagnostic.filename === filename)
          .map((diagnostic) => diagnostic.code);

      assert.notStrictEqual(result.status, 0);
      assert.deepStrictEqual(codes.has("effect-bdd(no-process-env)"), true);
      assert.deepStrictEqual(codes.has("effect-bdd(no-throw-statements)"), true);
      assert.deepStrictEqual(codes.has("effect-bdd(no-native-date-url-json-boundaries)"), true);
      assert.deepStrictEqual(
        diagnosticsByFile("src/internal/cli/reporter.ts").includes(
          "effect-bdd(no-native-date-url-json-boundaries)",
        ),
        false,
      );
      assert.deepStrictEqual(
        diagnosticsByFile("test/throw.ts").includes("effect-bdd(no-throw-statements)"),
        false,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
