import {
  isIdentifier,
  memberExpression,
  normalizePath,
  objectName,
  propertyName,
} from "../shared/ast.mjs";
import { createRule, report } from "../shared/rule.mjs";

export const noNativeDateUrlJsonBoundariesRuleName = "no-native-date-url-json-boundaries";

const boundaryStaticMethods = new Map([
  ["Date", new Set(["now", "parse", "UTC"])],
  ["URL", new Set(["parse", "canParse"])],
  ["JSON", new Set(["parse", "stringify"])],
]);

export const noNativeDateUrlJsonBoundaries = createRule({
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
    return isAllowedBoundaryFile(context) ? {} : boundaryVisitors(context);
  },
});

const isAllowedBoundaryFile = (context) => {
  const allowedFiles = new Set(allowedFileOptions(context).map(normalizePath));
  return [...allowedFiles].some(endsWithAllowedFile(fileName(context)));
};

const allowedFileOptions = (context) => context.options?.[0]?.allowedFiles ?? [];

const fileName = (context) => normalizePath(context.filename ?? context.getFilename?.() ?? "");

const endsWithAllowedFile = (name) => (allowedFile) => name.endsWith(allowedFile);

const boundaryVisitors = (context) => ({
  CallExpression(node) {
    const callee = memberExpression(node.callee);
    if (callee !== undefined && isBoundaryStaticCall(callee)) {
      report(context, node, "nativeBoundary");
    }
  },
  NewExpression(node) {
    if (isBoundaryConstructor(node.callee)) {
      report(context, node, "nativeBoundary");
    }
  },
});

const isBoundaryStaticCall = (callee) =>
  boundaryStaticMethods.get(objectName(callee))?.has(propertyName(callee)) === true;

const isBoundaryConstructor = (callee) =>
  isIdentifier(callee, "Date") ||
  isIdentifier(callee, "URL") ||
  isIdentifier(callee, "URLSearchParams");
