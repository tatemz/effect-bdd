import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noTypeAssertions, noTypeAssertionsRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noTypeAssertionsRuleName, noTypeAssertions, {
  valid: [
    "const value = input as const",
    "const value = <const>input",
    "const value = input satisfies Foo",
  ],
  invalid: [
    {
      code: "const value = input as Foo",
      errors: error("typeAssertion"),
    },
    {
      code: "const value = (input as Foo).bar",
      errors: error("typeAssertion"),
    },
    {
      code: "const value = <Foo>input",
      errors: error("typeAssertion"),
    },
  ],
});
