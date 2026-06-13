import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noEffectOrDie, noEffectOrDieRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noEffectOrDieRuleName, noEffectOrDie, {
  valid: ['const program = Effect.mapError(Effect.fail("no"), String)'],
  invalid: [
    { code: 'const program = Effect.orDie(Effect.fail("no"))', errors: error("orDie") },
    { code: 'const program = Effect.fail("no").pipe(Effect.orDie)', errors: error("orDie") },
  ],
});
