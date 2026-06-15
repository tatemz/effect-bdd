export const unchain = (node) => (node?.type === "ChainExpression" ? node.expression : node);

export const isIdentifier = (node, name) =>
  unchain(node)?.type === "Identifier" && unchain(node).name === name;

export const literalValue = (node) => (node?.type === "Literal" ? node.value : undefined);

export const memberExpression = (node) => {
  const expression = unchain(node);
  return expression?.type === "MemberExpression" ? expression : undefined;
};

export const propertyName = (member) => {
  const node = memberExpression(member);
  if (node === undefined) {
    return undefined;
  }
  return node.computed
    ? computedPropertyName(node.property)
    : identifierPropertyName(node.property);
};

const identifierPropertyName = (property) =>
  property?.type === "Identifier" ? property.name : undefined;

const computedPropertyName = (property) => {
  const value = literalValue(property);
  return typeof value === "string" ? value : undefined;
};

export const objectName = (member) => {
  const node = memberExpression(member);
  return identifierPropertyName(node?.object);
};

export const isMemberCall = (node, namespace, method) => {
  const call = callExpression(node);
  return call === undefined ? false : memberCallMatches(call, namespace, method);
};

const callExpression = (node) => {
  const call = unchain(node);
  return call?.type === "CallExpression" ? call : undefined;
};

const memberCallMatches = (call, namespace, method) =>
  objectName(call.callee) === namespace && propertyName(call.callee) === method;

export const normalizePath = (path) => path.replaceAll("\\", "/");
