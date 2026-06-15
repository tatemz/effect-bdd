import { isIdentifier } from "../shared/ast.mjs";
import { createRule, report } from "../shared/rule.mjs";

export const noNativeSetInSrcRuleName = "no-native-set-in-src";

const nativeSetTypes = new Set(["Set", "ReadonlySet", "WeakSet"]);

const isNativeSetIdentifier = (node) =>
  node?.type === "Identifier" && nativeSetTypes.has(node.name);

export const noNativeSetInSrc = createRule({
  description: "Disallow native Set collections in source files.",
  messages: {
    nativeSet:
      "Use Effect Array.dedupe, Record, or another Effect collection instead of native Set.",
  },
  create(context) {
    return {
      NewExpression(node) {
        if (isIdentifier(node.callee, "Set") || isIdentifier(node.callee, "WeakSet")) {
          report(context, node, "nativeSet");
        }
      },
      TSTypeReference(node) {
        if (isNativeSetIdentifier(node.typeName)) {
          report(context, node, "nativeSet");
        }
      },
    };
  },
});
