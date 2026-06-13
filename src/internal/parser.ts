import type {
  FeatureChild as CucumberFeatureChild,
  GherkinDocument,
  Pickle,
  Rule as CucumberRule,
  RuleChild as CucumberRuleChild,
  Scenario as CucumberScenario,
  Step as CucumberStep,
} from "@cucumber/messages";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Str from "effect/String";
import { ParseError } from "../Errors.ts";

/** @internal */
export type Keyword = "Given" | "When" | "Then" | "And" | "But" | "*";

/** @internal */
export interface CompiledFeature {
  readonly name: string;
  readonly line: number;
  readonly pickles: ReadonlyArray<Pickle>;
  readonly source: SourceIndex;
}

/**
 * The parsed Gherkin document and compiled pickles produced by a
 * `GherkinCompiler` implementation.
 *
 * Not marked internal because it is part of the public `GherkinCompiler`
 * service contract re-exported from `Bdd.ts`.
 */
export interface ParsedSource {
  readonly document: GherkinDocument;
  readonly pickles: ReadonlyArray<Pickle>;
}

/**
 * Service used to compile Gherkin source into executable scenarios.
 *
 * Not marked internal because it is re-exported as public API from `Bdd.ts`;
 * `stripInternal` would otherwise remove it from the emitted declarations.
 */
export class GherkinCompiler extends Context.Service<
  GherkinCompiler,
  {
    readonly compile: (source: string, uri: string) => Effect.Effect<ParsedSource, ParseError>;
  }
>()("effect-bdd/GherkinCompiler") {}

/** @internal */
export interface SourceIndex {
  readonly steps: ReadonlyMap<string, CucumberStep>;
  readonly scenarios: ReadonlyMap<
    string,
    {
      readonly scenario: CucumberScenario;
      readonly rule: CucumberRule | undefined;
    }
  >;
}

/** @internal */
export const parse = (
  source: string,
  uri = "<inline>",
): Effect.Effect<CompiledFeature, ParseError, GherkinCompiler> =>
  Effect.flatMap(GherkinCompiler, (compiler) =>
    pipe(compiler.compile(source, uri), Effect.flatMap(toFeature)),
  );

const toFeature: (parsed: ParsedSource) => Effect.Effect<CompiledFeature, ParseError> =
  Effect.fnUntraced(function* (parsed) {
    const feature = parsed.document.feature;
    if (feature === undefined) {
      return yield* parseError("Expected a Feature declaration", 1, 1);
    }
    if (parsed.pickles.length === 0) {
      return yield* parseError(
        "Expected at least one Scenario",
        feature.location.line,
        feature.location.column ?? 1,
      );
    }

    const source = indexDocument(parsed.document);
    return {
      name: feature.name,
      line: feature.location.line,
      pickles: parsed.pickles,
      source,
    };
  });

interface ScenarioEntry {
  readonly scenario: CucumberScenario;
  readonly rule: CucumberRule | undefined;
}

const indexDocument = (document: GherkinDocument): SourceIndex => {
  const entries = pipe(document.feature?.children ?? [], Arr.flatMap(indexFeatureChild));
  return {
    steps: new Map(
      pipe(
        entries,
        Arr.flatMap(({ steps }) => steps),
      ),
    ),
    scenarios: new Map(pipe(entries, Arr.filterMap(scenarioEntry))),
  };
};

interface ChildIndex {
  readonly steps: ReadonlyArray<readonly [string, CucumberStep]>;
  readonly scenario: ScenarioEntry | undefined;
}

const indexFeatureChild = (child: CucumberFeatureChild): ReadonlyArray<ChildIndex> =>
  child.rule === undefined
    ? [indexScenarioChild(child, undefined)]
    : Arr.map(child.rule.children, (ruleChild) => indexScenarioChild(ruleChild, child.rule));

const indexScenarioChild = (
  child: CucumberFeatureChild | CucumberRuleChild,
  rule: CucumberRule | undefined,
): ChildIndex => ({
  steps: pipe(
    [...(child.background?.steps ?? []), ...(child.scenario?.steps ?? [])],
    Arr.map((step) => [step.id, step] as const),
  ),
  scenario: child.scenario === undefined ? undefined : { scenario: child.scenario, rule },
});

const scenarioEntry = (
  child: ChildIndex,
): Result.Result<readonly [string, ScenarioEntry], undefined> =>
  child.scenario === undefined
    ? Result.fail(undefined)
    : Result.succeed([child.scenario.scenario.id, child.scenario] as const);

/** @internal */
export const findScenario = (pickle: Pickle, index: SourceIndex) =>
  pipe(
    pickle.astNodeIds,
    Option.liftPredicate((ids): ids is ReadonlyArray<string> => ids.length > 0),
    Option.flatMap(() => Arr.findFirst(pickle.astNodeIds, (id) => index.scenarios.has(id))),
    Option.flatMap((id) => Option.fromNullishOr(index.scenarios.get(id))),
  );

/** @internal */
export const findStep = (
  pickleStep: { readonly astNodeIds: ReadonlyArray<string> },
  index: SourceIndex,
): CucumberStep | undefined =>
  pipe(
    pickleStep.astNodeIds,
    Arr.findFirst((id) => index.steps.has(id)),
    Option.flatMap((id) => Option.fromNullishOr(index.steps.get(id))),
    Option.getOrUndefined,
  );

/** @internal */
export const stepLine = (
  step: { readonly astNodeIds: ReadonlyArray<string> },
  index: SourceIndex,
): number => findStep(step, index)?.location.line ?? 1;

/** @internal */
export const stepKeyword = (
  step: { readonly astNodeIds: ReadonlyArray<string> },
  index: SourceIndex,
): Keyword => {
  const source = findStep(step, index);
  return source === undefined ? "Given" : normalizeKeyword(source.keyword);
};

const normalizeKeyword = (keyword: string): Keyword => {
  const trimmed = Str.trim(keyword);
  return trimmed === "*" ? "*" : (trimmed as Keyword);
};

const parseError = (
  message: string,
  line: number,
  column: number,
): Effect.Effect<never, ParseError> => Effect.fail(new ParseError({ message, line, column }));
