export const unchain = (node) => (node?.type === "ChainExpression" ? node.expression : node);

export const isIdentifier = (node, name) =>
  unchain(node)?.type === "Identifier" && unchain(node).name === name;

export const literalValue = (node) => (node?.type === "Literal" ? node.value : undefined);

export const propertyName = (member) => {
  const node = unchain(member);
  if (!node || node.type !== "MemberExpression") {
    return undefined;
  }
  if (!node.computed && node.property?.type === "Identifier") {
    return node.property.name;
  }
  const value = literalValue(node.property);
  return typeof value === "string" ? value : undefined;
};

export const objectName = (member) => {
  const node = unchain(member);
  return node?.type === "MemberExpression" && node.object?.type === "Identifier"
    ? node.object.name
    : undefined;
};

export const isMemberCall = (node, namespace, method) => {
  const call = unchain(node);
  return (
    call?.type === "CallExpression" &&
    unchain(call.callee)?.type === "MemberExpression" &&
    objectName(call.callee) === namespace &&
    propertyName(call.callee) === method
  );
};

export const normalizePath = (path) => path.replaceAll("\\", "/");
