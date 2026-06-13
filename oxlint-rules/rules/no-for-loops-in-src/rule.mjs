import { createRule, report } from "../shared/rule.mjs";

export const noForLoopsInSrcRuleName = "no-for-loops-in-src";

export const noForLoopsInSrc = createRule({
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
});
