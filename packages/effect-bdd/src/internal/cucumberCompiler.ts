import { AstBuilder, compile, GherkinClassicTokenMatcher, Parser } from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import { ParseError } from "../Errors.ts";
import { GherkinCompiler, type ParsedSource } from "./parser.ts";

/** @internal */
export const layerCucumber = Layer.succeed(GherkinCompiler, {
  compile: (source, uri) =>
    Effect.try({
      try: () => compileWithCucumber(source, uri),
      catch: parseErrorFromCause,
    }),
});

const compileWithCucumber = (source: string, uri: string): ParsedSource => {
  const newId = IdGenerator.incrementing();
  const parser = new Parser(new AstBuilder(newId), new GherkinClassicTokenMatcher());
  const document = parser.parse(source);
  return {
    document,
    pickles: compile(document, uri, newId),
  };
};

const parseErrorFromCause = (cause: unknown): ParseError => {
  const location = causeLocation(cause);
  return new ParseError({
    message: causeMessage(cause),
    line: locationLine(location),
    column: locationColumn(location),
  });
};

const causeMessage = (cause: unknown): string =>
  Predicate.isError(cause) ? cause.message : String(cause);

const locationLine = (location: { readonly line: number } | undefined): number =>
  location?.line ?? 1;

const locationColumn = (location: { readonly column?: number } | undefined): number =>
  location?.column ?? 1;

const causeLocation = (
  cause: unknown,
): { readonly line: number; readonly column?: number } | undefined => {
  const firstError = firstNestedError(cause);
  return firstError === undefined ? locationFromCause(cause) : causeLocation(firstError);
};

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

const firstNestedError = (cause: unknown): unknown | undefined =>
  isObject(cause) && "errors" in cause && Arr.isArray(cause.errors) ? cause.errors[0] : undefined;

const locationFromCause = (
  cause: unknown,
): { readonly line: number; readonly column?: number } | undefined =>
  isObject(cause) && "location" in cause ? normalizeLocation(cause.location) : undefined;

const normalizeLocation = (
  location: unknown,
): { readonly line: number; readonly column?: number } | undefined => {
  if (!hasLine(location)) {
    return undefined;
  }
  const column = numericColumn(location);
  return column === undefined ? { line: location.line } : { line: location.line, column };
};

const hasLine = (
  location: unknown,
): location is { readonly line: number; readonly column?: unknown } =>
  isObject(location) && "line" in location && typeof location.line === "number";

const numericColumn = (location: { readonly column?: unknown }): number | undefined =>
  "column" in location && typeof location.column === "number" ? location.column : undefined;
