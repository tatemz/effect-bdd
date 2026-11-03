# Effect BDD Oxlint Rules

Local Oxlint rules that keep production code on Effect APIs instead of native
JavaScript control flow and boundary primitives.

These rules run alongside the Effect Language Service diagnostics from
[`@effect/tsgo`](https://github.com/Effect-TS/tsgo). That package reports the
generic Effect mistakes, so this plugin only keeps the rules that encode
**this package's own conventions** — the ones `@effect/tsgo` does not express.

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

## Why a rule lives here instead of `@effect/tsgo`

A rule belongs in this plugin only when the Effect diagnostic set cannot cover
it. The rules deleted during the `@effect/tsgo` integration had a direct
equivalent that now runs with the same severity:

| Deleted rule                | Replaced by                                                     |
| --------------------------- | --------------------------------------------------------------- |
| `no-process-env`            | `effecttsgo/process-env`, `effecttsgo/process-env-in-effect`    |
| `no-sync-schema-boundaries` | `effecttsgo/schema-sync`, `effecttsgo/schema-sync-in-effect`    |
| `no-untyped-try-promise`    | `effecttsgo/effect-try-without-catch`                           |
| `no-effect-or-die`          | `effecttsgo/catch-die-to-or-die`, `effecttsgo/redundant-or-die` |

`no-effect-or-die` was the one true contradiction: the Effect diagnostics tell
you to reach for `Effect.orDie`, and the local rule banned it. The others
duplicated the same suggestion on the same line.

`no-async-await-in-src` stays. `effecttsgo/async-function` covers async
declarations and `effecttsgo/new-promise` covers Promise construction, but
neither reports a bare top-level `await`, which the local rule does.

The rules that remain have no counterpart: `no-any-annotation`,
`no-type-assertions`, `no-try-catch`, `no-throw-statements`,
`no-for-loops-in-src`, `no-native-map-in-src`, `no-native-set-in-src`,
`no-schema-optional`, `no-tag-equality-discrimination`,
`no-inline-nested-effect-gen`, `no-effect-runners-in-src`,
`no-untraced-effect-fn-in-public`, and the `no-native-*-methods` family.
`effecttsgo/try-catch-in-effect-gen` and `effecttsgo/run-effect-inside-effect`
only cover the inside-a-generator case, while the local rules also cover the
same mistake outside one.

## Running the linter

`@effect/tsgo` patches the Oxlint binary to load the `effecttsgo` plugin. The
`lint:oxlint` script goes through `effect-tsgo oxlint`, which ships the patched
binary itself, so `node_modules` never has to be rewritten and CI needs no
`prepare` step:

```sh
pnpm lint:oxlint
```
