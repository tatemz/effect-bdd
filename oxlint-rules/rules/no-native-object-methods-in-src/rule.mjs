import { objectName, propertyName, unchain } from "../shared/ast.mjs";
import { createRule, report } from "../shared/rule.mjs";

export const noNativeObjectMethodsInSrcRuleName = "no-native-object-methods-in-src";

const objectStaticMethods = new Set([
  "assign",
  "entries",
  "fromEntries",
  "hasOwn",
  "keys",
  "values",
]);

export const noNativeObjectMethodsInSrc = createRule({
  description: "Disallow native Object dictionary helpers in source files.",
  messages: {
    nativeObject: "Use effect/Record instead of native Object dictionary methods.",
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = unchain(node.callee);
        if (
          callee?.type === "MemberExpression" &&
          objectName(callee) === "Object" &&
          objectStaticMethods.has(propertyName(callee))
        ) {
          report(context, node, "nativeObject");
        }
      },
    };
  },
});
