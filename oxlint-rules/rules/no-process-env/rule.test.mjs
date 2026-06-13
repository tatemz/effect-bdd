import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noProcessEnv, noProcessEnvRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noProcessEnvRuleName, noProcessEnv, {
  valid: ['const home = Config.string("HOME")'],
  invalid: [{ code: "const home = process.env.HOME", errors: error("directEnv") }],
});
