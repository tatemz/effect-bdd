# Biome Grit Plugin Rules

Custom Biome rules that keep `effect-bdd` on the Effect v4 standard library
instead of native JavaScript primitives.

## Wiring

Every rule is registered in the root `biome.json`, either in the global
`plugins` array or in a path-scoped `overrides` entry. Rules run with
`biome lint .` (`pnpm lint:biome`).

Rules suffixed `-in-src` apply only to `src/**`. Interop boundaries are
encoded in rule scope (for example `src/internal/cli/reporter.ts` is excluded
from the Date/URL/JSON rule because the JSON reporter is the serialization
boundary), never with inline suppression comments.

## Fixtures

Every rule keeps a fixture pair in `fixtures/<rule-name>/`:

- `fires.ts` must trigger at least one diagnostic.
- `clean.ts` must trigger none.

`pnpm lint:grit-fixtures` lints each pair against its rule in an isolated temp
directory. Fixtures are excluded from the main Biome run, so they may freely
violate every other policy. A rule whose `fires` fixture stops firing is dead:
fix the rule, never the assertion.

## Authoring notes (Biome Grit engine traps)

- Regex conditions are full-match, not search: write `r"(?s)foo.*"`.
- Snippets normalize declaration keywords (`const` also matches `let`/`var`).
- `or { Node1(), Node2() }` fails in `<:` condition position; hoist
  alternatives to a top-level `or`.
- An unbound metavariable in `register_diagnostic(message=...)` drops the
  diagnostic silently.
