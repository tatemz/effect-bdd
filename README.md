# effect-bdd

An Effect-native runner for testing Gherkin feature source with explicit, typed scenario chains.

`effect-bdd` uses Cucumber's Gherkin parser/compiler for feature-file syntax, but it does not use Cucumber's mutable `World` model. Code declares the executable scenario chains, and the feature file is verified against those chains position by position.

This package currently tracks the Effect v4 beta release train. Use matching `4.0.0-beta.x` versions of `effect` and Effect platform packages.

## Installation

```sh
pnpm add effect-bdd effect@4.0.0-beta.78
```

The `effect-bdd` CLI is published with the package:

```sh
pnpm effect-bdd --features "features/**/*.feature" --steps "features/**/*.step.ts"
```

## Quick Start

```ts
import { Bdd } from "effect-bdd"
import { Effect, Schema } from "effect"

const counterValue = Bdd.capture("counterValue", Schema.FiniteFromString)

const givenNoCounter = Bdd.given`no counter exists`(() => Effect.void)

const whenCounterIsCreated = Bdd.when`the counter is created`(() => Effect.succeed(0))

const thenCounterValueIs = Bdd.then`the counter value is ${counterValue}`(
  ({ counterValue }: { readonly counterValue: number }, state: number) =>
    state === counterValue
      ? Effect.succeed(state)
      : Effect.fail(`expected ${counterValue}, got ${state}` as const)
)

const creatingACounter = Bdd.scenario("Creating a counter").pipe(
  givenNoCounter,
  whenCounterIsCreated,
  thenCounterValueIs
)

const counter = Bdd.feature("Counter").pipe(
  creatingACounter
)

const program = Bdd.run(
  counter,
  `
Feature: Counter

  Scenario: Creating a counter
    Given no counter exists
    When the counter is created
    Then the counter value is 0
`
).pipe(Effect.provide(Bdd.layerCucumber))
```

## Model

A feature is made of explicit scenario chains:

- `Bdd.feature(name)` creates a feature definition.
- `Bdd.scenario(name)` creates a pipeable scenario chain.
- `Bdd.given`, `Bdd.when`, `Bdd.then`, and `Bdd.step` create reusable step values.
- Steps pipe into scenarios; scenarios pipe into features.
- Each step returns an `Effect` containing the next state.
- The state type may evolve across a scenario: `void -> Draft -> Result -> Asserted`.
- There is no feature-level `initial` state. The first step in each scenario sets up the first useful state.

The runner parses the feature source, compiles it with Cucumber, pairs each source scenario with the `Bdd.scenario(...)` chain of the same name, and verifies every step in order:

1. same step count
2. same concrete keyword (`Given`, `When`, `Then`), unless the chain step is `Bdd.step`
3. same expression match
4. same DataTable or DocString presence and Schema decoding

Only after verification does it run the chain.

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

Cucumber compiles that scenario into a flat step list:

```text
Given an empty cart
Given tax is enabled
When 2 book are added
Then the taxed total is 44
```

So the chain lists the same steps:

```text
const addingTaxedItems = Bdd.scenario("Adding taxed items").pipe(
  givenEmptyCart,
  givenTaxEnabled,
  whenBooksAdded,
  thenTaxedTotal
)
```

This is intentionally explicit. There is no `Bdd.background(...)` helper.

## Captures

Captures are named values inside a tagged-template step expression. The source text is always a string, and the capture's `Schema` decides how to decode it before the step implementation runs.

```ts
import { Bdd } from "effect-bdd"
import { Effect, Schema } from "effect"

const expected = Bdd.capture("expected", Schema.FiniteFromString)

const thenTotalIs = Bdd.then`the cart total is ${expected}`(
  ({ expected }: { readonly expected: number }, state: { readonly total: number }) =>
    state.total === expected
      ? Effect.succeed(state)
      : Effect.fail(`expected ${expected}, got ${state.total}` as const)
)
```

The implementation receives `{ expected: number }`, not raw strings.

Prefer strict schemas. `Schema.FiniteFromString` rejects `"abc"`, `""`, and `"Infinity"`, surfacing a `MatchError` when a Gherkin value is malformed.

## DataTables

Use `Bdd.table(schema)` when a step has a Gherkin DataTable. The first table row is treated as headers. Each following row is converted into an object and decoded with the supplied row schema.

```ts
import { Bdd } from "effect-bdd"
import { Effect, Schema } from "effect"

const Item = Schema.Struct({
  sku: Schema.String,
  qty: Schema.FiniteFromString,
  price: Schema.FiniteFromString
})

const whenItemsAreAdded = Bdd.when`the following items are added:`(
  Bdd.table(Item),
  (items: ReadonlyArray<typeof Item.Type>, state: ReadonlyArray<typeof Item.Type>) => Effect.succeed([...state, ...items])
)
```

```gherkin
When the following items are added:
  | sku  | qty | price |
  | book | 2   | 21    |
```

## DocStrings

Use `Bdd.docString(schema)` when a step has a Gherkin DocString.

```ts
import { Bdd } from "effect-bdd"
import { Effect, Option, Schema } from "effect"

const Payload = Schema.Struct({
  sku: Schema.String,
  qty: Schema.Number
})

const whenRequestBodyIs = Bdd.when`the request body is:`(
  Bdd.docString(Schema.fromJsonString(Payload)),
  (payload: typeof Payload.Type) => Effect.succeed(Option.some(payload))
)
```

```gherkin
When the request body is:
  """json
  { "sku": "book", "qty": 2 }
  """
```

## Services

Step implementations return normal `Effect` values, so they can require services in `R` and fail with typed errors in `E`.

```ts
import { Bdd } from "effect-bdd"
import { Context, Effect, Schema } from "effect"

class TaxRate extends Context.Service<TaxRate, {
  readonly rate: number
}>()("TaxRate") {}

const expected = Bdd.capture("expected", Schema.FiniteFromString)

const thenTaxedTotalIs = Bdd.then`the taxed total is ${expected}`(
  ({ expected }: { readonly expected: number }, subtotal: number) =>
    Effect.gen(function*() {
      const taxRate = yield* TaxRate
      const actual = Math.round(subtotal * (1 + taxRate.rate))
      return actual === expected
        ? subtotal
        : yield* Effect.fail(`expected ${expected}, got ${actual}` as const)
    })
)
```

## Supported Gherkin

Feature files are parsed and compiled with Cucumber's Gherkin implementation. The runner supports:

- `Feature`
- `Scenario`
- `Scenario Outline` and `Examples`
- `Background`
- `Rule`
- tags on features, rules, scenarios, and examples
- `Given`, `When`, `Then`
- `And` and `But` keyword inheritance
- DataTables
- DocStrings
- comments and descriptions

Scenario Outlines are expanded before execution. Every Examples row runs the same source scenario chain independently.

## Failures

`Bdd.run` fails with `Bdd.RunError`:

- `ParseError` when Gherkin source is invalid.
- `MatchError` when the feature name, scenario chain, positional step, keyword, argument presence, or Schema decoding does not match.
- `StepError` when a matched step implementation fails.

Schema decode failures are preserved on `MatchError.cause`. Step implementation failures are preserved on `StepError.cause`.

## CLI

`effect-bdd` publishes an `effect-bdd` bin for running `.feature` files from exported `Bdd.feature(...)` definitions.

Each matched step module should export one or more feature definitions. The feature definition name must match the Gherkin `Feature:` name, and each `Bdd.scenario(...)` name must match a source scenario name.

```gherkin
# features/counter.feature
Feature: Counter

  Scenario: Creating a counter
    Given no counter exists
    When the counter is created
    Then the counter value is 0
```

```ts
// features/counter.step.ts
import { Bdd } from "effect-bdd"
import { Effect, Schema } from "effect"

const expected = Bdd.capture("expected", Schema.FiniteFromString)

const givenNoCounter = Bdd.given`no counter exists`(() => Effect.void)
const whenCreated = Bdd.when`the counter is created`(() => Effect.succeed(0))
const thenValueIs = Bdd.then`the counter value is ${expected}`(
  ({ expected }: { readonly expected: number }, state: number) =>
    state === expected
      ? Effect.succeed(state)
      : Effect.fail(`expected ${expected}, got ${state}` as const)
)

export const counter = Bdd.feature("Counter").pipe(
  Bdd.scenario("Creating a counter").pipe(
    givenNoCounter,
    whenCreated,
    thenValueIs
  )
)
```

Add a package script:

```json
{
  "scripts": {
    "bdd": "effect-bdd --features \"features/**/*.feature\" --steps \"features/**/*.step.ts\" --reporter text"
  }
}
```

Then run:

```sh
pnpm bdd
```

The command exits with status `0` when every scenario passes and with a non-zero status when discovery, parsing, verification, reporting, diagnostics, or any scenario fails.

### Globs

Both `--features` (`-f`) and `--steps` (`-s`) are required, repeatable, and support a deliberately minimal glob syntax: `*`, `?`, and `**`.

```sh
effect-bdd \
  --features "features/cart/**/*.feature" \
  --features "features/checkout/**/*.feature" \
  --steps "features/**/*.step.ts" \
  --steps "test-support/**/*.step.ts"
```

Matched paths are deduplicated and sorted before execution so report order is stable.

### Reporters

Reporters are repeatable:

```sh
effect-bdd \
  --features "features/**/*.feature" \
  --steps "features/**/*.step.ts" \
  --reporter text \
  --reporter html \
  --output-file.html reports/bdd.html
```

Built-in reporters:

- `text`: writes to stdout by default, or `--output-file.text <path>`.
- `html`: writes to `--output-file.html <path>`.
- `json`: writes to stdout by default, or `--output-file.json <path>`.
- `junit`: writes to `--output-file.junit <path>`.

### Filtering

Use `--tags <expression>` for Cucumber-style tag expressions:

```sh
effect-bdd \
  --features "features/**/*.feature" \
  --steps "features/**/*.step.ts" \
  --tags "@event-sourcing and not @slow"
```

Supported tag operators are `and`, `or`, `not`, and parentheses. Repeated `--tags` flags are combined with `and`.

Use `--name <text>` to run scenarios whose `Feature / Scenario` name contains the provided text. Repeated `--name` flags are combined with `or`.

### Parallel Scenario Execution

Use `--parallel <n>` to run scenarios concurrently:

```sh
effect-bdd \
  --features "features/**/*.feature" \
  --steps "features/**/*.step.ts" \
  --parallel 4
```

Reports preserve feature/scenario source order even when scenarios run concurrently.

Use `--fail-fast` to stop after the first failed scenario. When enabled, scenarios run sequentially so the stop point is deterministic.

### TypeScript Step Modules

Bun can load `.ts` step definition modules directly when the CLI is executed by Bun:

```sh
bunx --bun effect-bdd --features "features/**/*.feature" --steps "features/**/*.step.ts"
```

Node requires an explicit TypeScript loader. The CLI does not install or register one implicitly:

```sh
node --import tsx ./node_modules/.bin/effect-bdd \
  --features "features/**/*.feature" \
  --steps "features/**/*.step.ts"
```

## Public API Surface

Most users should import from `effect-bdd` and use the `Bdd` namespace:

- constructors: `Bdd.capture`, `Bdd.table`, `Bdd.docString`, `Bdd.feature`, `Bdd.scenario`
- steps: `Bdd.given`, `Bdd.when`, `Bdd.then`, `Bdd.step`
- runner: `Bdd.run`
- parser/compiler service and layer: `Bdd.GherkinCompiler`, `Bdd.layerCucumber`
- guards: `Bdd.isFeature`
- models and errors: `Bdd.Feature`, `Bdd.Scenario`, `Bdd.Step`, `Bdd.Report`, `Bdd.RunError`, `Bdd.ParseError`, `Bdd.MatchError`, `Bdd.StepError`

The error classes are also importable directly from the `effect-bdd/Errors` subpath.

## Internal Dependency Direction

- **core** (`Bdd.ts`, `Errors.ts`, `internal/runner.ts`, `internal/expression.ts`, `internal/parser.ts`) is platform-agnostic.
- **cucumber adapter** (`internal/cucumberCompiler.ts`) is the only module importing `@cucumber/gherkin`.
- **cli** (`main.ts`, `internal/cli/*`) depends on core and Effect platform services.
- **bin** (`bin.ts`) is the only module importing `@effect/platform-node`.

## Non-Goals

`effect-bdd` is not a drop-in replacement for Cucumber's runtime. The current package deliberately does not include:

- mutable `World` objects or global step registries
- hooks (`Before`, `After`, `BeforeStep`, `AfterStep`, `BeforeAll`, `AfterAll`)
- attachments for screenshots, logs, or other report artifacts
- snippet generation for unmatched steps
- retry / rerun support
- dry-run mode
- Cucumber expression parameter registries such as `defineParameterType`
- user-pluggable reporter APIs
- generated scenario chain code

## Provenance

`effect-bdd` started as the `packages/bdd` proposal in [Effect-TS/effect-smol#2332](https://github.com/Effect-TS/effect-smol/pull/2332) and now lives as a standalone community package.
