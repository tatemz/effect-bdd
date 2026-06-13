import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noTryCatch, noTryCatchRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noTryCatchRuleName, noTryCatch, {
  valid: ["const program = Effect.try({ try: read, catch: identity })"],
  invalid: [
    { code: "try { read() } catch (error) { console.error(error) }", errors: error("tryCatch") },
  ],
});
