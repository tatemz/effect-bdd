import {
  noEffectNamedImportsInSrc,
  noEffectNamedImportsInSrcRuleName,
} from "./rules/no-effect-named-imports-in-src/rule.mjs";
import { noEffectOrDie, noEffectOrDieRuleName } from "./rules/no-effect-or-die/rule.mjs";
import { noForLoopsInSrc, noForLoopsInSrcRuleName } from "./rules/no-for-loops-in-src/rule.mjs";
import {
  noInlineNestedEffectGen,
  noInlineNestedEffectGenRuleName,
} from "./rules/no-inline-nested-effect-gen/rule.mjs";
import {
  noNativeArrayMethodsInSrc,
  noNativeArrayMethodsInSrcRuleName,
} from "./rules/no-native-array-methods-in-src/rule.mjs";
import {
  noNativeDateUrlJsonBoundaries,
  noNativeDateUrlJsonBoundariesRuleName,
} from "./rules/no-native-date-url-json-boundaries/rule.mjs";
import {
  noNativeObjectMethodsInSrc,
  noNativeObjectMethodsInSrcRuleName,
} from "./rules/no-native-object-methods-in-src/rule.mjs";
import {
  noNativeStringMethodsInSrc,
  noNativeStringMethodsInSrcRuleName,
} from "./rules/no-native-string-methods-in-src/rule.mjs";
import { noProcessEnv, noProcessEnvRuleName } from "./rules/no-process-env/rule.mjs";
import { noThrowStatements, noThrowStatementsRuleName } from "./rules/no-throw-statements/rule.mjs";
import { noTryCatch, noTryCatchRuleName } from "./rules/no-try-catch/rule.mjs";

export const rules = {
  [noEffectNamedImportsInSrcRuleName]: noEffectNamedImportsInSrc,
  [noEffectOrDieRuleName]: noEffectOrDie,
  [noForLoopsInSrcRuleName]: noForLoopsInSrc,
  [noInlineNestedEffectGenRuleName]: noInlineNestedEffectGen,
  [noNativeArrayMethodsInSrcRuleName]: noNativeArrayMethodsInSrc,
  [noNativeDateUrlJsonBoundariesRuleName]: noNativeDateUrlJsonBoundaries,
  [noNativeObjectMethodsInSrcRuleName]: noNativeObjectMethodsInSrc,
  [noNativeStringMethodsInSrcRuleName]: noNativeStringMethodsInSrc,
  [noProcessEnvRuleName]: noProcessEnv,
  [noThrowStatementsRuleName]: noThrowStatements,
  [noTryCatchRuleName]: noTryCatch,
};

export default {
  meta: {
    name: "effect-bdd",
  },
  rules,
};
