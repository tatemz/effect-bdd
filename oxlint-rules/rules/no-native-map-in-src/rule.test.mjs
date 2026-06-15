import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noNativeMapInSrc, noNativeMapInSrcRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noNativeMapInSrcRuleName, noNativeMapInSrc, {
  valid: [
    "const lookup = Record.fromEntries(entries)",
    "type Lookup = Record.ReadonlyRecord<string, Value>",
  ],
  invalid: [
    {
      code: "const lookup = new Map(entries)",
      errors: error("nativeMap"),
    },
    {
      code: "const lookup = new WeakMap<object, Value>()",
      errors: error("nativeMap"),
    },
    {
      code: "type Lookup = Map<string, Value>",
      errors: error("nativeMap"),
    },
    {
      code: "type Lookup = ReadonlyMap<string, Value>",
      errors: error("nativeMap"),
    },
  ],
});
