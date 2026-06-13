import { isMemberCall } from "../shared/ast.mjs";
import { createRule, report } from "../shared/rule.mjs";

export const noInlineNestedEffectGenRuleName = "no-inline-nested-effect-gen";

const isEffectGenCall = (node) => isMemberCall(node, "Effect", "gen");

const isCallbackReturningEffectGen = (node) =>
  (node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression") &&
  isEffectGenCall(node.body);

export const noInlineNestedEffectGen = createRule({
  description: "Disallow nested inline Effect.gen calls inside other effect flows.",
  messages: {
    nestedGen:
      "Use Effect.gen as the direct body of an Effect-producing function; do not nest inline generators inside another effect flow.",
  },
  create(context) {
    return {
      ConditionalExpression(node) {
        if (isEffectGenCall(node.consequent)) {
          report(context, node.consequent, "nestedGen");
        }
        if (isEffectGenCall(node.alternate)) {
          report(context, node.alternate, "nestedGen");
        }
      },
      YieldExpression(node) {
        if (node.delegate && isEffectGenCall(node.argument)) {
          report(context, node, "nestedGen");
        }
      },
      CallExpression(node) {
        if (
          isMemberCall(node, "Effect", "flatMap") &&
          node.arguments.some(isCallbackReturningEffectGen)
        ) {
          report(context, node, "nestedGen");
        }
      },
    };
  },
});
