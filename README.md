# effect-bdd

An Effect-native BDD runner for Gherkin feature files.

Use `effect-bdd` when you want plain-language `.feature` files, but you do not want
Cucumber's mutable `World` model. Your TypeScript declares explicit, typed scenario
chains. The runner verifies each compiled Gherkin scenario against those chains before
running the steps.

## Contents

- [Install](#install)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [CLI Workflows](#cli-workflows)
- [Writing Step Modules](#writing-step-modules)
- [Given, When, Then](#given-when-then)
- [Step Patterns](#step-patterns)
- [Reference](#reference)
- [Development Benchmarks](#development-benchmarks)
- [Non-Goals](#non-goals)

## Install

`effect-bdd` requires Node `>=22.12.0` and tracks Effect v4. Install `effect-bdd`
with a matching `effect` version.

```sh
pnpm add effect-bdd effect
pnpm add -D tsx
```

`tsx` is only needed when the CLI must load TypeScript step modules. Bun loads
them directly; a compiled project can use plain Node.

## Quick Start

Start with a feature file. Save this as `features/counter.feature`:

```gherkin
Feature: Counter

  Scenario: Creating a counter
    Given no counter exists
    When the counter is created
    Then the counter value is 0
```

Then declare the same scenario chain in TypeScript. Save this as
`features/counter.steps.ts`:

```ts
import { Bdd } from "effect-bdd";
import { Effect, Schema } from "effect";

const expected = Bdd.capture("expected", Schema.FiniteFromString);

const givenNoCounter = Bdd.given`no counter exists`(() => Effect.succeed(0));
const whenCounterIsCreated = Bdd.when`the counter is created`((state: number) =>
  Effect.succeed(state),
);
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

export const counter = Bdd.feature("Counter").pipe(creatingACounter);
```

Export the feature. The CLI discovers definitions by reading each exported value,
so a module-local `const` is invisible to it.

Run both files through the CLI:

```sh
NODE_OPTIONS="--import tsx" pnpm exec effect-bdd \
  --features "features/*.feature" \
  --steps "features/*.steps.ts"
```

You should see three passing steps and one passing scenario. If the `.feature`
text and the chain disagree, the run fails before any step executes. That is the
point of the pairing; see [How It Works](#how-it-works).

You can also run a feature from a test with `Bdd.run`. It takes the feature
definition and the Gherkin source as a string:

```ts
import { Bdd } from "effect-bdd";
import { Effect } from "effect";

declare const counter: Bdd.Feature;

const source = `
Feature: Counter

  Scenario: Creating a counter
    Given no counter exists
    When the counter is created
    Then the counter value is 0
`;

const program = Bdd.run(counter, source).pipe(Effect.provide(Bdd.layerCucumber));
```

`Bdd.run` returns `Effect<Bdd.Report, Bdd.RunError>`, so it composes with your
existing Effect tests. Providing `Bdd.layerCucumber` supplies the default
Gherkin compiler.

There is a fuller counter example in [`examples/counter`](examples/counter), and
one that boots a real HTTP server in [`examples/greeter-api`](examples/greeter-api).
Run both from the repository root:

```sh
pnpm build
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

### Watch Mode

`--watch` keeps the process alive and reruns when a feature or step file changes:

```sh
NODE_OPTIONS="--import tsx" pnpm exec effect-bdd \
  --features "features/**/*.feature" \
  --steps "features/**/*.steps.ts" \
  --watch
```

The first run covers every selected feature. After that, editing one feature file
reruns only that file, while editing a step module reruns everything, because a
shared step change can affect any feature. `--tags` and `--title` apply to every
rerun. Stop the session with Ctrl+C.

Each rerun starts a fresh child process, so step modules are reloaded and Node's
module cache cannot serve you stale definitions.

### Reporters

`--reporter` accepts `text`, `html`, `json`, and `junit`, and repeats for several
at once. `text` defaults to stdout. The `html` and `junit` reporters require an
output file:

```sh
NODE_OPTIONS="--import tsx" pnpm exec effect-bdd \
  --features "features/**/*.feature" \
  --steps "features/**/*.steps.ts" \
  --reporter text \
  --reporter junit \
  --output-file.junit reports/junit.xml
```

When several reporters are selected, the exits of all of them decide the run
result, so a failing reporter still fails the CLI.

## Writing Step Modules

A step module is an ordinary ES module that exports a `Bdd.feature(...)`. Keep
it boring and top-to-bottom:

```text
imports
schemas and captures
domain types
pure helpers
reusable given/when/then step values
scenario chains
one exported Bdd.feature(...)
```

One Gherkin `Feature:` should map to one exported `Bdd.feature("Feature name")`, and
the titles must match exactly. A title mismatch is a `MatchError`, not a silent
skip. Reusable steps can live anywhere, but compose them into a single feature
export per feature name.

The CLI treats every exported `Bdd.feature(...)` from the matched step modules as
a candidate, so export only definitions you want discovered. Helper exports are
fine; they are ignored unless they are features.

Scenario state flows through the chain. There is no feature-level `initial` state; the
first step sets up the first useful state. Each step receives the previous step's
state and returns the next one.

Here is a complete module for the feature below:

```gherkin
Feature: Counter

  Scenario: Counting up
    Given a counter at 0
    When the counter is incremented
    Then the counter value is 1
```

```ts
import { Bdd } from "effect-bdd";
import { Effect, Schema } from "effect";

interface Counter {
  readonly value: number;
}

const count = Bdd.capture("count", Schema.FiniteFromString);
const expected = Bdd.capture("expected", Schema.FiniteFromString);

const scenario = Bdd.scenario("Counting up").pipe(
  Bdd.given`a counter at ${count}`(({ count }) => Effect.succeed<Counter>({ value: count })),
  Bdd.when`the counter is incremented`((state: Counter) =>
    Effect.succeed<Counter>({ value: state.value + 1 }),
  ),
  Bdd.then`the counter value is ${expected}`(({ expected }, state: Counter) =>
    state.value === expected
      ? Effect.succeed(state)
      : Effect.fail(`expected ${expected}, got ${state.value}` as const),
  ),
);

export const counter = Bdd.feature("Counter").pipe(scenario);
```

Captures and decoded arguments are inferred from the tagged template, and the
state type flows from step to step through the `pipe`. Annotate a parameter when
you need to name the state type, as with `state: Counter` above.

## Given, When, Then

The runner pairs steps position by position, but it does not police what each step
does. That discipline is yours, and it is what makes a scenario readable and its
failures meaningful. Hold every scenario to these rules.

**Every scenario has at least one `Given`, one `When`, and one `Then`.** A scenario
without a `When` describes no behavior; one without a `Then` asserts nothing.

**`Given` is setup.** It builds the starting state and never asserts. A failing
`Given` means the scenario could not start, which is a different problem from the
behavior under test being wrong.

**`When` is the action.** It performs the single behavior the scenario is about and
returns the result as state. If you need two `When` steps, you have two scenarios.

**`Then` is the assertion.** It inspects the state the `When` produced and passes it
along, so later steps still have something to work with. It makes no calls of its own:
if a `Then` starts a server, sends a request, or mutates state, the behavior moved
into the assertion and the failure message will point at the wrong place.

A `Then` must not provide services to itself. If an assertion needs a service, put
`Bdd.provide(...)` on the scenario, where the setup and action can see it too.

Captures and DataTables work in any step, but prefer them where they belong:
inputs to a `Given`, or expected values in a `Then`.

These rules are style, not enforcement. `effect-bdd` accepts a scenario with no
`When`, and the fixtures under `test/fixtures/` do exactly that to test the parser.
The [fixture README](test/fixtures/README.md) explains why those are not models to
copy.

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

Prefer strict schemas. `Schema.FiniteFromString` rejects `"abc"`, `"Infinity"`, and other
non-numeric text as `MatchError`s. An empty capture fails earlier, as a text
mismatch, because the pattern requires at least one character.

### DataTables and DocStrings

Use `Bdd.table(schema)` for Gherkin DataTables. The first row supplies the column
headers. Each later row becomes an object keyed by those headers and is decoded by
the row schema:

```gherkin
Given the following items are added:
  | sku      | qty |
  | book     | 2   |
  | notebook | 3   |
```

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

Header names must match the row schema's field names. A DataTable with no rows
decodes to an empty array.

Use `Bdd.docString(schema)` for larger step arguments, including JSON payloads:

```gherkin
Given the request body is:
  """json
  { "sku": "book", "qty": 2 }
  """
```

```ts
import { Bdd } from "effect-bdd";
import { Effect, Option, Schema } from "effect";

const Payload = Schema.Struct({
  sku: Schema.String,
  qty: Schema.Number,
});

const givenRequestBody = Bdd.given`the request body is:`(
  Bdd.docString(Schema.fromJsonString(Payload)),
  (payload: typeof Payload.Type) => Effect.succeed(Option.some(payload)),
);
```

Schema decode failures for captures, DataTables, and DocStrings are preserved on
`MatchError.cause`, so you can inspect the underlying `SchemaError`.

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

This step needs `TaxRate` in its environment. `Bdd.run` excludes `Scope` from the
required environment (`Exclude<R, Scope.Scope>`) and adds `Bdd.GherkinCompiler`, so
your `R` becomes part of the returned Effect's requirements. You can satisfy it two
ways.

At run level, around `Bdd.run`, when every scenario should share one instance. Build
the feature, then provide the service at the end of the pipe:

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

const feature = Bdd.feature("Cart").pipe(
  Bdd.scenario("Taxed total").pipe(
    Bdd.given`a subtotal of 10`(() => Effect.succeed(10)),
    thenTaxedTotalIs,
  ),
);

declare const source: string;

const program = Bdd.run(feature, source).pipe(
  Effect.provide(Bdd.layerCucumber),
  Effect.provideService(TaxRate, { rate: 0.1 }),
);
```

At scenario level, with `Bdd.provide`, when the service holds resources that belong
to a single scenario. See [Scenario Resources](#scenario-resources).

`Bdd.provide` accepts a scenario, not a feature. Apply it to the scenarios that need
the layer rather than to the whole feature.

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
scenario after the scenario program is built. Resources acquired by earlier providers
are finalized even if a later provider fails during setup.

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

const thenProjectionCatchesUp = Bdd.then`the projection catches up`((state: "caught-up") =>
  state === "caught-up"
    ? Effect.succeed(state)
    : Effect.fail(`expected the projection to catch up, got ${state}` as const),
).pipe(Bdd.withTimeout(Duration.seconds(30)));
```

Timeouts fail as `StepError`s whose `cause` is a `StepTimeoutError`. Effect timeouts
interrupt fibers, but synchronous infinite loops or non-interruptible native work can
still block the process.

### Taps

`Bdd.tap` observes the scenario state without changing it, mirroring `Effect.tap`. In a
scenario chain it runs wherever it is piped, receiving the state produced so far and
passing it through unchanged:

```ts
import { Bdd } from "effect-bdd";
import { Effect } from "effect";

interface Cart {
  readonly items: ReadonlyArray<string>;
}

const emptyCart: Cart = { items: [] };

const showCart = Bdd.tap((state: Cart) => Effect.log(`${state.items.length} item(s)`));

const addItem = Bdd.scenario("Add item").pipe(
  Bdd.given`an empty cart`(() => Effect.succeed(emptyCart)),
  showCart,
  Bdd.when`an item is added`((state: Cart) => Effect.succeed({ items: ["sku"] })),
  showCart,
  Bdd.then`the cart has one item`((state: Cart) =>
    state.items.length === 1
      ? Effect.succeed(state)
      : Effect.fail(`expected 1 item, got ${state.items.length}` as const),
  ),
);
```

The state annotation is the contract: `Bdd.tap((state: Cart) => ...)` only typechecks
where the chain's current state is `Cart`.

On a feature, `Bdd.tap` runs once at its declared position: before the first scenario
when nothing precedes it (receiving `undefined` state), otherwise after the scenario
declared before it, receiving that scenario's final state. Because scenarios may use
different state types, feature tap handlers must accept `unknown` state:

```ts
import { Bdd } from "effect-bdd";
import { Effect } from "effect";

interface Cart {
  readonly items: ReadonlyArray<string>;
}

const emptyCart: Cart = { items: [] };

const feature = Bdd.feature("Shopping cart").pipe(
  Bdd.scenario("Add item").pipe(
    Bdd.given`an empty cart`(() => Effect.succeed(emptyCart)),
    Bdd.when`an item is added`((state: Cart) => Effect.succeed({ items: ["sku"] })),
    Bdd.then`the cart has one item`((state: Cart) =>
      state.items.length === 1
        ? Effect.succeed(state)
        : Effect.fail(`expected 1 item, got ${state.items.length}` as const),
    ),
  ),
  Bdd.tap((state) => Effect.log(`state after Add item: ${JSON.stringify(state)}`)),
);
```

A tap piped before every scenario also works. It runs once before the first scenario and
receives `undefined` state.

`Bdd.tapError` observes a scenario failure without swallowing it, mirroring
`Effect.tapError`. On a scenario it observes that scenario's failures. On a feature it
observes the failures of the scenarios declared before it — a tap declared before every
scenario observes nothing. The handler receives the failure, and the scenario still
fails with the original error:

```ts
import { Bdd } from "effect-bdd";
import { Effect } from "effect";

const feature = Bdd.feature("Shopping cart").pipe(
  Bdd.scenario("Add item").pipe(
    Bdd.given`an empty cart`(() => Effect.succeed({ items: [] })),
    Bdd.when`an item is added`(() => Effect.fail("out of stock" as const)),
  ),
  Bdd.tapError((failure) => Effect.logError(`${failure._tag}: ${failure.message}`)),
);
```

If a tap handler itself fails, the scenario fails with a `TapError` — the same rule an
`Effect.tapError` handler failure follows.

## Reference

### Important CLI Flags

- `--features`, `-f`: required, repeatable, supports `*`, `?`, and `**`.
- `--steps`, `-s`: required, repeatable.
- `--reporter`, `-r`: repeatable; `text`, `html`, `json`, or `junit`. Defaults to `text`.
- `--output-file.text`, `--output-file.json`: write that reporter to a file. Falls back
  to stdout.
- `--output-file.html`, `--output-file.junit`: required when that reporter is selected.
- `--tags`, `-t`: repeatable Cucumber-style tag expression with `and`, `or`, `not`, and
  parentheses. Repeating the flag combines expressions with `and`.
- `--title`, `-n`: repeatable; run scenarios whose `Feature / Scenario` title contains
  the text.
- `--parallel`, `-p`: number of scenarios to run concurrently. Defaults to `1`.
- `--fail-fast`: stop after the first failed scenario. Runs sequentially when enabled.
- `--step-timeout`: maximum duration for each step, using Effect Duration input such as
  `"500 millis"` or `"5 seconds"`.
- `--strict`: fail the CLI on unused feature or scenario definitions.
- `--verbose`, `-v`: show passing scenarios in text output.
- `--watch`: rerun on file changes. See [Watch Mode](#watch-mode).

Without `--strict`, failed scenarios and unmatched selected feature files/scenarios still
fail the run. Unused definitions are reported but do not fail the run.

`-v` is `--verbose` here, not `--version`. Use `--version` for the version number.

### Step Timeout Format

`--step-timeout` accepts `<number> <unit>` with a space, plus the literal `Infinity`.
Units are `nano`, `nanos`, `micro`, `micros`, `milli`, `millis`, `second`, `seconds`,
`minute`, `minutes`, `hour`, `hours`, `day`, `days`, `week`, and `weeks`.

```sh
--step-timeout "500 millis"   # ok
--step-timeout "1.5 seconds"  # ok
--step-timeout "5s"           # error: no space and not a known unit
--step-timeout "500ms"        # error: same reason
--step-timeout "0 seconds"    # error: must be positive
```

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

- `ParseError`: invalid Gherkin. Carries `line` and `column`.
- `MatchError`: feature/scenario/step verification or argument decoding failed. Carries
  `scenario`, `step`, `line`, and `candidates` — the step expressions that were
  considered.
- `ScenarioSetupError`: scenario-level provider setup failed before steps ran.
- `StepError`: a matched step implementation failed or exceeded its configured timeout.
- `ScenarioTeardownError`: scenario scope finalization failed.
- `TapError`: a `Bdd.tap` or `Bdd.tapError` handler failed.

These types are exported from `effect-bdd` and from `effect-bdd/Errors`.

`Bdd.run` stops at the first problem in deterministic source order. Use the CLI when
you want every discovery problem in one report.

The CLI adds its own diagnostics, which are separate from `Bdd.RunError`:

- **unmatched source**: a `.feature` file or scenario has no matching definition. This
  is fatal.
- **unused definitions**: an exported `Bdd.feature` or scenario has no matching source.
  Reported by default, fatal only with `--strict`.

A step failure is a `StepError` whose `cause` holds the original failure. For a
timeout, that `cause` is a `StepTimeoutError` carrying the configured `timeout`.

### Public API

Most users should import from `effect-bdd` and use the `Bdd` namespace:

- constructors: `Bdd.capture`, `Bdd.table`, `Bdd.docString`, `Bdd.feature`, `Bdd.scenario`
- steps: `Bdd.given`, `Bdd.when`, `Bdd.then`, `Bdd.step`
- scenario wiring: `Bdd.provide`, `Bdd.tap`, `Bdd.tapError`
- step metadata: `Bdd.withTimeout`
- runner: `Bdd.run`
- compiler service: `Bdd.GherkinCompiler`, `Bdd.layerCucumber`
- guards: `Bdd.isFeature`, `Bdd.isScenario`, `Bdd.isStep`, `Bdd.isStepTimeoutError`
- models/errors: `Bdd.Feature`, `Bdd.Scenario`, `Bdd.Step`, `Bdd.Report`,
  `Bdd.RunOptions`, `Bdd.RunError`, `Bdd.ParseError`, `Bdd.MatchError`, `Bdd.StepError`,
  `Bdd.ScenarioSetupError`, `Bdd.ScenarioTeardownError`, `Bdd.StepTimeoutError`,
  `Bdd.TapError`, `Bdd.ScenarioFailure`

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
