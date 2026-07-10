import { assert, describe, it } from "@effect/vitest";
import * as fs from "node:fs/promises";
import { defaultGeneratedScale, ensureGeneratedSuites } from "../benchmarks/src/generatedSuites.ts";
import { fromBenchmarkRoot } from "../benchmarks/src/paths.ts";

describe("generated benchmark suites", () => {
  it("removes stale files when a generated scale shrinks", async () => {
    try {
      await ensureGeneratedSuites({
        ...defaultGeneratedScale,
        parseFeatures: 3,
        parseScenariosPerFeature: 1,
      });
      await ensureGeneratedSuites({
        ...defaultGeneratedScale,
        parseFeatures: 1,
        parseScenariosPerFeature: 1,
      });

      const files = await fs.readdir(fromBenchmarkRoot("generated", "features", "parse-scale"));
      assert.deepStrictEqual(files, ["feature-001.feature"]);

      const cucumberSteps = await fs.readFile(
        fromBenchmarkRoot("generated", "cucumber", "parse-scale.steps.ts"),
        "utf8",
      );
      assert.strictEqual(/cucumber\/world/.test(cucumberSteps), false);
    } finally {
      await ensureGeneratedSuites(defaultGeneratedScale);
    }
  });
});
