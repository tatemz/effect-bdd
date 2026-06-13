import { objectName, propertyName, unchain } from "../shared/ast.mjs";
import { isEffectStdlibCall } from "../shared/effect.mjs";
import { createRule, report } from "../shared/rule.mjs";

export const noNativeArrayMethodsInSrcRuleName = "no-native-array-methods-in-src";

const arrayInstanceMethods = new Set([
  "at",
  "concat",
  "entries",
  "every",
  "fill",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "flat",
  "flatMap",
  "forEach",
  "includes",
  "indexOf",
  "join",
  "lastIndexOf",
  "map",
  "pop",
  "push",
  "reduce",
  "reduceRight",
  "reverse",
  "shift",
  "slice",
  "some",
  "sort",
  "splice",
  "unshift",
]);

const arrayStaticMethods = new Set(["from", "isArray", "of"]);

export const noNativeArrayMethodsInSrc = createRule({
  description: "Disallow native Array helpers in source files.",
  messages: {
    nativeArray: "Use effect/Array instead of native Array methods.",
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = unchain(node.callee);
        if (callee?.type !== "MemberExpression" || isEffectStdlibCall(callee)) {
          return;
        }

        const method = propertyName(callee);
        const namespace = objectName(callee);
        if (
          (namespace === "Array" && arrayStaticMethods.has(method)) ||
          arrayInstanceMethods.has(method)
        ) {
          report(context, node, "nativeArray");
        }
      },
    };
  },
});
