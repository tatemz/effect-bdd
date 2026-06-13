import { isMemberCall, objectName, propertyName, unchain } from "../shared/ast.mjs";
import { createRule, report } from "../shared/rule.mjs";

export const noEffectOrDieRuleName = "no-effect-or-die";

const isEffectOrDieReference = (node) => {
  const expression = unchain(node);
  return (
    expression?.type === "MemberExpression" &&
    objectName(expression) === "Effect" &&
    propertyName(expression) === "orDie"
  );
};

export const noEffectOrDie = createRule({
  description: "Disallow converting typed failures into defects with Effect.orDie.",
  messages: {
    orDie: "Keep failures typed; do not convert recoverable errors into defects with Effect.orDie.",
  },
  create(context) {
    return {
      CallExpression(node) {
        if (isMemberCall(node, "Effect", "orDie")) {
          report(context, node, "orDie");
          return;
        }
        if (propertyName(node.callee) === "pipe" && node.arguments.some(isEffectOrDieReference)) {
          report(context, node, "orDie");
        }
      },
    };
  },
});
