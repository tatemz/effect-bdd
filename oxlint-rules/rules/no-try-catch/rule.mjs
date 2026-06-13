import { createRule, report } from "../shared/rule.mjs";

export const noTryCatchRuleName = "no-try-catch";

export const noTryCatch = createRule({
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
});
