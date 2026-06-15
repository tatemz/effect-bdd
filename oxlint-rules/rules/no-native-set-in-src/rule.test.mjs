import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noNativeSetInSrc, noNativeSetInSrcRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noNativeSetInSrcRuleName, noNativeSetInSrc, {
  valid: ["const unique = Arr.dedupe(values)", "type Lookup = Record.ReadonlyRecord<string, true>"],
  invalid: [
    {
      code: "const unique = new Set(values)",
      errors: error("nativeSet"),
    },
    {
      code: "const seen = new WeakSet<object>()",
      errors: error("nativeSet"),
    },
    {
      code: "type Seen = Set<string>",
      errors: error("nativeSet"),
    },
    {
      code: "type Seen = ReadonlySet<string>",
      errors: error("nativeSet"),
    },
  ],
});
