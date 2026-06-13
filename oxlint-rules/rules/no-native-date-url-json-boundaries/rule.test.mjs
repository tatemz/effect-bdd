import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noNativeDateUrlJsonBoundaries, noNativeDateUrlJsonBoundariesRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noNativeDateUrlJsonBoundariesRuleName, noNativeDateUrlJsonBoundaries, {
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
