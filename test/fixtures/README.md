These fixtures are executable CLI test fixtures for `effect-bdd`.

Most `.feature` files in this directory are copied from Cucumber Gherkin's
`testdata/good` corpus:

https://github.com/cucumber/gherkin/tree/main/testdata/good

The matching `.step.ts` files are local `effect-bdd` feature definitions that
make those parser fixtures runnable through the `effect-bdd` CLI.

These fixtures test the Gherkin parser and the runner's step pairing, not
behavior design. Most of their scenarios have only a `Given`, or repeat
`Given` lines, because that is the input the parser must handle. Do not copy
them as models of a well-formed scenario; see the "Given, When, Then" section
in the top-level README for that.
