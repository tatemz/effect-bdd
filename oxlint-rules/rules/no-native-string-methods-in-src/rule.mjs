import { memberExpression, objectName, propertyName } from "../shared/ast.mjs";
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
  const expression = memberExpression(callee);
  const object = memberExpression(expression?.object);
  return propertyName(expression) === "match" && propertyName(object) === "expression";
};

export const noNativeStringMethodsInSrc = createRule({
  description: "Disallow native String helpers in source files.",
  messages: {
    nativeString: "Use effect/String instead of native String methods.",
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = memberExpression(node.callee);
        if (callee !== undefined && isNativeStringMethodCall(callee)) {
          report(context, node, "nativeString");
        }
      },
    };
  },
});

const isNativeStringMethodCall = (callee) =>
  !isEffectStdlibCall(callee) && !isSchemaMatchCall(callee) && isStringMethodCall(callee);

const isStringMethodCall = (callee) =>
  isStringStaticMethod(callee) || stringInstanceMethods.has(propertyName(callee));

const isStringStaticMethod = (callee) =>
  objectName(callee) === "String" && stringStaticMethods.has(propertyName(callee));
