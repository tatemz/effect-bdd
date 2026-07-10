# Benchmarks

This private workspace compares the `effect-bdd` CLI, cucumber-js, and an
in-process `effect-bdd` API baseline. It is diagnostic tooling, not a source of
marketing claims.

## Commands

Run these from the repository root after `pnpm build`:

```sh
# Fast default: one counter-example iteration
pnpm bench

# All suites with one measured iteration
pnpm --dir benchmarks smoke:all

# Full default profile: 3 warmups and 20 measured iterations
pnpm bench:compare
pnpm bench:report

# Checked-in suites using compiled JavaScript step modules
pnpm bench:compiled

# Large generated suites
pnpm bench:pressure
```

`compare` accepts repeatable `--suite <id>` arguments, `--iterations`,
`--warmups`, `--parallel`, `--profile tsx|compiled`, generated-scale flags, and
`--out`.

Generated fixtures live under `benchmarks/generated/`. Each run replaces those
directories so reducing a scale cannot leave stale feature files behind.
Results live under `benchmarks/results/`; both locations are gitignored.

## Reading Results

- **CLI wall time** is the cross-runner user-experience comparison. It includes
  process startup, discovery, loading, execution, and reporting.
- **Runner work** is diagnostic and not like-for-like. `effect-bdd` reports its
  execution phase; cucumber-js reports summed step duration.
- **effect-bdd API** is an in-process lower-bound baseline. It reuses the current
  process and module cache and is therefore shown separately from CLI runners.
- **Compiled profile** transpiles fixture modules with TypeScript `--noCheck`.
  It approximates JavaScript startup behavior; it is not a consumer type-safety
  test. The normal benchmark `check` command strictly typechecks the harness.
- **Stability** is a heuristic based on sample count and wall-time coefficient
  of variation. It is not a statistical confidence interval or proof that one
  runner is faster.
- Phase tables aggregate all measured effect-bdd CLI runs and show median and
  p95 values.

Some checked-in suites intentionally exercise realistic, framework-specific
code. Generated no-op suites are better for isolating framework overhead. Do not
average unlike suites into one headline percentage.

The counter fixture is intentionally implemented separately for effect-bdd and
cucumber-js. When the user-facing counter example changes, update both benchmark
implementations in the same commit and confirm their scenario counts still match.

For a defensible comparison, keep the machine, dependency lockfile, profile,
suite sizes, warmups, iterations, and parallelism fixed. Prefer compiled,
multi-iteration results before making performance decisions.
