import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noEffectNamedImportsInSrc, noEffectNamedImportsInSrcRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noEffectNamedImportsInSrcRuleName, noEffectNamedImportsInSrc, {
  valid: [
    'import * as Effect from "effect/Effect"',
    'import * as Platform from "@effect/platform"',
  ],
  invalid: [
    { code: 'import { Effect } from "effect"', errors: error("effectImport") },
    { code: 'import Effect from "effect"', errors: error("effectImport") },
    {
      code: 'import { NodeFileSystem } from "@effect/platform-node"',
      errors: error("effectImport"),
    },
  ],
});
