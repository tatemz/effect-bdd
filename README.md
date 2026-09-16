# effect-bdd

This repository is a pnpm workspace for the effect-bdd package family.

## Packages

- [`effect-bdd`](packages/effect-bdd/) — an Effect-native API for testing Gherkin feature files.
- [`@effect-bdd/hello`](packages/hello/) — a small publishable hello world package used to verify the workspace setup.

The canonical `effect-bdd` package documentation is in [`packages/effect-bdd/README.md`](packages/effect-bdd/README.md).

## Development

Requires Node.js `>=22.12.0` and pnpm `10.16.1`.

```sh
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm format:check
```

The root package is private and only coordinates the workspace. Publishable packages live under `packages/` and can be built or selected with pnpm filters:

```sh
pnpm --filter effect-bdd build
pnpm --filter @effect-bdd/hello build
pnpm publish:packages
```
