# Effect BDD Oxlint Rules

Local Oxlint rules that keep production code on Effect APIs instead of native
JavaScript control flow and boundary primitives.

The plugin is loaded from `.oxlintrc.json` through `jsPlugins` and exports the
`effect-bdd/*` rule namespace. Rule behavior is covered by
`test/oxlint-rules.test.ts` with Oxlint's `RuleTester`.

Boundary exceptions are explicit rule options. For example, the JSON reporter is
allowed to call `JSON.stringify` because it is the serialization boundary.
