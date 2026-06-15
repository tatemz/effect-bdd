import { isIdentifier } from "../shared/ast.mjs";
import { createRule, report } from "../shared/rule.mjs";

export const noNativeMapInSrcRuleName = "no-native-map-in-src";

const nativeMapTypes = new Set(["Map", "ReadonlyMap", "WeakMap"]);

const isNativeMapIdentifier = (node) =>
  node?.type === "Identifier" && nativeMapTypes.has(node.name);

export const noNativeMapInSrc = createRule({
  description: "Disallow native Map dictionaries in source files.",
  messages: {
    nativeMap: "Use Effect Record, HashMap, or another Effect collection instead of native Map.",
  },
  create(context) {
    return {
      NewExpression(node) {
        if (isIdentifier(node.callee, "Map") || isIdentifier(node.callee, "WeakMap")) {
          report(context, node, "nativeMap");
        }
      },
      TSTypeReference(node) {
        if (isNativeMapIdentifier(node.typeName)) {
          report(context, node, "nativeMap");
        }
      },
    };
  },
});
