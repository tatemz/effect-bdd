import { isMemberCall } from "../shared/ast.mjs";
import { createRule, report } from "../shared/rule.mjs";

export const noEffectDefectApisInSrcRuleName = "no-effect-defect-apis-in-src";

const defectMethods = new Set(["die", "dieMessage", "orDie", "orDieWith"]);

export const noEffectDefectApisInSrc = createRule({
  description: "Disallow Effect defect APIs in source files.",
  messages: {
    defectApi: "Keep recoverable failures typed. Do not convert expected failures into defects.",
  },
  create(context) {
    return {
      CallExpression(node) {
        for (const method of defectMethods) {
          if (isMemberCall(node, "Effect", method)) {
            report(context, node, "defectApi");
            return;
          }
        }
      },
    };
  },
});
