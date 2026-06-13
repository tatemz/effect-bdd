import { objectName, propertyName, unchain } from "../shared/ast.mjs";
import { isEffectStdlibCall } from "../shared/effect.mjs";
import { createRule, report } from "../shared/rule.mjs";

export const noNativeStringMethodsInSrcRuleName = "no-native-string-methods-in-src";

const stringInstanceMethods = new Set([
  "charAt",
  "charCodeAt",
  "codePointAt",
  "endsWith",
  "localeCompare",
  "match",
  "matchAll",
  "normalize",
  "padEnd",
  "padStart",
  "repeat",
  "replace",
  "replaceAll",
  "search",
  "split",
  "startsWith",
  "substring",
  "toLocaleLowerCase",
  "toLocaleUpperCase",
  "toLowerCase",
  "toUpperCase",
  "trim",
  "trimEnd",
  "trimStart",
]);

const stringStaticMethods = new Set(["fromCharCode", "fromCodePoint", "raw"]);

const isSchemaMatchCall = (callee) => {
  const expression = unchain(callee);
  const object = unchain(expression?.object);
  return (
    expression?.type === "MemberExpression" &&
    propertyName(expression) === "match" &&
    object?.type === "MemberExpression" &&
    propertyName(object) === "expression"
  );
};

export const noNativeStringMethodsInSrc = createRule({
  description: "Disallow native String helpers in source files.",
  messages: {
    nativeString: "Use effect/String instead of native String methods.",
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = unchain(node.callee);
        if (
          callee?.type !== "MemberExpression" ||
          isEffectStdlibCall(callee) ||
          isSchemaMatchCall(callee)
        ) {
          return;
        }

        const method = propertyName(callee);
        const namespace = objectName(callee);
        if (
          (namespace === "String" && stringStaticMethods.has(method)) ||
          stringInstanceMethods.has(method)
        ) {
          report(context, node, "nativeString");
        }
      },
    };
  },
});
