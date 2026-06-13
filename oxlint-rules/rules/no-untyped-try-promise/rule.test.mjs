import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noUntypedTryPromise, noUntypedTryPromiseRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noUntypedTryPromiseRuleName, noUntypedTryPromise, {
  valid: [
    "const result = Effect.tryPromise({ try: () => fetch(url), catch: (cause) => new Error(String(cause)) })",
  ],
  invalid: [
    {
      code: "const result = Effect.tryPromise(() => fetch(url))",
      errors: error("untypedTryPromise"),
    },
  ],
});
