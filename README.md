# effect-bdd

An Effect-native runner for testing Gherkin feature files with explicit, typed scenario chains.

`effect-bdd` uses Cucumber's parser/compiler for Gherkin syntax, but not Cucumber's mutable `World` model. Your code declares the executable scenario chains; the `.feature` file is verified against those chains position by position.

This package currently tracks the Effect v4 beta release train. Use matching `4.0.0-beta.x` versions of `effect` and Effect platform packages.

## Install

```sh
pnpm add effect-bdd effect@4.0.0-beta.78
```

## Quick Start

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

## The Model

A feature is made of explicit scenario chains:

- `Bdd.feature(name)` creates a feature definition.
- `Bdd.scenario(name)` creates a pipeable scenario chain.
- `Bdd.given`, `Bdd.when`, `Bdd.then`, and `Bdd.step` create reusable step values.
- Steps pipe into scenarios; scenarios pipe into features.
- Each step returns an `Effect` containing the next state.
- State may evolve across a scenario: `void -> Draft -> Result -> Asserted`.
- There is no feature-level `initial` state. The first step sets up the first useful state.

The runner parses the feature source, compiles it with Cucumber, pairs each source scenario with the `Bdd.scenario(...)` chain of the same name, verifies every step in order, then runs the chain.

## Recommended `steps.ts` Shape

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

One Gherkin `Feature:` should map to one exported `Bdd.feature("Feature name")`. Do not split one feature across multiple exported feature definitions. Reusable steps can live anywhere, but compose them into a single feature export per feature name.

## Backgrounds

Backgrounds are explicit leading steps in the chain.

```gherkin
Feature: Cart

  Background:
    Given an empty cart

  Rule: Taxed checkout
    Background:
      Given tax is enabled

    Scenario: Adding taxed items
      When 2 book are added
      Then the taxed total is 44
```

Cucumber compiles that scenario into this flat list:

```text
Given an empty cart
Given tax is enabled
When 2 book are added
Then the taxed total is 44
```

So the chain must list the same steps:

```text
Bdd.scenario("Adding taxed items").pipe(
  givenEmptyCart,
  givenTaxEnabled,
  whenBooksAdded,
  thenTaxedTotal
)
```

There is intentionally no `Bdd.background(...)` helper.

## Drift Detection

The scenario chain must mirror the compiled feature-file steps exactly.

- Missing background step: `Scenario "X" has 4 source step(s), but its chain has 3 step(s)`.
- Wrong keyword: `Step 2 keyword mismatch: source is When, chain expects Given`.
- Wrong order or text: `Step 2 text mismatch: source says "...", chain expects "..."`.
- Missing scenario chain: `Scenario has no matching Bdd.scenario chain`.
- Extra scenario chain: `Scenario chain exported but no source scenario matched`.
- Duplicate feature exports: CLI discovery fails with `Multiple feature definitions matched "X"`.
- Duplicate scenario chains in one feature: CLI discovery fails before running scenarios.

`And` and `But` inherit the previous concrete keyword before verification. `Bdd.step` is the escape hatch for phrases that are genuinely valid in any keyword position; use it sparingly.

## Captures

Captures are named values inside a tagged-template step expression. The source text is a string; the capture's `Schema` decodes it before the step implementation runs.

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

Prefer strict schemas. `Schema.FiniteFromString` rejects `"abc"`, `""`, and `"Infinity"` as `MatchError`s.

Note: for now, examples annotate captured handler parameters explicitly. This keeps strict TypeScript and example checking honest around overloaded tagged-template inference.

## DataTables and DocStrings

Use `Bdd.table(schema)` for Gherkin DataTables. The first row is headers; each later row is decoded by the row schema.

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

Schema decode failures are preserved on `MatchError.cause`.

## Services

Step implementations return normal `Effect` values, so they can require services in `R` and fail with typed errors in `E`.

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

## CLI

```sh
effect-bdd \
  --features "features/**/*.feature" \
  --steps "features/**/*.step.ts" \
  --reporter text
```

Important flags:

- `--features`, `-f`: required, repeatable, supports `*`, `?`, and `**`.
- `--steps`, `-s`: required, repeatable.
- `--reporter`, `-r`: repeatable; `text`, `html`, `json`, or `junit`.
- `--output-file.<reporter>`: write a reporter to a file.
- `--tags`: Cucumber-style tag expression with `and`, `or`, `not`, and parentheses.
- `--name`: run scenarios whose `Feature / Scenario` name contains the text.
- `--parallel`: run scenarios concurrently.
- `--fail-fast`: stop after the first failed scenario.
- `--verbose`: show passing scenarios in text output.

Node requires an explicit TypeScript loader for `.ts` step modules:

```sh
node --import tsx ./node_modules/.bin/effect-bdd \
  --features "features/**/*.feature" \
  --steps "features/**/*.step.ts"
```

Bun can load `.ts` step modules directly:

```sh
bunx --bun effect-bdd --features "features/**/*.feature" --steps "features/**/*.step.ts"
```

## Supported Gherkin

Feature files are parsed and compiled with Cucumber's Gherkin implementation. The runner supports:

- `Feature`
- `Scenario`
- `Scenario Outline` and `Examples`
- `Background`
- `Rule`
- tags on features, rules, scenarios, and examples
- `Given`, `When`, `Then`, `And`, and `But`
- DataTables
- DocStrings
- comments and descriptions

Scenario Outlines are expanded before execution. Every Examples row runs the same source scenario chain independently.

## Errors

`Bdd.run` fails with:

- `ParseError`: invalid Gherkin.
- `MatchError`: feature/scenario/step verification or argument decoding failed.
- `StepError`: a matched step implementation failed.

## Public API

Most users should import from `effect-bdd` and use the `Bdd` namespace:

- constructors: `Bdd.capture`, `Bdd.table`, `Bdd.docString`, `Bdd.feature`, `Bdd.scenario`
- steps: `Bdd.given`, `Bdd.when`, `Bdd.then`, `Bdd.step`
- runner: `Bdd.run`
- compiler service: `Bdd.GherkinCompiler`, `Bdd.layerCucumber`
- models/errors: `Bdd.Feature`, `Bdd.Scenario`, `Bdd.Step`, `Bdd.Report`, `Bdd.RunError`, `Bdd.ParseError`, `Bdd.MatchError`, `Bdd.StepError`

The error classes are also importable from `effect-bdd/Errors`.

## Non-Goals

`effect-bdd` is not a Cucumber runtime clone. It does not include mutable worlds, hooks, screenshot/log attachments, snippet generation, retries, dry-run mode, parameter registries, generated chain code, or user-pluggable reporter APIs.

## Provenance

`effect-bdd` started as the `packages/bdd` proposal in [Effect-TS/effect-smol#2332](https://github.com/Effect-TS/effect-smol/pull/2332) and now lives as a standalone community package.
