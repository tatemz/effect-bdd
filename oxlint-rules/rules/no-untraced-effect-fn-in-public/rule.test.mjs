import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noUntracedEffectFnInPublic, noUntracedEffectFnInPublicRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noUntracedEffectFnInPublicRuleName, noUntracedEffectFnInPublic, {
  valid: [
    'const run = Effect.fn("run")(function* () {})',
    "const run = Effect.gen(function* () {})",
  ],
  invalid: [
    {
      code: "const run = Effect.fnUntraced(function* () {})",
      errors: error("fnUntraced"),
    },
  ],
});
