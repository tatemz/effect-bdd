import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noSyncSchemaBoundaries, noSyncSchemaBoundariesRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noSyncSchemaBoundariesRuleName, noSyncSchemaBoundaries, {
  valid: [
    "const decode = Schema.decodeUnknownEffect(User)",
    "const encode = Schema.encodeUnknown(User)",
  ],
  invalid: [
    { code: "const decode = Schema.decodeUnknownSync(User)", errors: error("syncSchemaBoundary") },
    { code: "const decode = Schema.decodeSync(User)", errors: error("syncSchemaBoundary") },
    { code: "const encode = Schema.encodeUnknownSync(User)", errors: error("syncSchemaBoundary") },
    { code: "const encode = Schema.encodeSync(User)", errors: error("syncSchemaBoundary") },
  ],
});
