import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { percentDelta, round } from "./statistics.ts";
import { resultsRoot } from "./paths.ts";
import type { BenchmarkResult, RunnerStats, SuiteResult } from "./types.ts";

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

const renderMarkdown = (result: BenchmarkResult): string => {
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
    "Performance data is split into wall time (CLI user experience) and execution time (runner-reported work). The broader value proposition for `effect-bdd` is typed scenario chains and avoiding Cucumber's mutable `World` model.",
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
  if (effect.confidence === "low" || cucumber.confidence === "low") {
    return [
      `- ${suite.name}: low-confidence smoke result. Wall median: \`effect-bdd\` CLI ${formatMillis(effect.wall.medianMillis)} vs cucumber-js ${formatMillis(cucumber.wall.medianMillis)}. Do not publish a speed claim from this run.`,
    ];
  }
  return [
    `- ${suite.name}: \`effect-bdd\` CLI wall median ${formatMillis(effect.wall.medianMillis)} vs cucumber-js ${formatMillis(cucumber.wall.medianMillis)} (${round(Math.abs(delta))}% ${direction}, ${effect.confidence} confidence).`,
  ];
};

const renderMarkdownSuite = (suite: SuiteResult): ReadonlyArray<string> => [
  `### ${suite.name}`,
  "",
  suite.description,
  "",
  "| Runner | Confidence | Wall median | Wall p95 | Wall CV | Exec median | Wall scenarios/sec | Exec scenarios/sec | Runs |",
  "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...suite.stats.map(
    (stats) =>
      `| ${stats.runner} | ${stats.confidence} | ${formatMillis(stats.wall.medianMillis)} | ${formatMillis(stats.wall.p95Millis)} | ${round(stats.wall.coefficientOfVariation, 3)} | ${formatOptionalMillis(stats.execution?.medianMillis)} | ${round(stats.wallScenariosPerSecond)} | ${formatOptionalNumber(stats.executionScenariosPerSecond)} | ${stats.runs} |`,
  ),
  "",
  ...renderMarkdownPhases(suite),
];

const renderMarkdownPhases = (suite: SuiteResult): ReadonlyArray<string> => {
  const phases = suite.runs.find(
    (run) => run.runner === "effect-bdd-cli" && run.phase === "measured",
  )?.summary.phases;
  if (phases === undefined) {
    return [];
  }
  return [
    "effect-bdd CLI phase timing from first measured run:",
    "",
    `- Feature discovery: ${formatMillis(phases.featureDiscoveryMillis)}`,
    `- Step module load: ${formatMillis(phases.stepModuleLoadMillis)}`,
    `- Task build: ${formatMillis(phases.taskBuildMillis)}`,
    `- Filtering: ${formatMillis(phases.filteringMillis)}`,
    `- Execution: ${formatMillis(phases.executionMillis)}`,
    "",
  ];
};

const renderHtml = (result: BenchmarkResult): string => `<!doctype html>
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
    <p class="note">Performance data is split into wall time (CLI user experience) and execution time (runner-reported work). The broader value proposition for <code>effect-bdd</code> is typed scenario chains and avoiding Cucumber's mutable <code>World</code> model.</p>
${result.suites.map(renderHtmlSuite).join("\n")}
  </body>
</html>
`;

const renderHtmlSuite = (suite: SuiteResult): string => `    <h2>${escapeHtml(suite.name)}</h2>
    <p>${escapeHtml(suite.description)}</p>
    <table>
      <thead>
        <tr><th>Runner</th><th>Confidence</th><th>Wall median</th><th>Wall p95</th><th>Wall CV</th><th>Exec median</th><th>Wall scenarios/sec</th><th>Exec scenarios/sec</th><th>Runs</th></tr>
      </thead>
      <tbody>
${suite.stats.map(renderHtmlStats).join("\n")}
      </tbody>
    </table>
${renderHtmlPhases(suite)}`;

const renderHtmlStats = (stats: RunnerStats): string => `        <tr>
          <td>${escapeHtml(stats.runner)}</td>
          <td>${stats.confidence}</td>
          <td>${formatMillis(stats.wall.medianMillis)}</td>
          <td>${formatMillis(stats.wall.p95Millis)}</td>
          <td>${round(stats.wall.coefficientOfVariation, 3)}</td>
          <td>${formatOptionalMillis(stats.execution?.medianMillis)}</td>
          <td>${round(stats.wallScenariosPerSecond)}</td>
          <td>${formatOptionalNumber(stats.executionScenariosPerSecond)}</td>
          <td>${stats.runs}</td>
        </tr>`;

const renderHtmlPhases = (suite: SuiteResult): string => {
  const phases = suite.runs.find(
    (run) => run.runner === "effect-bdd-cli" && run.phase === "measured",
  )?.summary.phases;
  if (phases === undefined) {
    return "";
  }
  return `    <p>effect-bdd CLI phase timing from first measured run: feature discovery ${formatMillis(
    phases.featureDiscoveryMillis,
  )}, step module load ${formatMillis(phases.stepModuleLoadMillis)}, task build ${formatMillis(
    phases.taskBuildMillis,
  )}, filtering ${formatMillis(phases.filteringMillis)}, execution ${formatMillis(
    phases.executionMillis,
  )}.</p>`;
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

await main();
