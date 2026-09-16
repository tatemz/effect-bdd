import type { Pickle } from "@cucumber/messages";
import * as Arr from "effect/Array";
import type * as Duration from "effect/Duration";
import type * as Effect from "effect/Effect";
import * as Fn from "effect/Function";
import type * as Layer from "effect/Layer";
import * as Option from "effect/Option";
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
// oxlint-disable-next-line complexity
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

  const definitions = indexScenarioDefinitions(featureDefinition.scenarios);
  if (definitions.duplicateTitle !== undefined) {
    return {
      tasks: [],
      issues: [
        {
          _tag: "DuplicateScenarioDefinition",
          scenarioTitle: definitions.duplicateTitle,
        },
      ],
    };
  }

  const resolved = Arr.map(feature.pickles, resolvePickle(feature));
  const definitionCandidates = Arr.map(featureDefinition.scenarios, (scenario) => scenario.title);
  const sourceCandidates = Arr.map(resolved, (entry) => entry.scenarioTitle);
  const collection = Arr.reduce(resolved, emptyDiscoveryCollection<E, R>(), (state, entry) =>
    appendResolvedPickle(
      state,
      entry,
      featureDefinition,
      feature,
      definitions.byTitle,
      definitionCandidates,
    ),
  );
  Arr.forEach(featureDefinition.scenarios, (scenario) => {
    if (!hasTitle(collection.usedScenarioTitles, scenario.title)) {
      collection.issues[collection.issues.length] = {
        _tag: "UnusedScenarioDefinition",
        scenarioTitle: scenario.title,
        candidates: sourceCandidates,
      };
    }
  });
  return { tasks: collection.tasks, issues: collection.issues };
};

interface ScenarioDefinitionIndex<R> {
  [title: string]: ScenarioDefinition<R> | undefined;
}

interface IndexedScenarioDefinitions<R> {
  readonly byTitle: ScenarioDefinitionIndex<R>;
  readonly duplicateTitle: string | undefined;
}

const indexScenarioDefinitions = <R>(
  scenarios: ReadonlyArray<ScenarioDefinition<R>>,
): IndexedScenarioDefinitions<R> => {
  const initial: IndexedScenarioDefinitions<R> = {
    byTitle: emptyScenarioDefinitionIndex<R>(),
    duplicateTitle: undefined,
  };
  return Arr.reduce(scenarios, initial, (state, scenario) => {
    if (state.byTitle[scenario.title] !== undefined) {
      return state.duplicateTitle === undefined
        ? { ...state, duplicateTitle: scenario.title }
        : state;
    }
    state.byTitle[scenario.title] = scenario;
    return state;
  });
};

const emptyScenarioDefinitionIndex = <R>(): ScenarioDefinitionIndex<R> => Object.create(null);

interface SourceScenarioIndex {
  [scenarioTitle: string]: string | undefined;
}

interface TitleIndex {
  [title: string]: true | undefined;
}

interface DiscoveryCollection<E, R> {
  readonly tasks: Array<ScenarioTask<E, R>>;
  readonly issues: Array<DiscoveryIssue>;
  readonly sourceScenarioIds: SourceScenarioIndex;
  readonly usedScenarioTitles: TitleIndex;
}

// These mutable indexes are allocated per discovery call and never escape the returned result.
const emptyDiscoveryCollection = <E, R>(): DiscoveryCollection<E, R> => ({
  tasks: [],
  issues: [],
  sourceScenarioIds: Object.create(null),
  usedScenarioTitles: Object.create(null),
});

const appendResolvedPickle = <E, R>(
  collection: DiscoveryCollection<E, R>,
  entry: ResolvedPickle,
  featureDefinition: FeatureDefinition<E, R>,
  feature: Parser.CompiledFeature,
  scenarioDefinitions: ScenarioDefinitionIndex<R>,
  definitionCandidates: ReadonlyArray<string>,
): DiscoveryCollection<E, R> => {
  const previousSourceId = collection.sourceScenarioIds[entry.scenarioTitle];
  if (previousSourceId === undefined) {
    collection.sourceScenarioIds[entry.scenarioTitle] = entry.sourceScenarioId;
  } else if (previousSourceId !== entry.sourceScenarioId) {
    collection.issues[collection.issues.length] = {
      _tag: "DuplicateSourceScenario",
      scenarioTitle: entry.scenarioTitle,
      scenarioLine: entry.scenarioLine,
    };
    return collection;
  }

  const scenarioDefinition = scenarioDefinitions[entry.scenarioTitle];
  if (scenarioDefinition === undefined) {
    collection.issues[collection.issues.length] = {
      _tag: "UnmatchedScenario",
      scenarioTitle: entry.scenarioTitle,
      scenarioLine: entry.scenarioLine,
      candidates: definitionCandidates,
    };
    return collection;
  }

  collection.tasks[collection.tasks.length] = scenarioTask(
    entry,
    featureDefinition,
    feature,
    scenarioDefinition,
  );
  collection.usedScenarioTitles[entry.scenarioTitle] = true;
  return collection;
};

const scenarioTask = <E, R>(
  entry: ResolvedPickle,
  featureDefinition: FeatureDefinition<E, R>,
  feature: Parser.CompiledFeature,
  scenarioDefinition: ScenarioDefinition<R>,
): ScenarioTask<E, R> => ({
  featureDefinition,
  scenarioDefinition,
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
});

const hasTitle = (index: TitleIndex, title: string): boolean => index[title] === true;

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
