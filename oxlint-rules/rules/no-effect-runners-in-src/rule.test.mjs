import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noEffectRunnersInSrc, noEffectRunnersInSrcRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noEffectRunnersInSrcRuleName, noEffectRunnersInSrc, {
  valid: ["const program = Effect.flatMap(loadConfig, runApp)"],
  invalid: [
    { code: "Effect.runPromise(program)", errors: error("effectRunner") },
    { code: "Effect.runSync(program)", errors: error("effectRunner") },
    { code: "Effect.runFork(program)", errors: error("effectRunner") },
  ],
});
