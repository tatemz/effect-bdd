import { Bdd } from "effect-bdd"
import { Effect, Schema } from "effect"
import * as Arr from "effect/Array"

type Events = ReadonlyArray<string>

const text = Bdd.capture("text", Schema.String)
const table = Bdd.table(Schema.Unknown)
const docString = Bdd.docString(Schema.String)

const append = (state: Events | undefined, event: string): Events => Arr.append(state ?? [], event)

const givenMinimalism = Bdd.given`the minimalism`((state: Events | undefined) =>
  Effect.succeed(append(state, "minimalism"))
)
const givenBackgroundMinimalism = Bdd.given`the minimalism inside a background`((state: Events | undefined) =>
  Effect.succeed(append(state, "background"))
)
const givenTheText = Bdd.given`the ${text}`(({ text }, state: Events | undefined) =>
  Effect.succeed(append(state, text))
)
const givenAText = Bdd.given`a ${text}`(({ text }, state: Events | undefined) => Effect.succeed(append(state, text)))
const givenATextTable = Bdd.given`a ${text}`(table, ({ text }, _table, state: Events | undefined) =>
  Effect.succeed(append(state, text))
)
const givenATextDocString = Bdd.given`a ${text}`(docString, ({ text }, _docString, state: Events | undefined) =>
  Effect.succeed(append(state, text))
)
const givenFb = Bdd.given`fb`((state: Events | undefined) => Effect.succeed(append(state, "feature background")))
const givenAb = Bdd.given`ab`((state: Events | undefined) => Effect.succeed(append(state, "rule background")))
const givenA = Bdd.given`a`((state: Events | undefined) => Effect.succeed(append(state, "example a")))
const givenB = Bdd.given`b`((state: Events | undefined) => Effect.succeed(append(state, "example b")))
const givenComment = Bdd.given`a comment`((state: Events | undefined) => Effect.succeed(append(state, "comment")))
const givenCommentSpace = Bdd.given`a comment is preceded by a space`((state: Events | undefined) =>
  Effect.succeed(append(state, "comment"))
)
const givenDelimits = Bdd.given`the @delimits tags`((state: Events | undefined) =>
  Effect.succeed(append(state, "joined tags"))
)

export const minimal = Bdd.feature("Minimal").pipe(
  Bdd.scenario("minimalistic").pipe(givenMinimalism)
)

export const background = Bdd.feature("Background").pipe(
  Bdd.scenario("minimalistic").pipe(givenBackgroundMinimalism, givenMinimalism),
  Bdd.scenario("also minimalistic").pipe(givenBackgroundMinimalism, givenMinimalism)
)

export const minimalScenarioOutline = Bdd.feature("Minimal Scenario Outline").pipe(
  Bdd.scenario("minimalistic").pipe(givenTheText)
)

export const taggedScenarios = Bdd.feature("Tagged scenarios").pipe(
  Bdd.scenario("minimalistic").pipe(givenMinimalism),
  Bdd.scenario("minimalistic outline").pipe(givenTheText),
  Bdd.scenario("comments").pipe(givenComment),
  Bdd.scenario("hash in tags").pipe(givenCommentSpace),
  Bdd.scenario("joined tags").pipe(givenDelimits)
)

export const someRules = Bdd.feature("Some rules").pipe(
  Bdd.scenario("Example A").pipe(givenFb, givenAb, givenA),
  Bdd.scenario("Example B").pipe(givenFb, givenB)
)

export const descriptions = Bdd.feature("Descriptions everywhere").pipe(
  Bdd.scenario("two lines").pipe(givenMinimalism),
  Bdd.scenario("without indentation").pipe(givenMinimalism),
  Bdd.scenario("empty lines in the middle").pipe(givenMinimalism),
  Bdd.scenario("empty lines around").pipe(givenMinimalism),
  Bdd.scenario("comment after description").pipe(givenMinimalism),
  Bdd.scenario("comment right after description").pipe(givenMinimalism),
  Bdd.scenario("description with escaped docstring separator").pipe(givenMinimalism),
  Bdd.scenario("scenario outline with a description").pipe(givenMinimalism)
)

export const dataTables = Bdd.feature("DataTables").pipe(
  Bdd.scenario("minimalistic").pipe(
    givenATextTable,
    givenATextTable,
    givenATextTable,
    givenATextTable,
    givenATextTable,
    givenATextTable
  )
)

export const docStrings = Bdd.feature("DocString variations").pipe(
  Bdd.scenario("minimalistic").pipe(
    givenATextDocString,
    givenATextDocString,
    givenATextDocString,
    givenATextDocString,
    givenATextDocString,
    givenATextDocString,
    givenATextDocString,
    givenATextDocString
  )
)
