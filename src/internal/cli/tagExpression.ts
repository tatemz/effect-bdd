import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Fn from "effect/Function";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import { DiscoveryError } from "./errors.ts";

/** @internal */
export type TagPredicate = (tags: ReadonlyArray<string>) => boolean;

type Expression =
  | {
      readonly _tag: "Tag";
      readonly tag: string;
    }
  | {
      readonly _tag: "Not";
      readonly expression: Expression;
    }
  | {
      readonly _tag: "And";
      readonly left: Expression;
      readonly right: Expression;
    }
  | {
      readonly _tag: "Or";
      readonly left: Expression;
      readonly right: Expression;
    };

interface ParseResult {
  readonly expression: Expression;
  readonly index: number;
}

/** @internal */
export const compileAll = (
  expressions: ReadonlyArray<string>,
): Effect.Effect<TagPredicate, DiscoveryError> =>
  Effect.forEach(expressions, compile).pipe(
    Effect.map((predicates) => (tags) => Arr.every(predicates, (predicate) => predicate(tags))),
  );

const compile = (expression: string): Effect.Effect<TagPredicate, DiscoveryError> => {
  const tokens = tokenize(expression);
  if (!hasTokens(tokens)) {
    return fail(expression, "Expected a tag expression");
  }
  const result = parseOr(tokens, 0);
  if (!isCompleteParse(result, tokens)) {
    return fail(expression, "Could not parse tag expression");
  }
  return Effect.succeed((tags) => evaluate(result.expression, tags));
};

const hasTokens = (
  tokens: ReadonlyArray<string> | undefined,
): tokens is readonly [string, ...Array<string>] => tokens !== undefined && tokens.length > 0;

const isCompleteParse = (
  result: ParseResult | undefined,
  tokens: ReadonlyArray<string>,
): result is ParseResult => result !== undefined && result.index === tokens.length;

const parseOr = (tokens: ReadonlyArray<string>, index: number): ParseResult | undefined => {
  const left = parseAnd(tokens, index);
  if (left === undefined) {
    return undefined;
  }
  return parseOrRest(tokens, left);
};

const parseOrRest = (tokens: ReadonlyArray<string>, left: ParseResult): ParseResult => {
  if (tokens[left.index] !== "or") {
    return left;
  }
  const right = parseAnd(tokens, left.index + 1);
  if (right === undefined) {
    return left;
  }
  return parseOrRest(tokens, {
    expression: {
      _tag: "Or",
      left: left.expression,
      right: right.expression,
    },
    index: right.index,
  });
};

const parseAnd = (tokens: ReadonlyArray<string>, index: number): ParseResult | undefined => {
  const left = parseUnary(tokens, index);
  if (left === undefined) {
    return undefined;
  }
  return parseAndRest(tokens, left);
};

const parseAndRest = (tokens: ReadonlyArray<string>, left: ParseResult): ParseResult => {
  if (tokens[left.index] !== "and") {
    return left;
  }
  const right = parseUnary(tokens, left.index + 1);
  if (right === undefined) {
    return left;
  }
  return parseAndRest(tokens, {
    expression: {
      _tag: "And",
      left: left.expression,
      right: right.expression,
    },
    index: right.index,
  });
};

const parseUnary = (tokens: ReadonlyArray<string>, index: number): ParseResult | undefined =>
  tokens[index] === "not" ? parseNot(tokens, index) : parsePrimary(tokens, index);

const parseNot = (tokens: ReadonlyArray<string>, index: number): ParseResult | undefined => {
  const result = parseUnary(tokens, index + 1);
  return result === undefined
    ? undefined
    : {
        expression: {
          _tag: "Not",
          expression: result.expression,
        },
        index: result.index,
      };
};

const parsePrimary = (tokens: ReadonlyArray<string>, index: number): ParseResult | undefined => {
  const token = tokens[index];
  return token === undefined ? undefined : parsePrimaryToken(tokens, index, token);
};

const parsePrimaryToken = (
  tokens: ReadonlyArray<string>,
  index: number,
  token: string,
): ParseResult | undefined =>
  token === "(" ? parseParenthesized(tokens, index) : parseTag(token, index);

const parseParenthesized = (
  tokens: ReadonlyArray<string>,
  index: number,
): ParseResult | undefined => {
  const result = parseOr(tokens, index + 1);
  return result !== undefined && tokens[result.index] === ")"
    ? {
        expression: result.expression,
        index: result.index + 1,
      }
    : undefined;
};

const parseTag = (token: string, index: number): ParseResult | undefined =>
  Fn.pipe(token, Str.startsWith("@"))
    ? {
        expression: {
          _tag: "Tag",
          tag: token,
        },
        index: index + 1,
      }
    : undefined;

const evaluate = (expression: Expression, tags: ReadonlyArray<string>): boolean => {
  if (expression._tag === "Tag") {
    return Arr.contains(expression.tag)(tags);
  }
  return evaluateOperator(expression, tags);
};

const evaluateOperator = (
  expression: Exclude<Expression, { readonly _tag: "Tag" }>,
  tags: ReadonlyArray<string>,
): boolean => {
  switch (expression._tag) {
    case "Not": {
      return !evaluate(expression.expression, tags);
    }
    case "And": {
      return evaluateAnd(expression, tags);
    }
    case "Or": {
      return evaluateOr(expression, tags);
    }
  }
};

const evaluateAnd = (
  expression: Extract<Expression, { readonly _tag: "And" }>,
  tags: ReadonlyArray<string>,
): boolean => evaluate(expression.left, tags) && evaluate(expression.right, tags);

const evaluateOr = (
  expression: Extract<Expression, { readonly _tag: "Or" }>,
  tags: ReadonlyArray<string>,
): boolean => evaluate(expression.left, tags) || evaluate(expression.right, tags);

const tokenize = (expression: string): ReadonlyArray<string> | undefined => {
  const matches = Fn.pipe(
    expression,
    Str.match(/\(|\)|\b(?:and|or|not)\b|@[A-Za-z0-9][A-Za-z0-9_-]*/g),
    Option.getOrElse((): ReadonlyArray<string> => []),
  );
  const normalized = Fn.pipe(expression, Str.replace(/\s+/g, ""));
  const matched = Fn.pipe(matches, Arr.join(""));
  return normalized === matched ? matches : undefined;
};

const fail = (expression: string, message: string): Effect.Effect<never, DiscoveryError> =>
  Effect.fail(new DiscoveryError({ message: `${message}: ${expression}` }));
