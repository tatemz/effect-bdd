import { isIdentifier, propertyName } from "../shared/ast.mjs";
import { createRule, report } from "../shared/rule.mjs";

export const noProcessEnvRuleName = "no-process-env";

export const noProcessEnv = createRule({
  description: "Disallow direct process.env reads.",
  messages: {
    directEnv: "Use Effect Config/ConfigProvider instead of reading runtime env directly.",
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (isIdentifier(node.object, "process") && propertyName(node) === "env") {
          report(context, node, "directEnv");
        }
      },
    };
  },
});
