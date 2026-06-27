import { fromBenchmarkRoot, fromRepoRoot } from "./paths.ts";
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
  fromRepoRoot("test", "fixtures", "gherkin-good.step.ts"),
  fromRepoRoot("test", "fixtures", "kitchen-sink.step.ts"),
];

const cucumberStepModule = fromBenchmarkRoot("cucumber", "steps.ts");

export const suites: ReadonlyArray<SuiteDefinition> = [
  {
    id: "gherkin-good",
    name: "Gherkin corpus fixtures",
    description:
      "All checked-in fixture features, mostly copied from Cucumber Gherkin's testdata/good corpus.",
    featurePaths: gherkinGoodFeatures,
    effectBddStepModules: gherkinGoodEffectModules,
    effectBddFeatureModules: gherkinGoodEffectModules,
    cucumberStepModules: [cucumberStepModule],
  },
  {
    id: "kitchen-sink",
    name: "Kitchen sink",
    description:
      "Effect-specific fixture covering captures, tables, docstrings, rules, services, and outlines.",
    featurePaths: [fixtureFeature("kitchen-sink.feature")],
    effectBddStepModules: [fromRepoRoot("test", "fixtures", "kitchen-sink.step.ts")],
    effectBddFeatureModules: [fromRepoRoot("test", "fixtures", "kitchen-sink.step.ts")],
    cucumberStepModules: [cucumberStepModule],
  },
  {
    id: "counter-example",
    name: "Counter example",
    description: "The package's user-facing counter example with real domain behavior.",
    featurePaths: [exampleFeature("counter.feature")],
    effectBddStepModules: [fromRepoRoot("examples", "counter.steps.ts")],
    effectBddFeatureModules: [fromRepoRoot("examples", "counter.steps.ts")],
    cucumberStepModules: [cucumberStepModule],
  },
];

export const suiteById = (id: string): SuiteDefinition | undefined =>
  suites.find((suite) => suite.id === id);
