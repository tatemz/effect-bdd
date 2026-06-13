import { isMemberCall } from "../shared/ast.mjs";
import { createRule, report } from "../shared/rule.mjs";

export const noSchemaOptionalRuleName = "no-schema-optional";

export const noSchemaOptional = createRule({
  description: "Disallow Schema.optional for optional object keys.",
  messages: {
    schemaOptional:
      "Use Schema.optionalKey for optional object keys, or model undefined explicitly.",
  },
  create(context) {
    return {
      CallExpression(node) {
        if (isMemberCall(node, "Schema", "optional")) {
          report(context, node, "schemaOptional");
        }
      },
    };
  },
});
