import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { durationStats, percentDelta, round } from "./statistics.ts";
import { resultsRoot } from "./paths.ts";
import type {
  BenchmarkResult,
  DurationStats,
  RunPhaseDurations,
  RunnerStats,
  SuiteResult,
} from "./types.ts";

const main = async (): Promise<void> => {
  const { inputFile, markdownFile, htmlFile } = parseCli();
  const result = parseBenchmarkResult(JSON.parse(await fs.readFile(inputFile, "utf8")));
  await fs.mkdir(path.dirname(markdownFile), { recursive: true });
  await fs.mkdir(path.dirname(htmlFile), { recursive: true });
  await fs.writeFile(markdownFile, renderMarkdown(result));
  await fs.writeFile(htmlFile, renderHtml(result));
  console.log(`Wrote ${markdownFile}`);
  console.log(`Wrote ${htmlFile}`);
};

const parseCli = (): {
  readonly inputFile: string;
  readonly markdownFile: string;
  readonly htmlFile: string;
} => {
  const parsed = parseArgs({
    args: normalizedArgs(),
    options: {
      input: { type: "string", default: path.join(resultsRoot, "latest.json") },
      markdown: { type: "string", default: path.join(resultsRoot, "latest.md") },
      html: { type: "string", default: path.join(resultsRoot, "latest.html") },
    },
  });
  return {
    inputFile: parsed.values.input,
    markdownFile: parsed.values.markdown,
    htmlFile: parsed.values.html,
  };
};

const normalizedArgs = (): ReadonlyArray<string> =>
  process.argv.slice(2).filter((arg) => arg !== "--");

export const renderMarkdown = (result: BenchmarkResult): string => {
  const lines = [
    "# effect-bdd vs Cucumber Benchmark",
    "",
    `Generated: ${result.generatedAt}`,
    "",
    `Environment: ${result.environment.node}, ${result.environment.platform}/${result.environment.arch}, ${result.environment.cpuCount} x ${result.environment.cpuModel}`,
    "",
    `Config: ${result.config.warmups} warmup run(s), ${result.config.iterations} measured run(s), parallel=${result.config.parallel}, profile=${result.config.profile}`,
    "",
    `Git commit: ${result.environment.gitCommit}`,
    "",
    "CLI wall time is the cross-runner comparison. Runner work is diagnostic only: effect-bdd reports its execution phase, while cucumber-js reports summed step duration. The in-process effect-bdd API is shown separately as a non-CLI baseline.",
    "",
    "## Headline",
    "",
    ...result.suites.flatMap(renderMarkdownHeadline),
    "",
    "## Suite Details",
    "",
    ...result.suites.flatMap(renderMarkdownSuite),
  ];
  return `${lines.join("\n")}\n`;
};

const renderMarkdownHeadline = (suite: SuiteResult): ReadonlyArray<string> => {
  const effect = statsFor(suite, "effect-bdd-cli");
  const cucumber = statsFor(suite, "cucumber-js");
  const delta = percentDelta(cucumber.wall.medianMillis, effect.wall.medianMillis);
  const direction = delta <= 0 ? "faster" : "slower";
  if (effect.stability === "low" || cucumber.stability === "low") {
    return [
      `- ${suite.name}: low-stability smoke result. Wall median: \`effect-bdd\` CLI ${formatMillis(effect.wall.medianMillis)} vs cucumber-js ${formatMillis(cucumber.wall.medianMillis)}. Do not publish a speed claim from this run.`,
    ];
  }
  return [
    `- ${suite.name}: \`effect-bdd\` CLI wall median ${formatMillis(effect.wall.medianMillis)} vs cucumber-js ${formatMillis(cucumber.wall.medianMillis)} (${round(Math.abs(delta))}% ${direction}, ${effect.stability} measurement stability).`,
  ];
};

const renderMarkdownSuite = (suite: SuiteResult): ReadonlyArray<string> => [
  `### ${suite.name}`,
  "",
  suite.description,
  "",
  "| CLI runner | Stability | Runner work metric | Wall median | Wall p95 | Wall CV | Work median | Wall scenarios/sec | Work scenarios/sec | Runs |",
  "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...cliStats(suite).map(
    (stats) =>
      `| ${stats.runner} | ${stats.stability} | ${runnerWorkLabel(stats.runner)} | ${formatMillis(stats.wall.medianMillis)} | ${formatMillis(stats.wall.p95Millis)} | ${round(stats.wall.coefficientOfVariation, 3)} | ${formatOptionalMillis(stats.execution?.medianMillis)} | ${round(stats.wallScenariosPerSecond)} | ${formatOptionalNumber(stats.executionScenariosPerSecond)} | ${stats.runs} |`,
  ),
  "",
  ...renderMarkdownApiBaseline(suite),
  ...renderMarkdownPhases(suite),
];

const renderMarkdownApiBaseline = (suite: SuiteResult): ReadonlyArray<string> => {
  const api = statsFor(suite, "effect-bdd-api");
  return [
    "In-process effect-bdd API baseline (not CLI-comparable):",
    "",
    "| Runner | Stability | In-process median | In-process p95 | Scenarios/sec | Runs |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    `| ${api.runner} | ${api.stability} | ${formatMillis(api.wall.medianMillis)} | ${formatMillis(api.wall.p95Millis)} | ${round(api.wallScenariosPerSecond)} | ${api.runs} |`,
    "",
  ];
};

const renderMarkdownPhases = (suite: SuiteResult): ReadonlyArray<string> => {
  const phases = measuredPhaseStats(suite);
  if (phases.length === 0) {
    return [];
  }
  return [
    "effect-bdd CLI phase timing across measured runs:",
    "",
    ...phases.map(
      (phase) =>
        `- ${phase.label}: median ${formatMillis(phase.stats.medianMillis)}, p95 ${formatMillis(phase.stats.p95Millis)}`,
    ),
    "",
  ];
};

export const renderHtml = (result: BenchmarkResult): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>effect-bdd vs Cucumber Benchmark</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.45; }
      table { border-collapse: collapse; width: 100%; margin: 1rem 0 2rem; }
      th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: right; }
      th:first-child, td:first-child { text-align: left; }
      .note { max-width: 72rem; }
    </style>
  </head>
  <body>
    <h1>effect-bdd vs Cucumber Benchmark</h1>
    <p>Generated: ${escapeHtml(result.generatedAt)}</p>
    <p>Environment: ${escapeHtml(`${result.environment.node}, ${result.environment.platform}/${result.environment.arch}, ${result.environment.cpuCount} x ${result.environment.cpuModel}`)}</p>
    <p>Config: ${result.config.warmups} warmup run(s), ${result.config.iterations} measured run(s), parallel=${result.config.parallel}, profile=${escapeHtml(result.config.profile)}</p>
    <p>Git commit: ${escapeHtml(result.environment.gitCommit)}</p>
    <p class="note">CLI wall time is the cross-runner comparison. Runner work is diagnostic only: effect-bdd reports its execution phase, while cucumber-js reports summed step duration. The in-process effect-bdd API is shown separately as a non-CLI baseline.</p>
${result.suites.map(renderHtmlSuite).join("\n")}
  </body>
</html>
`;

const renderHtmlSuite = (suite: SuiteResult): string => `    <h2>${escapeHtml(suite.name)}</h2>
    <p>${escapeHtml(suite.description)}</p>
    <table>
      <thead>
        <tr><th>CLI runner</th><th>Stability</th><th>Runner work metric</th><th>Wall median</th><th>Wall p95</th><th>Wall CV</th><th>Work median</th><th>Wall scenarios/sec</th><th>Work scenarios/sec</th><th>Runs</th></tr>
      </thead>
      <tbody>
${cliStats(suite).map(renderHtmlStats).join("\n")}
      </tbody>
    </table>
${renderHtmlApiBaseline(suite)}
${renderHtmlPhases(suite)}`;

const renderHtmlStats = (stats: RunnerStats): string => `        <tr>
          <td>${escapeHtml(stats.runner)}</td>
          <td>${stats.stability}</td>
          <td>${escapeHtml(runnerWorkLabel(stats.runner))}</td>
          <td>${formatMillis(stats.wall.medianMillis)}</td>
          <td>${formatMillis(stats.wall.p95Millis)}</td>
          <td>${round(stats.wall.coefficientOfVariation, 3)}</td>
          <td>${formatOptionalMillis(stats.execution?.medianMillis)}</td>
          <td>${round(stats.wallScenariosPerSecond)}</td>
          <td>${formatOptionalNumber(stats.executionScenariosPerSecond)}</td>
          <td>${stats.runs}</td>
        </tr>`;

const renderHtmlApiBaseline = (suite: SuiteResult): string => {
  const api = statsFor(suite, "effect-bdd-api");
  return `    <h3>In-process effect-bdd API baseline</h3>
    <p class="note">This baseline avoids subprocess startup, CLI discovery, and reporter work. It is not directly comparable to either CLI runner.</p>
    <table>
      <thead>
        <tr><th>Runner</th><th>Stability</th><th>In-process median</th><th>In-process p95</th><th>Scenarios/sec</th><th>Runs</th></tr>
      </thead>
      <tbody>
        <tr><td>${escapeHtml(api.runner)}</td><td>${api.stability}</td><td>${formatMillis(api.wall.medianMillis)}</td><td>${formatMillis(api.wall.p95Millis)}</td><td>${round(api.wallScenariosPerSecond)}</td><td>${api.runs}</td></tr>
      </tbody>
    </table>`;
};

const renderHtmlPhases = (suite: SuiteResult): string => {
  const phases = measuredPhaseStats(suite);
  if (phases.length === 0) {
    return "";
  }
  return `    <p>effect-bdd CLI phase timing across measured runs: ${phases
    .map(
      (phase) =>
        `${escapeHtml(phase.label)} median ${formatMillis(phase.stats.medianMillis)}, p95 ${formatMillis(phase.stats.p95Millis)}`,
    )
    .join("; ")}.</p>`;
};

const cliStats = (suite: SuiteResult): ReadonlyArray<RunnerStats> =>
  suite.stats.filter((stats) => stats.runner !== "effect-bdd-api");

const runnerWorkLabel = (runner: RunnerStats["runner"]): string => {
  switch (runner) {
    case "effect-bdd-cli": {
      return "execution phase";
    }
    case "cucumber-js": {
      return "summed step duration";
    }
    case "effect-bdd-api": {
      return "not reported";
    }
  }
};

const phaseDefinitions: ReadonlyArray<{
  readonly key: keyof RunPhaseDurations;
  readonly label: string;
}> = [
  { key: "featureDiscoveryMillis", label: "Feature discovery" },
  { key: "stepModuleLoadMillis", label: "Step module load" },
  { key: "taskBuildMillis", label: "Task build" },
  { key: "filteringMillis", label: "Filtering" },
  { key: "executionMillis", label: "Execution" },
  { key: "reportEmissionMillis", label: "Report emission" },
];

const measuredPhaseStats = (
  suite: SuiteResult,
): ReadonlyArray<{ readonly label: string; readonly stats: DurationStats }> => {
  const samples = suite.runs.flatMap((run) =>
    run.runner === "effect-bdd-cli" && run.phase === "measured" && run.summary.phases !== undefined
      ? [run.summary.phases]
      : [],
  );
  if (samples.length === 0) {
    return [];
  }
  return phaseDefinitions.flatMap(({ key, label }) => {
    const values = samples.flatMap((sample) => {
      const value = sample[key];
      return value === undefined ? [] : [value];
    });
    return values.length === 0 ? [] : [{ label, stats: durationStats(values) }];
  });
};

const statsFor = (suite: SuiteResult, runner: RunnerStats["runner"]): RunnerStats => {
  const stats = suite.stats.find((candidate) => candidate.runner === runner);
  if (stats === undefined) {
    throw new Error(`Missing stats for ${runner} in suite ${suite.id}`);
  }
  return stats;
};

const formatMillis = (value: number): string => `${round(value)}ms`;

const formatOptionalMillis = (value: number | undefined): string =>
  value === undefined ? "n/a" : formatMillis(value);

const formatOptionalNumber = (value: number | undefined): string =>
  value === undefined ? "n/a" : String(round(value));

const escapeHtml = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const parseBenchmarkResult = (value: unknown): BenchmarkResult => {
  if (isBenchmarkResult(value)) {
    return value;
  }
  throw new Error("Input file is not a benchmark result");
};

const isBenchmarkResult = (value: unknown): value is BenchmarkResult =>
  isRecord(value) && hasBenchmarkMetadata(value) && Array.isArray(value.suites);

const hasBenchmarkMetadata = (value: Record<string, unknown>): boolean =>
  typeof value.generatedAt === "string" && isRecord(value.environment) && isRecord(value.config);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  await main();
}
