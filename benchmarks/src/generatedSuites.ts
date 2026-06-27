import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fromBenchmarkRoot } from "./paths.ts";
import type { SuiteDefinition } from "./types.ts";

const generatedRoot = fromBenchmarkRoot("generated");
const generatedFeatureRoot = path.join(generatedRoot, "features");
const generatedEffectRoot = path.join(generatedRoot, "effect-bdd");
const generatedCucumberRoot = path.join(generatedRoot, "cucumber");

export const generatedSuites: ReadonlyArray<SuiteDefinition> = [
  suite(
    "parse-scale",
    "Parse scale",
    "40 generated features with 5 scenarios each.",
    ["parse-scale", "*.feature"],
    generatedFeatureFilePaths(path.join(generatedFeatureRoot, "parse-scale"), 40),
  ),
  suite(
    "outline-scale",
    "Outline scale",
    "One scenario outline expanded to 120 examples.",
    ["outline-scale", "*.feature"],
    [path.join(generatedFeatureRoot, "outline-scale", "outline-scale.feature")],
  ),
  suite(
    "discovery-scale",
    "Discovery scale",
    "40 generated features spread across a nested directory tree.",
    ["discovery-scale", "**", "*.feature"],
    generatedFeatureFilePaths(
      path.join(generatedFeatureRoot, "discovery-scale", "level-a", "level-b"),
      40,
    ),
  ),
  suite(
    "parallel-scale",
    "Parallel scale",
    "One feature with 120 independent no-op scenarios.",
    ["parallel-scale", "*.feature"],
    [path.join(generatedFeatureRoot, "parallel-scale", "parallel-scale.feature")],
  ),
  suite(
    "reporter-overhead",
    "Reporter overhead",
    "One feature with 80 scenarios to amplify scenario event and JSON report costs.",
    ["reporter-overhead", "*.feature"],
    [path.join(generatedFeatureRoot, "reporter-overhead", "reporter-overhead.feature")],
  ),
];

export const ensureGeneratedSuites = async (): Promise<void> => {
  await fs.mkdir(generatedFeatureRoot, { recursive: true });
  await fs.mkdir(generatedEffectRoot, { recursive: true });
  await fs.mkdir(generatedCucumberRoot, { recursive: true });
  await Promise.all([
    writeParseScale(),
    writeOutlineScale(),
    writeDiscoveryScale(),
    writeParallelScale(),
    writeReporterOverhead(),
  ]);
};

function suite(
  id: string,
  name: string,
  description: string,
  featureSegments: ReadonlyArray<string>,
  apiFeaturePaths: ReadonlyArray<string>,
): SuiteDefinition {
  return {
    id,
    name,
    description,
    featurePaths: [path.join(generatedFeatureRoot, ...featureSegments)],
    apiFeaturePaths,
    effectBddStepModules: [path.join(generatedEffectRoot, `${id}.steps.ts`)],
    effectBddFeatureModules: [path.join(generatedEffectRoot, `${id}.steps.ts`)],
    cucumberStepModules: [path.join(generatedCucumberRoot, `${id}.steps.ts`)],
    generated: true,
    supportsCompiled: false,
  };
}

function generatedFeatureFilePaths(
  featureRoot: string,
  featureCount: number,
): ReadonlyArray<string> {
  return Array.from({ length: featureCount }, (_, index) =>
    path.join(featureRoot, `feature-${String(index + 1).padStart(3, "0")}.feature`),
  );
}

const writeParseScale = (): Promise<void> =>
  writeManyFeatureSuite({
    id: "parse-scale",
    featureRoot: path.join(generatedFeatureRoot, "parse-scale"),
    featureCount: 40,
    scenariosPerFeature: 5,
  });

const writeDiscoveryScale = (): Promise<void> =>
  writeManyFeatureSuite({
    id: "discovery-scale",
    featureRoot: path.join(generatedFeatureRoot, "discovery-scale", "level-a", "level-b"),
    featureCount: 40,
    scenariosPerFeature: 3,
  });

const writeParallelScale = (): Promise<void> =>
  writeSingleFeatureSuite({
    id: "parallel-scale",
    featureTitle: "Parallel scale",
    scenarioCount: 120,
  });

const writeReporterOverhead = (): Promise<void> =>
  writeSingleFeatureSuite({
    id: "reporter-overhead",
    featureTitle: "Reporter overhead",
    scenarioCount: 80,
  });

const writeOutlineScale = async (): Promise<void> => {
  const id = "outline-scale";
  const featureTitle = "Outline scale";
  const featureDir = path.join(generatedFeatureRoot, id);
  await fs.mkdir(featureDir, { recursive: true });
  await fs.writeFile(
    path.join(featureDir, "outline-scale.feature"),
    [
      `Feature: ${featureTitle}`,
      "",
      "  Scenario Outline: generated outline",
      "    Given generated value <value>",
      "",
      "    Examples:",
      "      | value |",
      ...Array.from({ length: 120 }, (_, index) => `      | ${index + 1} |`),
      "",
    ].join("\n"),
  );
  await writeGeneratedCucumberSteps(id, "generated value {int}", 1);
  await fs.writeFile(
    path.join(generatedEffectRoot, `${id}.steps.ts`),
    [
      'import { Bdd } from "effect-bdd";',
      'import { Effect, Schema } from "effect";',
      "",
      'const value = Bdd.capture("value", Schema.FiniteFromString);',
      "const generatedStep = Bdd.given`generated value ${value}`(() => Effect.void);",
      "",
      `export const feature = Bdd.feature("${featureTitle}").pipe(`,
      '  Bdd.scenario("generated outline").pipe(generatedStep),',
      ");",
      "",
    ].join("\n"),
  );
};

const writeManyFeatureSuite = async (options: {
  readonly id: string;
  readonly featureRoot: string;
  readonly featureCount: number;
  readonly scenariosPerFeature: number;
}): Promise<void> => {
  await fs.mkdir(options.featureRoot, { recursive: true });
  const features = Array.from({ length: options.featureCount }, (_, index) => ({
    title: `${titleCase(options.id)} ${index + 1}`,
    file: path.join(options.featureRoot, `feature-${String(index + 1).padStart(3, "0")}.feature`),
  }));
  await Promise.all(
    features.map((feature) =>
      fs.writeFile(feature.file, featureText(feature.title, options.scenariosPerFeature)),
    ),
  );
  await writeGeneratedCucumberSteps(options.id, "a generated step", 0);
  await fs.writeFile(
    path.join(generatedEffectRoot, `${options.id}.steps.ts`),
    effectBddManyFeatures(
      features.map((feature) => feature.title),
      options.scenariosPerFeature,
    ),
  );
};

const writeSingleFeatureSuite = async (options: {
  readonly id: string;
  readonly featureTitle: string;
  readonly scenarioCount: number;
}): Promise<void> => {
  const featureDir = path.join(generatedFeatureRoot, options.id);
  await fs.mkdir(featureDir, { recursive: true });
  await fs.writeFile(
    path.join(featureDir, `${options.id}.feature`),
    featureText(options.featureTitle, options.scenarioCount),
  );
  await writeGeneratedCucumberSteps(options.id, "a generated step", 0);
  await fs.writeFile(
    path.join(generatedEffectRoot, `${options.id}.steps.ts`),
    effectBddManyFeatures([options.featureTitle], options.scenarioCount),
  );
};

const featureText = (featureTitle: string, scenarioCount: number): string =>
  [
    `Feature: ${featureTitle}`,
    "",
    ...Array.from({ length: scenarioCount }, (_, index) => [
      `  Scenario: generated scenario ${index + 1}`,
      "    Given a generated step",
      "",
    ]).flat(),
  ].join("\n");

const writeGeneratedCucumberSteps = (
  id: string,
  pattern: string,
  captureCount: number,
): Promise<void> =>
  fs.writeFile(
    path.join(generatedCucumberRoot, `${id}.steps.ts`),
    [
      'import { Given } from "@cucumber/cucumber";',
      'import "../../cucumber/world.ts";',
      "",
      `Given("${pattern}", function (${captureArguments(captureCount)}) {`,
      "  return undefined;",
      "});",
      "",
    ].join("\n"),
  );

const captureArguments = (count: number): string =>
  Array.from({ length: count }, (_, index) => `_value${index + 1}: unknown`).join(", ");

const effectBddManyFeatures = (
  featureTitles: ReadonlyArray<string>,
  scenariosPerFeature: number,
): string =>
  [
    'import { Bdd } from "effect-bdd";',
    'import { Effect } from "effect";',
    "",
    "const generatedStep = Bdd.given`a generated step`(() => Effect.void);",
    "",
    ...featureTitles.map((title, featureIndex) =>
      [
        `export const feature${featureIndex + 1} = Bdd.feature("${title}").pipe(`,
        Array.from(
          { length: scenariosPerFeature },
          (_, scenarioIndex) =>
            `  Bdd.scenario("generated scenario ${scenarioIndex + 1}").pipe(generatedStep),`,
        ).join("\n"),
        ");",
        "",
      ].join("\n"),
    ),
  ].join("\n");

const titleCase = (value: string): string =>
  value
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
