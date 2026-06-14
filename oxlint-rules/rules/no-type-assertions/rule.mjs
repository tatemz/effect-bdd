import { createRule, report } from "../shared/rule.mjs";

export const noTypeAssertionsRuleName = "no-type-assertions";

const isConstAssertion = (node) =>
  node.typeAnnotation?.type === "TSConstKeyword" ||
  (node.typeAnnotation?.type === "TSTypeReference" &&
    node.typeAnnotation.typeName?.type === "Identifier" &&
    node.typeAnnotation.typeName.name === "const");

export const noTypeAssertions = createRule({
  description: "Disallow unsafe TypeScript type assertions.",
  messages: {
    typeAssertion:
      "Do not use type assertions. Model the type honestly with narrowing, annotations, or typed construction.",
  },
  create(context) {
    return {
      TSAsExpression(node) {
        if (!isConstAssertion(node)) {
          report(context, node, "typeAssertion");
        }
      },
      TSTypeAssertion(node) {
        if (!isConstAssertion(node)) {
          report(context, node, "typeAssertion");
        }
      },
    };
  },
});
