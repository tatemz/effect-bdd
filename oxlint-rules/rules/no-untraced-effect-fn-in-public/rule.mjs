import { isMemberCall } from "../shared/ast.mjs";
import { createRule, report } from "../shared/rule.mjs";

export const noUntracedEffectFnInPublicRuleName = "no-untraced-effect-fn-in-public";

export const noUntracedEffectFnInPublic = createRule({
  description: "Disallow untraced Effect.fn factories in public modules.",
  messages: {
    fnUntraced:
      'Use Effect.fn("name") in public modules so effectful functions keep call-site tracing.',
  },
  create(context) {
    return {
      CallExpression(node) {
        if (isMemberCall(node, "Effect", "fnUntraced")) {
          report(context, node, "fnUntraced");
        }
      },
    };
  },
});
