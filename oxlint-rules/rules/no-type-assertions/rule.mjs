import { createRule, report } from "../shared/rule.mjs";

export const noTypeAssertionsRuleName = "no-type-assertions";

const isConstAssertion = (node) =>
  isConstKeyword(node.typeAnnotation) || isConstTypeReference(node.typeAnnotation);

const isConstKeyword = (annotation) => annotation?.type === "TSConstKeyword";

const isConstTypeReference = (annotation) =>
  annotation?.type === "TSTypeReference" && isConstIdentifier(annotation.typeName);

const isConstIdentifier = (typeName) =>
  typeName?.type === "Identifier" && typeName.name === "const";

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
