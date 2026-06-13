import { isMemberCall } from "../shared/ast.mjs";
import { createRule, report } from "../shared/rule.mjs";

export const noEffectRunnersInSrcRuleName = "no-effect-runners-in-src";

const runnerMethods = new Set([
  "runCallback",
  "runFork",
  "runPromise",
  "runPromiseExit",
  "runSync",
  "runSyncExit",
]);

export const noEffectRunnersInSrc = createRule({
  description: "Disallow Effect runtime runners in source files.",
  messages: {
    effectRunner:
      "Keep Effect runners at explicit runtime boundaries. Compose and return Effects from source modules.",
  },
  create(context) {
    return {
      CallExpression(node) {
        for (const method of runnerMethods) {
          if (isMemberCall(node, "Effect", method)) {
            report(context, node, "effectRunner");
            return;
          }
        }
      },
    };
  },
});
