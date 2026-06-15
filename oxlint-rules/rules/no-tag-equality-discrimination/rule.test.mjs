import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noTagEqualityDiscrimination, noTagEqualityDiscriminationRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noTagEqualityDiscriminationRuleName, noTagEqualityDiscrimination, {
  valid: [
    'const status = result.tag === "Passed"',
    "const sameTag = left._tag === right._tag",
    'const rendered = Match.value(result).pipe(Match.tag("Passed", () => "ok"), Match.exhaustive)',
    {
      code: 'const passed = result._tag === "Passed"',
      filename: "src/internal/legacy.ts",
      options: [{ allowedFiles: ["src/internal/legacy.ts"] }],
    },
  ],
  invalid: [
    { code: 'const passed = result._tag === "Passed"', errors: error("tagEquality") },
    { code: 'const notPassed = result._tag !== "Passed"', errors: error("tagEquality") },
    { code: 'const failed = "Failed" === result._tag', errors: error("tagEquality") },
    { code: 'const failed = result["_tag"] === "Failed"', errors: error("tagEquality") },
  ],
});
