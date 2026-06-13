import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

      const output = JSON.parse(result.stdout);
      const codes = new Set(output.diagnostics.map((diagnostic) => diagnostic.code));
      const diagnosticsByFile = (filename) =>
        output.diagnostics
          .filter((diagnostic) => diagnostic.filename === filename)
          .map((diagnostic) => diagnostic.code);

      expect(result.status).not.toBe(0);
      expect(codes.has("effect-bdd(no-process-env)")).toBe(true);
      expect(codes.has("effect-bdd(no-throw-statements)")).toBe(true);
      expect(codes.has("effect-bdd(no-native-date-url-json-boundaries)")).toBe(true);
      expect(
        diagnosticsByFile("src/internal/cli/reporter.ts").includes(
          "effect-bdd(no-native-date-url-json-boundaries)",
        ),
      ).toBe(false);
      expect(diagnosticsByFile("test/throw.ts").includes("effect-bdd(no-throw-statements)")).toBe(
        false,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
