const effectBddNamespace = "effect-bdd";

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

const objectStaticMethods = new Set([
  "assign",
  "entries",
  "fromEntries",
  "hasOwn",
  "keys",
  "values",
]);

const boundaryStaticMethods = new Map([
  ["Date", new Set(["now", "parse", "UTC"])],
  ["URL", new Set(["parse", "canParse"])],
  ["JSON", new Set(["parse", "stringify"])],
]);

const createRule = ({ description, messages, schema = [], create }) => ({
  meta: {
    type: "problem",
    docs: { description },
    messages,
    schema,
  },
  create,
});

const report = (context, node, messageId) => {
  context.report({ node, messageId });
};

const unchain = (node) => (node?.type === "ChainExpression" ? node.expression : node);

const isIdentifier = (node, name) =>
  unchain(node)?.type === "Identifier" && unchain(node).name === name;

const literalValue = (node) => (node?.type === "Literal" ? node.value : undefined);

const propertyName = (member) => {
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

const objectName = (member) => {
  const node = unchain(member);
  return node?.type === "MemberExpression" && node.object?.type === "Identifier"
    ? node.object.name
    : undefined;
};

const isMemberCall = (node, namespace, method) => {
  const call = unchain(node);
  return (
    call?.type === "CallExpression" &&
    unchain(call.callee)?.type === "MemberExpression" &&
    objectName(call.callee) === namespace &&
    propertyName(call.callee) === method
  );
};

const isEffectGenCall = (node) => isMemberCall(node, "Effect", "gen");

const isEffectOrDieReference = (node) => {
  const expression = unchain(node);
  return (
    expression?.type === "MemberExpression" &&
    objectName(expression) === "Effect" &&
    propertyName(expression) === "orDie"
  );
};

const isEffectStdlibCall = (callee) => {
  const expression = unchain(callee);
  return (
    expression?.type === "MemberExpression" && effectStdlibNamespaces.has(objectName(expression))
  );
};

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

const isCallbackReturningEffectGen = (node) =>
  (node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression") &&
  isEffectGenCall(node.body);

const effectPackagePattern = /^(?:effect|@effect\/[a-z-]+)$/;

const normalizePath = (path) => path.replaceAll("\\", "/");

export const rules = {
  "no-inline-nested-effect-gen": createRule({
    description: "Disallow nested inline Effect.gen calls inside other effect flows.",
    messages: {
      nestedGen:
        "Use Effect.gen as the direct body of an Effect-producing function; do not nest inline generators inside another effect flow.",
    },
    create(context) {
      return {
        ConditionalExpression(node) {
          if (isEffectGenCall(node.consequent)) {
            report(context, node.consequent, "nestedGen");
          }
          if (isEffectGenCall(node.alternate)) {
            report(context, node.alternate, "nestedGen");
          }
        },
        YieldExpression(node) {
          if (node.delegate && isEffectGenCall(node.argument)) {
            report(context, node, "nestedGen");
          }
        },
        CallExpression(node) {
          if (
            isMemberCall(node, "Effect", "flatMap") &&
            node.arguments.some(isCallbackReturningEffectGen)
          ) {
            report(context, node, "nestedGen");
          }
        },
      };
    },
  }),

  "no-process-env": createRule({
    description: "Disallow direct process.env reads.",
    messages: {
      directEnv: "Use Effect Config/ConfigProvider instead of reading runtime env directly.",
    },
    create(context) {
      return {
        MemberExpression(node) {
          if (isIdentifier(node.object, "process") && propertyName(node) === "env") {
            report(context, node, "directEnv");
          }
        },
      };
    },
  }),

  "no-effect-or-die": createRule({
    description: "Disallow converting typed failures into defects with Effect.orDie.",
    messages: {
      orDie:
        "Keep failures typed; do not convert recoverable errors into defects with Effect.orDie.",
    },
    create(context) {
      return {
        CallExpression(node) {
          if (isMemberCall(node, "Effect", "orDie")) {
            report(context, node, "orDie");
            return;
          }
          if (propertyName(node.callee) === "pipe" && node.arguments.some(isEffectOrDieReference)) {
            report(context, node, "orDie");
          }
        },
      };
    },
  }),

  "no-for-loops-in-src": createRule({
    description: "Disallow imperative for loops in source files.",
    messages: {
      forLoop:
        "Use Effect.forEach, Arr.*, Record.*, or Iterable.* from the Effect standard library instead of for loops.",
    },
    create(context) {
      const check = (node) => report(context, node, "forLoop");
      return {
        ForStatement: check,
        ForInStatement: check,
        ForOfStatement: check,
      };
    },
  }),

  "no-native-array-methods-in-src": createRule({
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
  }),

  "no-native-string-methods-in-src": createRule({
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
  }),

  "no-native-object-methods-in-src": createRule({
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
  }),

  "no-effect-named-imports-in-src": createRule({
    description: "Require namespace imports for Effect packages.",
    messages: {
      effectImport:
        'Import Effect modules through namespace imports, for example: import * as Effect from "effect/Effect".',
    },
    create(context) {
      return {
        ImportDeclaration(node) {
          const source = literalValue(node.source);
          if (typeof source !== "string" || !effectPackagePattern.test(source)) {
            return;
          }
          if (node.specifiers.some((specifier) => specifier.type !== "ImportNamespaceSpecifier")) {
            report(context, node, "effectImport");
          }
        },
      };
    },
  }),

  "no-throw-statements": createRule({
    description: "Disallow throw statements in source files.",
    messages: {
      throwStatement: "Production code must not throw. Fail the Effect with a typed error instead.",
    },
    create(context) {
      return {
        ThrowStatement(node) {
          report(context, node, "throwStatement");
        },
      };
    },
  }),

  "no-try-catch": createRule({
    description: "Disallow try/catch in source files.",
    messages: {
      tryCatch: "Use Effect.try, Effect.tryPromise, or Effect error handling instead of try/catch.",
    },
    create(context) {
      return {
        TryStatement(node) {
          report(context, node, "tryCatch");
        },
      };
    },
  }),

  "no-native-date-url-json-boundaries": createRule({
    description:
      "Disallow native Date, URL, URLSearchParams, and JSON boundary APIs in source files.",
    messages: {
      nativeBoundary:
        "Use effect/Clock or effect/DateTime for time, Effect platform services for URLs, and effect/Schema codecs for JSON at serialization boundaries.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allowedFiles: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
    ],
    create(context) {
      const allowedFiles = new Set((context.options?.[0]?.allowedFiles ?? []).map(normalizePath));
      const fileName = normalizePath(context.filename ?? context.getFilename?.() ?? "");
      const isAllowedFile = [...allowedFiles].some((allowedFile) => fileName.endsWith(allowedFile));

      if (isAllowedFile) {
        return {};
      }

      return {
        CallExpression(node) {
          const callee = unchain(node.callee);
          if (
            callee?.type === "MemberExpression" &&
            boundaryStaticMethods.get(objectName(callee))?.has(propertyName(callee))
          ) {
            report(context, node, "nativeBoundary");
          }
        },
        NewExpression(node) {
          if (
            isIdentifier(node.callee, "Date") ||
            isIdentifier(node.callee, "URL") ||
            isIdentifier(node.callee, "URLSearchParams")
          ) {
            report(context, node, "nativeBoundary");
          }
        },
      };
    },
  }),
};

export default {
  meta: {
    name: effectBddNamespace,
  },
  rules,
};
