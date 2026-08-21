# effect-bdd

An Effect-native BDD runner for Gherkin feature files.

Use `effect-bdd` when you want plain-language `.feature` files, but you do not want
Cucumber's mutable `World` model. Your TypeScript declares explicit, typed scenario
chains. The runner verifies each compiled Gherkin scenario against those chains before
running the steps.

## Contents

- [Install](#install)
- [Upgrading to 0.7.0](#upgrading-to-070)
- [Upgrading to 0.6.0](#upgrading-to-060)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [CLI Workflows](#cli-workflows)
- [Writing Step Modules](#writing-step-modules)
- [Step Patterns](#step-patterns)
- [Reference](#reference)
- [Development Benchmarks](#development-benchmarks)
- [Non-Goals](#non-goals)

## Install

`effect-bdd` requires Node `>=22.12.0` and currently tracks the Effect v4 release
candidate train. Use matching `4.0.0-rc.x` versions of `effect` and Effect platform packages.

```sh
pnpm add effect-bdd effect@4.0.0-rc.111
pnpm add -D tsx
```

## Upgrading to 0.7.0

Version 0.7.0 tracks Effect `4.0.0-rc.111`. Install matching `4.0.0-rc.x`
versions of `effect` and Effect platform packages. Effect `4.0.0-beta.x` no
longer satisfies the peer range.

## Upgrading to 0.6.0

Version 0.6.0 tightens runtime boundaries before the public API stabilizes:

- Every step implementation receives the current scenario state as its final
  argument. This no longer depends on `Function.length`, so default and rest
  parameters behave consistently. Existing handlers that ignore state continue
  to ignore the extra JavaScript argument.
- Passing a non-function step implementation now throws a `TypeError` when the
  step is defined instead of producing a failing Effect when the scenario runs.
- `Bdd.isFeature`, `Bdd.isScenario`, and `Bdd.isStep` are strict structural
  guards backed by symbol brands. Spreading a model into a plain object does not
  preserve its identity.

## Quick Start

Start with a feature:

```gherkin
Feature: Counter

  Scenario: Creating a counter
    Given no counter exists
    When the counter is created
    Then the counter value is 0
```

Then declare the scenario chain in TypeScript:

```ts
import { Bdd } from "effect-bdd";
import { Effect, Schema } from "effect";

const expected = Bdd.capture("expected", Schema.FiniteFromString);

const givenNoCounter = Bdd.given`no counter exists`(() => Effect.void);
const whenCounterIsCreated = Bdd.when`the counter is created`(() => Effect.succeed(0));
const thenCounterValueIs = Bdd.then`the counter value is ${expected}`(
  ({ expected }: { readonly expected: number }, state: number) =>
    state === expected
      ? Effect.succeed(state)
      : Effect.fail(`expected ${expected}, got ${state}` as const),
);

const creatingACounter = Bdd.scenario("Creating a counter").pipe(
  givenNoCounter,
  whenCounterIsCreated,
  thenCounterValueIs,
);

const counter = Bdd.feature("Counter").pipe(creatingACounter);

const program = Bdd.run(
  counter,
  `
Feature: Counter

  Scenario: Creating a counter
    Given no counter exists
    When the counter is created
    Then the counter value is 0
`,
).pipe(Effect.provide(Bdd.layerCucumber));
```

Most projects run feature files through the CLI:

```sh
NODE_OPTIONS="--import tsx" pnpm exec effect-bdd \
  --features "features/**/*.feature" \
  --steps "features/**/*.steps.ts"
```

There is a fuller counter example in [`examples/`](examples/):

```sh
pnpm --dir examples install
pnpm --dir examples test
```

## How It Works

A feature is made from explicit scenario chains:

- `Bdd.feature(title)` creates a feature definition.
- `Bdd.scenario(title)` creates a pipeable scenario chain.
- `Bdd.given`, `Bdd.when`, `Bdd.then`, and `Bdd.step` create reusable step values.
- Steps pipe into scenarios; scenarios pipe into features.
- Each step returns an `Effect` containing the next state.

The runner parses each `.feature` file with Cucumber's Gherkin compiler, pairs each
source scenario with the `Bdd.scenario(...)` chain of the same title, verifies the steps
position by position, then runs the chain.

That strict pairing is the point. If the feature says one thing and the TypeScript chain
says another, the run fails before the test can lie to you.

## CLI Workflows

### Local Full Suite

Run all feature files against all step modules:

```sh
NODE_OPTIONS="--import tsx" pnpm exec effect-bdd \
  --features "features/**/*.feature" \
  --steps "features/**/*.steps.ts"
```

Quote globs so `effect-bdd` receives the pattern instead of your shell expanding it.

### Focused Runs

During local development, run one feature or a filtered set of scenarios:

```sh
NODE_OPTIONS="--import tsx" pnpm exec effect-bdd \
  --features "features/counter.feature" \
  --steps "features/**/*.steps.ts" \
  --title "Creating a counter"
```

Focused runs often load shared step modules that contain other features' scenario chains.
Those unrelated chains may appear under `Unused definitions:` because their `.feature`
files were not selected. That is expected and non-fatal by default.

Do not add `--strict` to this workflow unless the selected feature files and loaded step
modules are meant to be complete.

### CI

Use broad globs and `--strict` in CI so unused feature or scenario definitions fail the
build:

```sh
NODE_OPTIONS="--import tsx" pnpm exec effect-bdd \
  --features "features/**/*.feature" \
  --steps "features/**/*.steps.ts" \
  --reporter text \
  --strict
```

If a hung promise, socket, browser, or polling loop should fail quickly, add a run-level
step timeout:

```sh
NODE_OPTIONS="--import tsx" pnpm exec effect-bdd \
  --features "features/**/*.feature" \
  --steps "features/**/*.steps.ts" \
  --reporter text \
  --strict \
  --step-timeout "5 seconds"
```

Bun can load `.ts` step modules directly:

```sh
bunx --bun effect-bdd --features "features/**/*.feature" --steps "features/**/*.steps.ts"
```

## Writing Step Modules

Keep step modules boring:

```text
imports
schemas and captures
domain types
pure helpers
reusable given/when/then step values
scenario chains
one exported Bdd.feature(...)
```

One Gherkin `Feature:` should map to one exported `Bdd.feature("Feature name")`. Reusable
steps can live anywhere, but compose them into a single feature export per feature name.
When the CLI loads shared step modules, every exported `Bdd.feature(...)` is considered
during discovery.

Scenario state flows through the chain. There is no feature-level `initial` state; the
first step sets up the first useful state.

## Step Patterns

### Captures

Captures are named values inside a tagged-template step expression. The source text is a
string; the capture's `Schema` decodes it before the step implementation runs.

```ts
import { Bdd } from "effect-bdd";
import { Effect, Schema } from "effect";

const expected = Bdd.capture("expected", Schema.FiniteFromString);

const thenTotalIs = Bdd.then`the cart total is ${expected}`(
  ({ expected }: { readonly expected: number }, state: { readonly total: number }) =>
    state.total === expected
      ? Effect.succeed(state)
      : Effect.fail(`expected ${expected}, got ${state.total}` as const),
);
```

Prefer strict schemas. `Schema.FiniteFromString` rejects `"abc"`, `""`, and `"Infinity"`
as `MatchError`s.

### DataTables and DocStrings

Use `Bdd.table(schema)` for Gherkin DataTables. The first row is headers; each later row
is decoded by the row schema.

```ts
import { Bdd } from "effect-bdd";
import { Effect, Schema } from "effect";

const Item = Schema.Struct({
  sku: Schema.String,
  qty: Schema.FiniteFromString,
});

const whenItemsAreAdded = Bdd.when`the following items are added:`(
  Bdd.table(Item),
  (items: ReadonlyArray<typeof Item.Type>, state: ReadonlyArray<typeof Item.Type>) =>
    Effect.succeed([...state, ...items]),
);
```

Use `Bdd.docString(schema)` for larger step arguments, including JSON payloads.

```ts
import { Bdd } from "effect-bdd";
import { Effect, Option, Schema } from "effect";

const Payload = Schema.Struct({
  sku: Schema.String,
  qty: Schema.Number,
});

const whenRequestBodyIs = Bdd.when`the request body is:`(
  Bdd.docString(Schema.fromJsonString(Payload)),
  (payload: typeof Payload.Type) => Effect.succeed(Option.some(payload)),
);
```

Schema decode failures for captures, DataTables, and DocStrings are preserved on
`MatchError.cause`.

### Services

Step implementations return normal `Effect` values, so they can require services in `R`
and fail with typed errors in `E`.

```ts
import { Bdd } from "effect-bdd";
import { Context, Effect, Schema } from "effect";

class TaxRate extends Context.Service<
  TaxRate,
  {
    readonly rate: number;
  }
>()("TaxRate") {}

const expected = Bdd.capture("expected", Schema.FiniteFromString);

const thenTaxedTotalIs = Bdd.then`the taxed total is ${expected}`(
  ({ expected }: { readonly expected: number }, subtotal: number) =>
    Effect.gen(function* () {
      const taxRate = yield* TaxRate;
      const actual = Math.round(subtotal * (1 + taxRate.rate));
      return actual === expected
        ? subtotal
        : yield* Effect.fail(`expected ${expected}, got ${actual}` as const);
    }),
);
```

### Scenario Resources

Every matched scenario runs in a fresh Effect `Scope`. A step can acquire a scoped
resource and return it as scenario state; the runner keeps that resource open until the
scenario finishes, even if a later step fails or times out.

```ts
import { Bdd } from "effect-bdd";
import { Effect } from "effect";

interface Page {
  readonly close: () => Effect.Effect<void>;
}

declare const openPage: Effect.Effect<Page>;

const givenAppIsOpen = Bdd.given`the app is open`(() =>
  Effect.acquireRelease(openPage, (page) => page.close()),
);

const whenUserClicks = Bdd.when`the user clicks submit`((page: Page) => Effect.succeed(page));
```

Use `Bdd.provide` when infrastructure should be available to steps but should not appear as
a Gherkin step. It mirrors `Effect.provide`, but provision is applied once per matched
scenario after the scenario program is built.

```ts
import { Bdd } from "effect-bdd";
import { Context, Effect, Layer } from "effect";

interface Page {
  readonly close: () => Effect.Effect<void>;
}

declare const openPage: Effect.Effect<Page>;

class BrowserPage extends Context.Service<BrowserPage, Page>()("BrowserPage") {}

const BrowserPageLive = Layer.effect(
  BrowserPage,
  Effect.acquireRelease(openPage, (page) => page.close()),
);

const whenUserClicks = Bdd.when`the user clicks submit`(() =>
  Effect.gen(function* () {
    const page = yield* BrowserPage;
    return page;
  }),
);

const submitsForm = Bdd.scenario("Submits form").pipe(whenUserClicks, Bdd.provide(BrowserPageLive));
```

Scenario-owned resources are intentionally not Cucumber-style `Before` / `After` hooks.
If a resource should live across the whole feature run, provide it around `Bdd.run` with
normal Effect APIs instead of acquiring it inside a step.

### Backgrounds

Backgrounds are explicit leading steps in the chain. There is intentionally no
`Bdd.background(...)` helper.

```gherkin
Feature: Cart

  Background:
    Given an empty cart

  Scenario: Adding items
    When 2 books are added
    Then the total is 44
```

The scenario chain must include the background step first:

```text
Bdd.scenario("Adding items").pipe(
  givenEmptyCart,
  whenBooksAreAdded,
  thenTotalIs
)
```

`And` and `But` inherit the previous concrete keyword before verification. Use `Bdd.step`
only for phrases that are genuinely valid in any keyword position.

### Timeouts

Steps are unbounded by default. Configure a run-level timeout when blocked work should
fail the scenario instead of hanging the run:

```ts
import { Bdd } from "effect-bdd";
import { Duration, Effect } from "effect";

declare const counter: Bdd.Feature;
declare const source: string;

const program = Bdd.run(counter, source, {
  stepTimeout: Duration.seconds(5),
}).pipe(Effect.provide(Bdd.layerCucumber));
```

Override the run-level timeout for a single slow step with `Bdd.withTimeout`:

```ts
import { Bdd } from "effect-bdd";
import { Duration, Effect } from "effect";

const thenProjectionCatchesUp = Bdd.then`the projection catches up`(() => Effect.void).pipe(
  Bdd.withTimeout(Duration.seconds(30)),
);
```

Timeouts fail as `StepError`s whose `cause` is a `StepTimeoutError`. Effect timeouts
interrupt fibers, but synchronous infinite loops or non-interruptible native work can
still block the process.

## Reference

### Important CLI Flags

- `--features`, `-f`: required, repeatable, supports `*`, `?`, and `**`.
- `--steps`, `-s`: required, repeatable.
- `--reporter`, `-r`: repeatable; `text`, `html`, `json`, or `junit`.
- `--output-file.<reporter>`: write a reporter to a file.
- `--tags`: Cucumber-style tag expression with `and`, `or`, `not`, and parentheses.
- `--title`, `-n`: run scenarios whose `Feature / Scenario` title contains the text.
- `--parallel`: run scenarios concurrently.
- `--fail-fast`: stop after the first failed scenario.
- `--step-timeout`: maximum duration for each step, using Effect Duration input such as
  `"500 millis"` or `"5 seconds"`.
- `--strict`: fail the CLI on unused feature or scenario definitions.
- `--verbose`: show passing scenarios in text output.

Without `--strict`, failed scenarios and unmatched selected feature files/scenarios still
fail the run. Unused definitions are reported but do not fail the run.

### Glob Syntax

`--features` and `--steps` use effect-bdd's built-in glob resolver, not your shell's full
glob language.

- `*`: zero or more characters inside one path segment.
- `?`: exactly one character inside one path segment.
- `**`: zero or more path segments.

Patterns without wildcards are treated as literal file paths. Brace expansion
(`{unit,e2e}`), extglob, and shell character classes are not supported. Pass multiple
`--features` or `--steps` flags instead; matches are unioned, deduped, and sorted.

### Supported Gherkin

Feature files are parsed and compiled with Cucumber's Gherkin implementation. The runner
supports `Feature`, `Scenario`, `Scenario Outline`, `Examples`, `Background`, `Rule`, tags,
`Given`, `When`, `Then`, `And`, `But`, DataTables, DocStrings, comments, and descriptions.

Scenario Outlines are expanded before execution. Every Examples row runs the same source
scenario chain independently.

### Errors

`Bdd.run` fails with:

- `ParseError`: invalid Gherkin.
- `MatchError`: feature/scenario/step verification or argument decoding failed.
- `ScenarioSetupError`: scenario-level provider setup failed before steps ran.
- `StepError`: a matched step implementation failed or exceeded its configured timeout.
- `ScenarioTeardownError`: scenario scope finalization failed after steps finished.

### Public API

Most users should import from `effect-bdd` and use the `Bdd` namespace:

- constructors: `Bdd.capture`, `Bdd.table`, `Bdd.docString`, `Bdd.feature`, `Bdd.scenario`
- steps: `Bdd.given`, `Bdd.when`, `Bdd.then`, `Bdd.step`
- scenario wiring: `Bdd.provide`
- step metadata: `Bdd.withTimeout`
- runner: `Bdd.run`
- compiler service: `Bdd.GherkinCompiler`, `Bdd.layerCucumber`
- guards: `Bdd.isFeature`, `Bdd.isScenario`, `Bdd.isStep`, `Bdd.isStepTimeoutError`
- models/errors: `Bdd.Feature`, `Bdd.Scenario`, `Bdd.Step`, `Bdd.Report`,
  `Bdd.RunOptions`, `Bdd.RunError`, `Bdd.ParseError`, `Bdd.MatchError`, `Bdd.StepError`,
  `Bdd.ScenarioSetupError`, `Bdd.ScenarioTeardownError`, `Bdd.StepTimeoutError`

`Bdd.then` is a tagged-template step constructor. Because the namespace has a `then`
property, do not pass `Bdd` itself to promise APIs or `await` it; use
`Bdd.then\`...\`` to define Then steps.

The error classes are also importable from `effect-bdd/Errors`.

## Development Benchmarks

After `pnpm build`, run `pnpm bench` for the fast counter-example smoke profile.
Full, compiled, and pressure workflows plus interpretation rules are documented in
[`benchmarks/README.md`](benchmarks/README.md).

## Non-Goals

`effect-bdd` is not a Cucumber runtime clone. It does not include mutable worlds, hooks,
screenshot/log attachments, snippet generation, retries, dry-run mode, parameter
registries, generated chain code, or user-pluggable reporter APIs.

## Provenance

`effect-bdd` started as the `packages/bdd` proposal in
[Effect-TS/effect-smol#2332](https://github.com/Effect-TS/effect-smol/pull/2332) and now
lives as a standalone community package.
