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
        if (isUntypedTryPromise(node)) {
          report(context, node, "untypedTryPromise");
        }
      },
    };
  },
});

const isUntypedTryPromise = (node) =>
  isMemberCall(node, "Effect", "tryPromise") && isFunctionArgument(node.arguments[0]);

const isFunctionArgument = (node) =>
  node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression";
