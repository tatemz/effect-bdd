import { RuleTester } from "oxlint/plugins-dev";

export const bindRuleTesterToVitest = ({ describe, it }) => {
  RuleTester.describe = describe;
  RuleTester.it = it;
};

export const createRuleTester = () =>
  new RuleTester({
    languageOptions: {
      sourceType: "module",
      parserOptions: {
        lang: "ts",
      },
    },
  });

export const error = (messageId) => [{ messageId }];
