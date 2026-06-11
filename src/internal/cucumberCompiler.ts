import { AstBuilder, compile, GherkinClassicTokenMatcher, Parser } from "@cucumber/gherkin"
import { IdGenerator } from "@cucumber/messages"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { isError } from "effect/Predicate"
import { ParseError } from "../Errors.ts"
import { GherkinCompiler, type ParsedSource } from "./parser.ts"

/** @internal */
export const layerCucumber = Layer.succeed(GherkinCompiler, {
  compile: (source, uri) =>
    Effect.try({
      try: () => compileWithCucumber(source, uri),
      catch: parseErrorFromCause
    })
})

const compileWithCucumber = (source: string, uri: string): ParsedSource => {
  const newId = IdGenerator.incrementing()
  const parser = new Parser(new AstBuilder(newId), new GherkinClassicTokenMatcher())
  const document = parser.parse(source)
  return {
    document,
    pickles: compile(document, uri, newId)
  }
}

const parseErrorFromCause = (cause: unknown): ParseError => {
  const location = causeLocation(cause)
  return new ParseError({
    message: isError(cause) ? cause.message : String(cause),
    line: location?.line ?? 1,
    column: location?.column ?? 1
  })
}

const causeLocation = (cause: unknown): { readonly line: number; readonly column?: number } | undefined => {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "errors" in cause &&
    Arr.isArray(cause.errors) &&
    cause.errors.length > 0
  ) {
    return causeLocation(cause.errors[0])
  }
  if (typeof cause === "object" && cause !== null && "location" in cause) {
    const location = cause.location
    if (typeof location === "object" && location !== null && "line" in location && typeof location.line === "number") {
      return {
        line: location.line,
        ...("column" in location && typeof location.column === "number" ? { column: location.column } : {})
      }
    }
  }
  return undefined
}
