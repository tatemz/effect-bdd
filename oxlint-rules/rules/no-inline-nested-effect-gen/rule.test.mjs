import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noInlineNestedEffectGen, noInlineNestedEffectGenRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noInlineNestedEffectGenRuleName, noInlineNestedEffectGen, {
  valid: [
    "const program = Effect.gen(function* () { return yield* Effect.succeed(1) })",
    "const selected = flag ? Effect.succeed(1) : Effect.succeed(0)",
  ],
  invalid: [
    {
      code: "const program = flag ? Effect.gen(function* () { return 1 }) : Effect.succeed(0)",
      errors: error("nestedGen"),
    },
    {
      code: "function* run() { yield* Effect.gen(function* () { return 1 }) }",
      errors: error("nestedGen"),
    },
    {
      code: "const program = Effect.flatMap(effect, () => Effect.gen(function* () { return 1 }))",
      errors: error("nestedGen"),
    },
  ],
});
