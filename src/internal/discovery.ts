import type { Pickle } from "@cucumber/messages";
import * as Arr from "effect/Array";
import type * as Duration from "effect/Duration";
import type * as Effect from "effect/Effect";
import * as Fn from "effect/Function";
import type * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import * as Result from "effect/Result";
import type { MatchResult } from "./expression.ts";
import * as Parser from "./parser.ts";

/** @internal */
export type ConcreteStepKind = "Given" | "When" | "Then";

interface Expression<A> {
  readonly source: string;
  readonly match: (text: string) => Option.Option<A>;
  readonly matchDetailed?: (text: string) => MatchResult<A>;
}

/** @internal */
export interface DataTableInput {
  readonly rows: ReadonlyArray<{
    readonly cells: ReadonlyArray<{
      readonly value: string;
    }>;
  }>;
}

/** @internal */
export interface DocStringInput {
  readonly content: string;
}

/** @internal */
export interface TableArg<A> {
  readonly _tag: "TableArg";
  readonly decode: (table: DataTableInput) => Effect.Effect<A, unknown>;
}

/** @internal */
export interface DocStringArg<A> {
  readonly _tag: "DocStringArg";
  readonly decode: (docString: DocStringInput) => Effect.Effect<A, unknown>;
}

/** @internal */
export type StepArg<A> = TableArg<A> | DocStringArg<A>;

/** @internal */
export interface AnyStep<R = unknown> {
  readonly kind: "Step" | ConcreteStepKind;
  readonly expression: Expression<unknown>;
  readonly argument?: StepArg<unknown>;
  readonly timeout?: Duration.Duration;
  readonly run: (
    captures: unknown,
    argument: unknown,
    state: unknown,
  ) => Effect.Effect<unknown, unknown, R>;
}

interface ScenarioDefinition<R = unknown> {
  readonly title: string;
  readonly steps: ReadonlyArray<AnyStep<R>>;
  readonly providers: ReadonlyArray<Layer.Layer<unknown, unknown, R>>;
}

/** @internal */
export interface FeatureDefinition<E, R> {
  readonly title: string;
  readonly scenarios: ReadonlyArray<ScenarioDefinition<R>>;
  readonly _E?: E;
  readonly _R?: R;
}

/** @internal */
export interface ScenarioTask<E, R> {
  readonly featureDefinition: FeatureDefinition<E, R>;
  readonly scenarioDefinition: ScenarioDefinition<R>;
  readonly featureTitle: string;
  readonly scenarioTitle: string;
  readonly sourceScenarioTitle: string;
  readonly scenarioIndex: number;
  readonly scenarioLine: number;
  readonly ruleTitle?: string;
  readonly ruleLine?: number;
  readonly tags: ReadonlyArray<string>;
  readonly pickle: Pickle;
  readonly source: Parser.SourceIndex;
}

interface ResolvedPickle {
  readonly pickle: Pickle;
  readonly scenarioIndex: number;
  readonly scenarioTitle: string;
  readonly scenarioLine: number;
  readonly sourceScenarioId: string;
  readonly rule: ReturnType<typeof resolveRule>;
}

/** @internal */
export type DiscoveryIssue =
  | {
      readonly _tag: "FeatureTitleMismatch";
      readonly definitionTitle: string;
      readonly featureTitle: string;
      readonly line: number;
    }
  | {
      readonly _tag: "DuplicateScenarioDefinition";
      readonly scenarioTitle: string;
    }
  | {
      readonly _tag: "DuplicateSourceScenario";
      readonly scenarioTitle: string;
      readonly scenarioLine: number;
    }
  | {
      readonly _tag: "UnmatchedScenario";
      readonly scenarioTitle: string;
      readonly scenarioLine: number;
      readonly candidates: ReadonlyArray<string>;
    }
  | {
      readonly _tag: "UnusedScenarioDefinition";
      readonly scenarioTitle: string;
      readonly candidates: ReadonlyArray<string>;
    };

/** @internal */
export interface DiscoveryResult<E, R> {
  readonly tasks: ReadonlyArray<ScenarioTask<E, R>>;
  readonly issues: ReadonlyArray<DiscoveryIssue>;
}

/**
 * Builds scenario tasks and collects discovery issues in deterministic order:
 * source-scenario issues first, in source order, then unused definitions in
 * feature-definition order. Structural feature and duplicate-definition issues
 * short-circuit because no valid task set can be built.
 *
 * @internal
 */
export const buildScenarioTasks = <E, R>(
  featureDefinition: FeatureDefinition<E, R>,
  feature: Parser.CompiledFeature,
): DiscoveryResult<E, R> => {
  if (featureDefinition.title !== feature.name) {
    return {
      tasks: [],
      issues: [
        {
          _tag: "FeatureTitleMismatch",
          definitionTitle: featureDefinition.title,
          featureTitle: feature.name,
          line: feature.line,
        },
      ],
    };
  }

  const duplicateScenario = firstDuplicateTitle(
    Arr.map(featureDefinition.scenarios, (scenario) => scenario.title),
  );
  if (Option.isSome(duplicateScenario)) {
    return {
      tasks: [],
      issues: [
        {
          _tag: "DuplicateScenarioDefinition",
          scenarioTitle: duplicateScenario.value,
        },
      ],
    };
  }

  const scenarioDefinitions = scenarioDefinitionMap(featureDefinition);
  const resolved = Arr.map(feature.pickles, resolvePickle(feature));
  const built = Arr.map(resolved, (entry): ScenarioTask<E, R> | DiscoveryIssue => {
    if (duplicateSourceScenario(resolved, entry)) {
      return {
        _tag: "DuplicateSourceScenario",
        scenarioTitle: entry.scenarioTitle,
        scenarioLine: entry.scenarioLine,
      };
    }
    const scenarioDefinition = Record.get(scenarioDefinitions, entry.scenarioTitle);
    if (Option.isNone(scenarioDefinition)) {
      return {
        _tag: "UnmatchedScenario",
        scenarioTitle: entry.scenarioTitle,
        scenarioLine: entry.scenarioLine,
        candidates: Arr.map(featureDefinition.scenarios, (scenario) => scenario.title),
      };
    }
    return {
      featureDefinition,
      scenarioDefinition: scenarioDefinition.value,
      featureTitle: feature.name,
      scenarioTitle: entry.pickle.name,
      sourceScenarioTitle: entry.scenarioTitle,
      scenarioIndex: entry.scenarioIndex,
      scenarioLine: entry.scenarioLine,
      ...(entry.rule === undefined
        ? {}
        : {
            ruleTitle: entry.rule.name,
            ruleLine: entry.rule.location.line,
          }),
      tags: Arr.map(entry.pickle.tags, (tag) => tag.name),
      pickle: entry.pickle,
      source: feature.source,
    };
  });
  const tasks = Arr.filterMap(built, (entry) =>
    "_tag" in entry ? Result.fail(undefined) : Result.succeed(entry),
  );
  // A definition is used only when discovery successfully builds at least one task for it.
  const usedScenarioTitles = Arr.map(tasks, (task) => task.sourceScenarioTitle);
  const unused = Fn.pipe(
    featureDefinition.scenarios,
    Arr.filter((scenario) => !Arr.contains(scenario.title)(usedScenarioTitles)),
    Arr.map(
      (scenario): DiscoveryIssue => ({
        _tag: "UnusedScenarioDefinition",
        scenarioTitle: scenario.title,
        candidates: Arr.map(resolved, (entry) => entry.scenarioTitle),
      }),
    ),
  );
  const issues = Fn.pipe(
    built,
    Arr.filterMap((entry) => ("_tag" in entry ? Result.succeed(entry) : Result.fail(undefined))),
    Arr.appendAll(unused),
  );
  return { tasks, issues };
};

const firstDuplicateTitle = (titles: ReadonlyArray<string>): Option.Option<string> =>
  Fn.pipe(
    titles,
    Arr.findFirst((title, index) => Arr.contains(title)(Arr.take(titles, index))),
  );

const resolvePickle =
  (feature: Parser.CompiledFeature) =>
  (pickle: Pickle, scenarioIndex: number): ResolvedPickle => {
    const source = Parser.findScenario(pickle, feature.source);
    return {
      pickle,
      scenarioIndex,
      scenarioTitle: Fn.pipe(
        source,
        Option.map(({ scenario }) => scenario.name),
        Option.getOrElse(() => pickle.name),
      ),
      scenarioLine:
        pickle.location?.line ??
        Fn.pipe(
          source,
          Option.map(({ scenario }) => scenario.location.line),
          Option.getOrElse(() => feature.line),
        ),
      sourceScenarioId: Fn.pipe(
        source,
        Option.map(({ scenario }) => scenario.id),
        Option.getOrElse(() => pickle.id),
      ),
      rule: resolveRule(source),
    };
  };

const resolveRule = (
  source: Option.Option<{
    readonly rule:
      | { readonly name: string; readonly location: { readonly line: number } }
      | undefined;
  }>,
) =>
  Fn.pipe(
    source,
    Option.map(({ rule }) => rule),
    Option.getOrUndefined,
  );

const duplicateSourceScenario = (
  resolved: ReadonlyArray<ResolvedPickle>,
  entry: ResolvedPickle,
): boolean =>
  Fn.pipe(
    Arr.take(resolved, entry.scenarioIndex),
    Arr.some(
      (previous) =>
        previous.scenarioTitle === entry.scenarioTitle &&
        previous.sourceScenarioId !== entry.sourceScenarioId,
    ),
  );

const scenarioDefinitionMap = <E, R>(
  featureDefinition: FeatureDefinition<E, R>,
): Record.ReadonlyRecord<string, ScenarioDefinition<R>> =>
  Fn.pipe(
    featureDefinition.scenarios,
    Arr.map((scenario) => [scenario.title, scenario] as const),
    Record.fromEntries,
  );
