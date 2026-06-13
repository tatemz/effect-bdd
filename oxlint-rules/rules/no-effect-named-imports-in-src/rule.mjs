import { literalValue } from "../shared/ast.mjs";
import { createRule, report } from "../shared/rule.mjs";

export const noEffectNamedImportsInSrcRuleName = "no-effect-named-imports-in-src";

const effectPackagePattern = /^(?:effect(?:\/[^"']+)?|@effect\/[^"']+)$/;

const isAllowedSpecifier = (importDeclaration, specifier) =>
  specifier.type === "ImportNamespaceSpecifier" ||
  (specifier.type === "ImportSpecifier" &&
    (importDeclaration.importKind === "type" || specifier.importKind === "type"));

export const noEffectNamedImportsInSrc = createRule({
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
        if (node.specifiers.some((specifier) => !isAllowedSpecifier(node, specifier))) {
          report(context, node, "effectImport");
        }
      },
    };
  },
});
