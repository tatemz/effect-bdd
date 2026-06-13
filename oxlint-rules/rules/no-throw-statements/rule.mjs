import { createRule, report } from "../shared/rule.mjs";

export const noThrowStatementsRuleName = "no-throw-statements";

export const noThrowStatements = createRule({
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
});
