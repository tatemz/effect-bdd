# Effect BDD Oxlint Rules

Local Oxlint rules that keep production code on Effect APIs instead of native
JavaScript control flow and boundary primitives.

The plugin is loaded from `.oxlintrc.json` through `jsPlugins` and exports the
`effect-bdd/*` rule namespace.

Layout:

- `effect-bdd.mjs` composes the plugin export.
- `rules/<rule-name>/rule.mjs` contains one rule implementation.
- `rules/<rule-name>/rule.test.mjs` contains that rule's `RuleTester` cases.
- `rules/shared/` contains AST helpers and test support.

Boundary exceptions are explicit rule options. For example, the JSON reporter is
allowed to call `JSON.stringify` because it is the serialization boundary.

The rules bias toward typed Effect boundaries:

- Promise boundaries use `Effect.tryPromise({ try, catch })`.
- Schema boundaries use Effect-returning codecs.
- Source modules return Effects instead of running them.
- Expected failures stay typed instead of becoming defects.
