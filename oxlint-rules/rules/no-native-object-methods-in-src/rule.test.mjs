import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noNativeObjectMethodsInSrc, noNativeObjectMethodsInSrcRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noNativeObjectMethodsInSrcRuleName, noNativeObjectMethodsInSrc, {
  valid: ["const keys = Record_.keys(record)"],
  invalid: [{ code: "const keys = Object.keys(record)", errors: error("nativeObject") }],
});
