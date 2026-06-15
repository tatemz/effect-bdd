import { normalizePath } from "../shared/ast.mjs";
import { createRule, report } from "../shared/rule.mjs";

export const noAnyAnnotationRuleName = "no-any-annotation";

export const noAnyAnnotation = createRule({
  description: "Disallow TypeScript any annotations.",
  messages: {
    anyAnnotation: "Model the type honestly with concrete types or generics; do not annotate any.",
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
    return isAllowedFile(context) ? {} : anyVisitors(context);
  },
});

const anyVisitors = (context) => ({
  TSAnyKeyword(node) {
    report(context, node, "anyAnnotation");
  },
});

const isAllowedFile = (context) => {
  const allowedFiles = new Set(allowedFileOptions(context).map(normalizePath));
  return [...allowedFiles].some(endsWithAllowedFile(fileName(context)));
};

const allowedFileOptions = (context) => context.options?.[0]?.allowedFiles ?? [];

const fileName = (context) => normalizePath(context.filename ?? context.getFilename?.() ?? "");

const endsWithAllowedFile = (name) => (allowedFile) => name.endsWith(allowedFile);
