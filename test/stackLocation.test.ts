import { assert, describe, it } from "@effect/vitest";
import { filePathFromStackUrl, parseStackLocation } from "../src/internal/stackLocation.ts";

describe("stack locations", () => {
  it("decodes escaped file URLs", () => {
    assert.strictEqual(
      filePathFromStackUrl("file:///tmp/step%20definitions/steps.mjs"),
      "/tmp/step definitions/steps.mjs",
    );
  });

  it("keeps plain filesystem paths", () => {
    assert.strictEqual(filePathFromStackUrl("/tmp/steps.mjs"), "/tmp/steps.mjs");
  });

  it("strips the leading slash from Windows drive URLs", () => {
    assert.strictEqual(filePathFromStackUrl("file:///C:/steps/a.mjs"), "C:/steps/a.mjs");
  });

  it("splits coordinates from an escaped file URL", () => {
    assert.deepStrictEqual(parseStackLocation("file:///tmp/step%20definitions/steps.mjs:4:9"), {
      path: "/tmp/step definitions/steps.mjs",
      line: 4,
      column: 9,
    });
  });
});
