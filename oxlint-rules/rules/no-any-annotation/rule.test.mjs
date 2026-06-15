import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noAnyAnnotation, noAnyAnnotationRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noAnyAnnotationRuleName, noAnyAnnotation, {
  valid: [
    "type Value = unknown",
    "const identity = <A>(value: A): A => value",
    {
      code: "type Legacy = any",
      filename: "src/internal/legacy.ts",
      options: [{ allowedFiles: ["src/internal/legacy.ts"] }],
    },
  ],
  invalid: [
    { code: "type Value = any", errors: error("anyAnnotation") },
    { code: "const values: Array<any> = []", errors: error("anyAnnotation") },
    { code: "const handle = (value: any) => value", errors: error("anyAnnotation") },
  ],
});
