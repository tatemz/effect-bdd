import { fromBenchmarkRoot, fromRepoRoot } from "./paths.ts";
import { generatedSuites } from "./generatedSuites.ts";
import type { SuiteDefinition } from "./types.ts";

const fixtureFeature = (name: string): string => fromRepoRoot("test", "fixtures", name);
const exampleFeature = (name: string): string => fromRepoRoot("examples", name);

const gherkinGoodFeatures = [
  "minimal.feature",
  "background.feature",
  "scenario_outline.feature",
  "tags.feature",
  "rule.feature",
  "descriptions.feature",
  "datatables.feature",
  "docstrings.feature",
  "kitchen-sink.feature",
].map(fixtureFeature);

const gherkinGoodEffectModules = [
  fromBenchmarkRoot("effect-bdd", "gherkin-good.steps.ts"),
  fromBenchmarkRoot("effect-bdd", "kitchen-sink.steps.ts"),
];

const cucumberGherkinGoodModules = [
  fromBenchmarkRoot("cucumber", "gherkin-good.steps.ts"),
  fromBenchmarkRoot("cucumber", "kitchen-sink.steps.ts"),
];

export const suites: ReadonlyArray<SuiteDefinition> = [
  {
    id: "gherkin-good",
    name: "Gherkin corpus fixtures",
    description:
      "All checked-in fixture features, mostly copied from Cucumber Gherkin's testdata/good corpus.",
    featurePaths: gherkinGoodFeatures,
    effectBddStepModules: gherkinGoodEffectModules,
    effectBddFeatureModules: gherkinGoodEffectModules,
    cucumberStepModules: cucumberGherkinGoodModules,
  },
  {
    id: "kitchen-sink",
    name: "Kitchen sink",
    description:
      "Effect-specific fixture covering captures, tables, docstrings, rules, services, and outlines.",
    featurePaths: [fixtureFeature("kitchen-sink.feature")],
    effectBddStepModules: [fromBenchmarkRoot("effect-bdd", "kitchen-sink.steps.ts")],
    effectBddFeatureModules: [fromBenchmarkRoot("effect-bdd", "kitchen-sink.steps.ts")],
    cucumberStepModules: [fromBenchmarkRoot("cucumber", "kitchen-sink.steps.ts")],
  },
  {
    id: "counter-example",
    name: "Counter example",
    description: "The package's user-facing counter example with real domain behavior.",
    featurePaths: [exampleFeature("counter.feature")],
    effectBddStepModules: [fromBenchmarkRoot("effect-bdd", "counter.steps.ts")],
    effectBddFeatureModules: [fromBenchmarkRoot("effect-bdd", "counter.steps.ts")],
    cucumberStepModules: [fromBenchmarkRoot("cucumber", "counter.steps.ts")],
  },
  ...generatedSuites,
];

export const suiteById = (id: string): SuiteDefinition | undefined =>
  suites.find((suite) => suite.id === id);
