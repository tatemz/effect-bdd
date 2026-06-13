import { isIdentifier, normalizePath, objectName, propertyName, unchain } from "../shared/ast.mjs";
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
});
