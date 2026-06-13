import { describe, it } from "vitest";
import { bindRuleTesterToVitest, createRuleTester, error } from "../shared/test-support.mjs";
import { noNativeStringMethodsInSrc, noNativeStringMethodsInSrcRuleName } from "./rule.mjs";

bindRuleTesterToVitest({ describe, it });

createRuleTester().run(noNativeStringMethodsInSrcRuleName, noNativeStringMethodsInSrc, {
  valid: [
    "const shout = Str.toUpperCase(text)",
    'const segments = Str.split(path, "/")',
    "const decoded = definition.expression.match(value)",
  ],
  invalid: [
    { code: "const shout = text.toUpperCase()", errors: error("nativeString") },
    { code: 'const segments = path.split("/")', errors: error("nativeString") },
    { code: "const text = String.fromCharCode(65)", errors: error("nativeString") },
  ],
});
