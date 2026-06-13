import { isMemberCall } from "../shared/ast.mjs";
import { createRule, report } from "../shared/rule.mjs";

export const noUntypedTryPromiseRuleName = "no-untyped-try-promise";

export const noUntypedTryPromise = createRule({
  description: "Require Effect.tryPromise object overloads with typed catch handlers.",
  messages: {
    untypedTryPromise:
      "Use Effect.tryPromise({ try, catch }) for fallible promises so boundary errors stay typed.",
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          isMemberCall(node, "Effect", "tryPromise") &&
          (node.arguments[0]?.type === "ArrowFunctionExpression" ||
            node.arguments[0]?.type === "FunctionExpression")
        ) {
          report(context, node, "untypedTryPromise");
        }
      },
    };
  },
});
