import { literalValue, normalizePath, propertyName } from "../shared/ast.mjs";
import { createRule, report } from "../shared/rule.mjs";

export const noTagEqualityDiscriminationRuleName = "no-tag-equality-discrimination";

const tagEqualityOperators = new Set(["===", "!=="]);

export const noTagEqualityDiscrimination = createRule({
  description: "Disallow manual _tag string comparisons for tagged union discrimination.",
  messages: {
    tagEquality:
      "Use Match.tag / Match.value with Match.exhaustive instead of comparing _tag to a string literal.",
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
    return isAllowedFile(context) ? {} : tagEqualityVisitors(context);
  },
});

const tagEqualityVisitors = (context) => ({
  BinaryExpression(node) {
    if (isTagEqualityDiscrimination(node)) {
      report(context, node, "tagEquality");
    }
  },
});

const isTagEqualityDiscrimination = (node) =>
  hasTagEqualityOperator(node.operator) && isTagComparisonPair(node.left, node.right);

const hasTagEqualityOperator = (operator) => tagEqualityOperators.has(operator);

const isTagComparisonPair = (left, right) =>
  isTagToStringComparison(left, right) || isTagToStringComparison(right, left);

const isTagToStringComparison = (tagSide, stringSide) =>
  isTagMember(tagSide) && isStringLiteral(stringSide);

const isTagMember = (node) => propertyName(node) === "_tag";

const isStringLiteral = (node) => typeof literalValue(node) === "string";

const isAllowedFile = (context) => {
  const allowedFiles = new Set(allowedFileOptions(context).map(normalizePath));
  return [...allowedFiles].some(endsWithAllowedFile(fileName(context)));
};

const allowedFileOptions = (context) => context.options?.[0]?.allowedFiles ?? [];

const fileName = (context) => normalizePath(context.filename ?? context.getFilename?.() ?? "");

const endsWithAllowedFile = (name) => (allowedFile) => name.endsWith(allowedFile);
