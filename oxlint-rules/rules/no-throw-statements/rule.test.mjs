import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noThrowStatements, noThrowStatementsRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noThrowStatementsRuleName, noThrowStatements, {
  valid: ['const program = Effect.fail(new Error("no"))'],
  invalid: [{ code: 'throw new Error("no")', errors: error("throwStatement") }],
});
