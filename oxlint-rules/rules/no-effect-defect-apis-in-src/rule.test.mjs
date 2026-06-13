import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noEffectDefectApisInSrc, noEffectDefectApisInSrcRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noEffectDefectApisInSrcRuleName, noEffectDefectApisInSrc, {
  valid: ["const program = Effect.fail(new ExpectedFailure())"],
  invalid: [
    { code: 'Effect.die("boom")', errors: error("defectApi") },
    { code: 'Effect.dieMessage("boom")', errors: error("defectApi") },
    { code: "Effect.orDieWith(program, identity)", errors: error("defectApi") },
  ],
});
