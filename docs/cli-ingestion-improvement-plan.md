# CLI Ingestion Improvement Plan

## Purpose

Before writing a custom Gherkin parser, improve the parts of the CLI that happen before and after scenario execution:

1. Module loading
2. Feature discovery
3. Task building
4. Reporting

These are better first targets because the benchmark already shows they are visible costs, and they are under `effect-bdd`'s control. Cucumber pickle parsing may still matter later, but it should not be the first thing we attack.

## Plain-English Model

The CLI does this:

```text
Find feature files
Load step/feature definition modules
Parse feature files into Cucumber pickles
Match pickles to typed effect-bdd scenarios
Run scenarios
Write reports
```

The current data says the expensive parts are mostly around ingestion: getting files and definitions into a runnable shape. Actual scenario execution is not the obvious bottleneck yet.

## Current Hotspots

### 1. Module Loading

Entry points:

- `loadFeatureDefinitions()` in `src/internal/cli/loaders.ts`
- `ModuleLoader.load()` in `src/internal/cli/moduleLoader.ts`

What it does:

Loads user step modules with dynamic `import()`.

Why it matters:

This is a fixed CLI tax. Even a small test suite pays it. The pressure and compiled runs show module loading repeatedly dominates small-suite CLI phase timing.

What to improve:

- Avoid loading modules that cannot be needed for the selected feature set.
- Cache loaded modules during a single CLI invocation.
- Make module loading timing more detailed: resolution time vs dynamic import time vs definition extraction time.
- Consider a future manifest mode where compiled projects can provide known step module paths without globbing.

What not to do yet:

Do not invent a complex plugin system. First make the existing path cheaper and better measured.

## 2. Feature Discovery

Entry points:

- `loadFeatureSources()` in `src/internal/cli/loaders.ts`
- `GlobResolver.resolve()` in `src/internal/cli/glob.ts`

What it does:

Expands feature glob patterns and reads `.feature` files.

Why it matters:

Many small feature files make discovery cost visible. The discovery-scale suite exists specifically to pressure this path.

What to improve:

- Keep optimizing non-`**` glob traversal so the resolver walks only required directories.
- Add tests for common patterns:
  - exact file path
  - `features/*.feature`
  - `features/**/*.feature`
  - multiple overlapping globs
- Deduplicate resolved paths before reading files.
- Preserve deterministic ordering so benchmark output and reports are stable.
- Add optional debug output for discovery counts:
  - patterns received
  - paths matched
  - duplicate paths removed
  - total file-read time

What not to do yet:

Do not replace globbing with a dependency unless the local resolver becomes a maintenance burden.

## 3. Task Building

Entry points:

- `buildScenarioTasks()` in `src/internal/cli/runner.ts`
- `featureDefinitionIndex()` in `src/internal/cli/runner.ts`
- `duplicateSourceScenarioTitle()` in `src/internal/cli/runner.ts`
- `firstDuplicateSourceScenarioTitle()` in `src/internal/runner.ts`

What it does:

Matches parsed Gherkin scenarios to typed `Bdd.scenario(...)` definitions and creates runnable tasks.

Why it matters:

When a feature has many scenarios, task building becomes visible. This is not parsing and not execution. It is the glue layer where `effect-bdd` proves the source file and typed scenario definitions agree.

What to improve:

- Keep feature definitions indexed by title.
- Add a scenario-definition index per feature title.
- Avoid recomputing source scenario lookups when building tasks.
- Make duplicate detection set-based everywhere.
- Track task-build timing by subphase:
  - feature definition lookup
  - scenario definition indexing
  - source scenario lookup
  - duplicate detection
  - task creation
- Add scale tests for:
  - one feature with many scenarios
  - many features with few scenarios
  - many scenario outlines with many examples

What not to do yet:

Do not weaken validation to gain speed. The matching and diagnostics are part of the product value.

## 4. Reporting

Entry points:

- `Reporter.emitAll()` in `src/main.ts`
- reporter implementation in `src/internal/cli/reporter.ts`

What it does:

Writes text, JSON, HTML, or JUnit output after the runner finishes.

Why it matters:

Reporting is currently mostly outside phase timing. That means we can see total wall time but not cleanly separate runner time from report emission time.

What to improve:

- Add report emission timing to CLI phase data.
- Measure each reporter separately.
- Keep JSON report generation allocation-conscious for large suites.
- Avoid building large intermediate strings multiple times.
- Add reporter-overhead benchmarks with thousands of scenarios.

What not to do yet:

Do not optimize report formatting blindly. First expose its cost.

## Recommended Order

### Phase 1: Make Timing More Honest

Add timing around report emission.

Current phase timing covers:

- feature discovery
- step module load
- task build
- filtering
- execution

Add:

- reporter emission total
- per-reporter emission time

Acceptance criteria:

- JSON report includes reporter timings.
- Markdown/HTML benchmark report displays reporter timing when present.
- Existing tests still pass.

## Phase 2: Improve Feature Discovery

Tighten glob/path behavior.

Work items:

- Deduplicate resolved feature paths.
- Add focused tests for glob resolver behavior.
- Confirm deterministic output ordering.
- Benchmark `discovery-scale` before and after.

Acceptance criteria:

- Same feature set is found as before.
- Duplicate glob matches do not cause duplicate reads.
- Discovery phase is stable or lower on generated discovery suites.

## Phase 3: Improve Task Building

Reduce repeated lookup work while keeping diagnostics strict.

Work items:

- Build scenario definition maps once per matched feature definition.
- Avoid repeated `Parser.findScenario(...)` work when checking duplicates and creating tasks.
- Add task-build subphase timing.
- Add tests for duplicate source scenarios and duplicate scenario definitions.

Acceptance criteria:

- CLI and API still agree on duplicate-source behavior.
- Task-build time improves or stays flat on outline/parallel scale suites.
- Diagnostics remain as useful as before.

## Phase 4: Investigate Module Loading

This is likely the hardest part because dynamic import cost is mostly Node/runtime behavior.

Work items:

- Split timing into path resolution, dynamic import, and definition extraction.
- Confirm whether large step modules or many small modules are worse.
- Compare `tsx` vs compiled profiles.
- Consider an optional manifest later if glob/import cost remains high.

Acceptance criteria:

- We know whether module load cost is caused by module count, module size, or loader mode.
- Compiled profile is the default source of performance claims.
- No new API complexity unless the data justifies it.

## Phase 5: Reporting Performance

Only after reporter timing exists, optimize report generation.

Work items:

- Benchmark JSON reporter with thousands of scenarios.
- Check whether HTML/JUnit build large strings inefficiently.
- Consider streaming or chunked output only if string building becomes a real bottleneck.

Acceptance criteria:

- Reporter overhead is visible in benchmark reports.
- Large generated suites can emit reports without memory surprises.

## Non-Goals

Do not do these first:

- Write a custom Gherkin parser.
- Replace Cucumber pickle parsing.
- Micro-optimize Effect scenario execution.
- Weaken validation to make benchmarks faster.
- Make broad public claims like "faster than Cucumber."

## Benchmark Strategy

Use three benchmark modes:

### Smoke

Fast local validation.

```sh
pnpm bench:smoke
```

Use for:

- checking the harness still works
- quick local feedback

Do not use for:

- performance claims

### Compiled Publication Profile

More credible checked-in suite comparison.

```sh
pnpm bench:compiled
```

Use for:

- comparing CLI wall time without `tsx`
- PR descriptions
- README candidates, if confidence is acceptable

### Pressure

Large generated data sets.

```sh
pnpm bench:pressure
```

Use for:

- finding scaling problems
- stress-testing discovery, task building, and reporting

Do not use for:

- clean product claims

Generated pressure suites are synthetic. They are good for breaking things, not proving real-world performance.

## Success Criteria

This effort is successful when:

- CLI phase timing explains most wall-time differences.
- Discovery is deterministic and avoids wasted file work.
- Task building scales predictably with scenario count.
- Reporter overhead is measured directly.
- The README can make a careful claim without lying.

Good wording:

> In our compiled CLI benchmark, `effect-bdd` showed lower median wall time than cucumber-js on the checked-in suites.

Bad wording:

> `effect-bdd` is faster than Cucumber.

## Bottom Line

Improve ingestion before parser replacement.

The boring path is the right path:

1. Measure report emission.
2. Tighten glob discovery.
3. Reduce task-building lookup work.
4. Understand module loading.
5. Only then revisit parser ownership.

A custom parser might be worth discussing later, but today it would be a distraction. The current evidence points at CLI ingestion, not Gherkin parsing, as the better first investment.
