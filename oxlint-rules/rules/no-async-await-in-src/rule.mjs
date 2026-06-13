import { isIdentifier } from "../shared/ast.mjs";
import { createRule, report } from "../shared/rule.mjs";

export const noAsyncAwaitInSrcRuleName = "no-async-await-in-src";

const isAsyncFunction = (node) =>
  (node?.type === "FunctionDeclaration" ||
    node?.type === "FunctionExpression" ||
    node?.type === "ArrowFunctionExpression") &&
  node.async;

export const noAsyncAwaitInSrc = createRule({
  description: "Disallow ambient async/await and raw Promise construction in source files.",
  messages: {
    asyncFunction: "Return an Effect instead of an async function from source modules.",
    awaitExpression: "Use Effect combinators instead of await in source modules.",
    rawPromise: "Use Effect.async or Effect.tryPromise instead of constructing raw Promises.",
  },
  create(context) {
    const checkAsync = (node) => {
      if (isAsyncFunction(node)) {
        report(context, node, "asyncFunction");
      }
    };

    return {
      FunctionDeclaration: checkAsync,
      FunctionExpression: checkAsync,
      ArrowFunctionExpression: checkAsync,
      AwaitExpression(node) {
        report(context, node, "awaitExpression");
      },
      NewExpression(node) {
        if (isIdentifier(node.callee, "Promise")) {
          report(context, node, "rawPromise");
        }
      },
    };
  },
});
