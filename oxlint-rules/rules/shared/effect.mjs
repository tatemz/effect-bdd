import { objectName, unchain } from "./ast.mjs";

const effectStdlibNamespaces = new Set([
  "Arr",
  "Effect",
  "Flag",
  "Iterable",
  "Option",
  "Record",
  "Record_",
  "Result",
  "Schema",
  "Str",
  "Stream",
]);

export const isEffectStdlibCall = (callee) => {
  const expression = unchain(callee);
  return (
    expression?.type === "MemberExpression" && effectStdlibNamespaces.has(objectName(expression))
  );
};
