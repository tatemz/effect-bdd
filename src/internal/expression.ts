import * as Arr from "effect/Array";
import * as Fn from "effect/Function";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

/** @internal */
export interface Capture<Name extends string, A> {
  readonly _tag: "Capture";
  readonly name: Name;
  readonly schema: Schema.Codec<A, string>;
}

/** @internal */
export interface Matcher<_A> {
  readonly source: string;
  readonly match: (text: string) => Option.Option<unknown>;
}

interface MatcherState {
  readonly names: ReadonlyArray<string>;
  readonly captures: ReadonlyArray<Capture<string, unknown>>;
  readonly source: string;
  readonly pattern: string;
}

/** @internal */
export const makeCapture = <const Name extends string, A>(
  name: Name,
  schema: Schema.Codec<A, string>,
): Capture<Name, A> => ({
  _tag: "Capture",
  name,
  schema,
});

/** @internal */
export const makeMatcher = (
  strings: TemplateStringsArray,
  captures: ReadonlyArray<Capture<string, unknown>>,
): Matcher<unknown> => {
  const state = Fn.pipe(
    strings,
    Arr.reduce(initialMatcherState, (state, literal, index) =>
      appendTemplatePart(state, literal, captures[index]),
    ),
  );
  const regex = new globalThis.RegExp(`${state.pattern}$`);
  const decoders = Arr.map(state.captures, (capture) => Schema.decodeUnknownOption(capture.schema));

  return {
    source: state.source,
    match(text) {
      const match = regex.exec(text);
      if (match === null) {
        return Option.none();
      }
      return decodeCaptures(state.names, decoders, match);
    },
  };
};

const initialMatcherState: MatcherState = {
  names: [],
  captures: [],
  source: "",
  pattern: "^",
};

const appendTemplatePart = (
  state: MatcherState,
  literal: string,
  capture: Capture<string, unknown> | undefined,
): MatcherState => {
  const pattern = `${state.pattern}${escapeRegExp(literal)}`;
  const source = `${state.source}${literal}`;
  if (capture === undefined) {
    return { ...state, pattern, source };
  }
  return {
    names: Arr.append(state.names, capture.name),
    captures: Arr.append(state.captures, capture),
    pattern: `${pattern}(.+?)`,
    source: `${source}{${capture.name}}`,
  };
};

const decodeCaptures = (
  names: ReadonlyArray<string>,
  decoders: ReadonlyArray<(input: unknown) => Option.Option<unknown>>,
  match: RegExpExecArray,
  index = 0,
  out: Record<string, unknown> = Record.empty(),
): Option.Option<Record<string, unknown>> => {
  if (index >= names.length) {
    return Option.some(out);
  }
  return Fn.pipe(
    decoders[index](match[index + 1]),
    Option.flatMap((value) =>
      decodeCaptures(names, decoders, match, index + 1, Record.set(out, names[index], value)),
    ),
  );
};

const escapeRegExp = Str.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");
