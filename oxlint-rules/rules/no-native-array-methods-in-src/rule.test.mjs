import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noNativeArrayMethodsInSrc, noNativeArrayMethodsInSrcRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noNativeArrayMethodsInSrcRuleName, noNativeArrayMethodsInSrc, {
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
