import { isMemberCall } from "../shared/ast.mjs";
import { createRule, report } from "../shared/rule.mjs";

export const noSyncSchemaBoundariesRuleName = "no-sync-schema-boundaries";

const syncSchemaBoundaryMethods = new Set([
  "decodeSync",
  "decodeUnknownSync",
  "encodeSync",
  "encodeUnknownSync",
]);

export const noSyncSchemaBoundaries = createRule({
  description: "Disallow synchronous Schema boundary codecs that throw defects.",
  messages: {
    syncSchemaBoundary:
      "Synchronous Schema decoding throws defects at the boundary. Use Effect-returning Schema codecs so failures land in the Effect error channel.",
  },
  create(context) {
    return {
      CallExpression(node) {
        for (const method of syncSchemaBoundaryMethods) {
          if (isMemberCall(node, "Schema", method)) {
            report(context, node, "syncSchemaBoundary");
            return;
          }
        }
      },
    };
  },
});
