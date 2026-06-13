import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noForLoopsInSrc, noForLoopsInSrcRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noForLoopsInSrcRuleName, noForLoopsInSrc, {
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
