import * as Arr from "effect/Array";
import * as Fn from "effect/Function";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import * as Result from "effect/Result";
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
  readonly matchDetailed: (text: string) => MatchResult<unknown>;
}

type MatchResult<A> =
  | {
      readonly _tag: "Matched";
      readonly value: A;
    }
  | {
      readonly _tag: "TextMismatch";
    }
  | {
      readonly _tag: "DecodeMismatch";
      readonly capture: string;
      readonly raw: string;
      readonly cause: unknown;
    };

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
  const decoders = Arr.map(state.captures, (capture) => ({
    name: capture.name,
    decode: Schema.decodeUnknownResult(capture.schema),
  }));
  const matchDetailed = (text: string): MatchResult<unknown> => {
    const match = regex.exec(text);
    if (match === null) {
      return { _tag: "TextMismatch" };
    }
    return decodeCaptures(decoders, match);
  };

  return {
    source: state.source,
    match: (text) => matchResultOption(matchDetailed(text)),
    matchDetailed,
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

interface CaptureDecoder {
  readonly name: string;
  readonly decode: (input: unknown) => Result.Result<unknown, unknown>;
}

// oxlint-disable-next-line complexity
const decodeCaptures = (
  decoders: ReadonlyArray<CaptureDecoder>,
  match: RegExpExecArray,
  index = 0,
  out: Record<string, unknown> = Record.empty(),
): MatchResult<Record<string, unknown>> => {
  if (index >= decoders.length) {
    return { _tag: "Matched", value: out };
  }
  const decoder = decoders[index];
  const raw = match[index + 1] ?? "";
  const decoded = decodeCapture(decoder, raw);
  if (Result.isFailure(decoded)) {
    return decoded.failure;
  }
  return decodeCaptures(decoders, match, index + 1, Record.set(out, decoder.name, decoded.success));
};

const decodeCapture = (
  decoder: CaptureDecoder,
  raw: string,
): Result.Result<unknown, MatchResult<never>> =>
  Fn.pipe(
    decoder.decode(raw),
    Result.mapError(
      (cause): MatchResult<never> => ({
        _tag: "DecodeMismatch",
        capture: decoder.name,
        raw,
        cause,
      }),
    ),
  );

const matchResultOption = (result: MatchResult<unknown>): Option.Option<unknown> => {
  switch (result._tag) {
    case "Matched": {
      return Option.some(result.value);
    }
    case "TextMismatch":
    case "DecodeMismatch": {
      return Option.none();
    }
  }
};

const escapeRegExp = Str.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");
