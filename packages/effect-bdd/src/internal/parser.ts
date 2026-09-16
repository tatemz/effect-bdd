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
import * as Fn from "effect/Function";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
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
  readonly steps: Record.ReadonlyRecord<string, CucumberStep>;
  readonly scenarios: Record.ReadonlyRecord<
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
    Fn.pipe(compiler.compile(source, uri), Effect.flatMap(toFeature)),
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
  const entries = Fn.pipe(document.feature?.children ?? [], Arr.flatMap(indexFeatureChild));
  return {
    steps: Fn.pipe(
      entries,
      Arr.flatMap(({ steps }) => steps),
      Record.fromEntries,
    ),
    scenarios: Fn.pipe(entries, Arr.filterMap(scenarioEntry), Record.fromEntries),
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
  steps: stepsForChild(child),
  scenario: scenarioForChild(child, rule),
});

const stepsForChild = (
  child: CucumberFeatureChild | CucumberRuleChild,
): ReadonlyArray<readonly [string, CucumberStep]> =>
  Fn.pipe([...backgroundSteps(child), ...scenarioSteps(child)], Arr.map(stepEntry));

const backgroundSteps = (
  child: CucumberFeatureChild | CucumberRuleChild,
): ReadonlyArray<CucumberStep> => child.background?.steps ?? [];

const scenarioSteps = (
  child: CucumberFeatureChild | CucumberRuleChild,
): ReadonlyArray<CucumberStep> => child.scenario?.steps ?? [];

const stepEntry = (step: CucumberStep): readonly [string, CucumberStep] => [step.id, step];

const scenarioForChild = (
  child: CucumberFeatureChild | CucumberRuleChild,
  rule: CucumberRule | undefined,
): ScenarioEntry | undefined =>
  child.scenario === undefined ? undefined : { scenario: child.scenario, rule };

const scenarioEntry = (
  child: ChildIndex,
): Result.Result<readonly [string, ScenarioEntry], undefined> =>
  child.scenario === undefined
    ? Result.fail(undefined)
    : Result.succeed([child.scenario.scenario.id, child.scenario] as const);

/** @internal */
export const findScenario = (pickle: Pickle, index: SourceIndex) =>
  Fn.pipe(
    pickle.astNodeIds,
    Option.liftPredicate((ids): ids is ReadonlyArray<string> => ids.length > 0),
    Option.flatMap(() => Arr.findFirst(pickle.astNodeIds, (id) => Record.has(index.scenarios, id))),
    Option.flatMap((id) => Record.get(index.scenarios, id)),
  );

/** @internal */
const findStep = (
  pickleStep: { readonly astNodeIds: ReadonlyArray<string> },
  index: SourceIndex,
): CucumberStep | undefined =>
  Fn.pipe(
    pickleStep.astNodeIds,
    Arr.findFirst((id) => Record.has(index.steps, id)),
    Option.flatMap((id) => Record.get(index.steps, id)),
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

const keywords: Readonly<Record<string, Keyword>> = {
  Given: "Given",
  When: "When",
  Then: "Then",
  And: "And",
  But: "But",
  "*": "*",
};

const normalizeKeyword = (keyword: string): Keyword => keywords[Str.trim(keyword)] ?? "Given";

const parseError = (
  message: string,
  line: number,
  column: number,
): Effect.Effect<never, ParseError> => Effect.fail(new ParseError({ message, line, column }));
