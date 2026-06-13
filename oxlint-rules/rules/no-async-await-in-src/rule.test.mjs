import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noAsyncAwaitInSrc, noAsyncAwaitInSrcRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noAsyncAwaitInSrcRuleName, noAsyncAwaitInSrc, {
  valid: ["const program = Effect.tryPromise({ try: () => fetch(url), catch: identity })"],
  invalid: [
    { code: "async function load() { return 1 }", errors: error("asyncFunction") },
    { code: "const load = async () => 1", errors: error("asyncFunction") },
    { code: "const value = await promise", errors: error("awaitExpression") },
    { code: "const value = new Promise((resolve) => resolve(1))", errors: error("rawPromise") },
  ],
});
