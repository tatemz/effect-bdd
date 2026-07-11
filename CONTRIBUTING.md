# Contributing to effect-bdd

Thanks for contributing. Bug reports, focused feature proposals, documentation
improvements, and code changes are welcome.

## Before You Start

- Search existing issues before opening a new one.
- Use the issue forms for bug reports and feature requests.
- Open an issue before investing in a large or compatibility-breaking change.
- Report security vulnerabilities according to [SECURITY.md](SECURITY.md), not
  in a public issue.

## Development Setup

You need:

- Node.js 22.12.0 or newer; CI uses Node.js 24.
- pnpm 10.16.1, managed through Corepack.

Fork the repository, create a branch from `main`, and install dependencies:

```sh
corepack enable
corepack prepare pnpm@10.16.1 --activate
pnpm install --frozen-lockfile
```

Build the package before running examples or benchmarks:

```sh
pnpm build
```

## Making Changes

- Keep changes focused. Separate unrelated cleanup from behavior changes.
- Add or update Vitest tests for runtime behavior.
- Add or update Tstyche tests for public type behavior.
- Update documentation and examples when public behavior changes.
- Run `pnpm format` instead of formatting files manually.
- Preserve typed Effect errors and Effect-returning boundaries in production
  code. See [the custom Oxlint rule guide](oxlint-rules/README.md).
- Treat benchmark results as diagnostic evidence, not marketing claims. See
  [the benchmark guide](benchmarks/README.md).

Useful focused checks are:

```sh
pnpm check
pnpm test
pnpm test:types
pnpm test:examples
pnpm lint
pnpm format:check
```

## Before Opening a Pull Request

Run the same checks as the pull request workflow:

```sh
pnpm build
pnpm --dir benchmarks check
pnpm lint
pnpm format:check
pnpm test
pnpm test:types
pnpm test:examples
pnpm --dir benchmarks run smoke
```

The root `pnpm ci` command also runs the example application, but it does not
replace the benchmark checks above.

In the pull request:

- explain the problem and the chosen solution;
- link the relevant issue;
- describe the tests you ran;
- call out API, behavior, or compatibility changes; and
- keep the branch current with `main`.

Pull requests automatically receive a preview package from `pkg-pr-new` for
consumer testing.
