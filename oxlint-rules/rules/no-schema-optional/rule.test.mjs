import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noSchemaOptional, noSchemaOptionalRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noSchemaOptionalRuleName, noSchemaOptional, {
  valid: ["const User = Schema.Struct({ name: Schema.optionalKey(Schema.String) })"],
  invalid: [
    {
      code: "const User = Schema.Struct({ name: Schema.optional(Schema.String) })",
      errors: error("schemaOptional"),
    },
  ],
});
