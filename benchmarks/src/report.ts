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
    `Config: ${result.config.warmups} warmup run(s), ${result.config.iterations} measured run(s), parallel=${result.config.parallel}`,
    "",
    "Performance data answers runner overhead on this corpus. The broader value proposition for `effect-bdd` is typed scenario chains and avoiding Cucumber's mutable `World` model.",
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
  const delta = percentDelta(cucumber.medianMillis, effect.medianMillis);
  const direction = delta <= 0 ? "faster" : "slower";
  return [
    `- ${suite.name}: \`effect-bdd\` CLI median ${formatMillis(effect.medianMillis)} vs cucumber-js ${formatMillis(cucumber.medianMillis)} (${round(Math.abs(delta))}% ${direction}).`,
  ];
};

const renderMarkdownSuite = (suite: SuiteResult): ReadonlyArray<string> => [
  `### ${suite.name}`,
  "",
  suite.description,
  "",
  "| Runner | Median | Mean | Min | Max | Scenarios/sec | Runs |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...suite.stats.map(
    (stats) =>
      `| ${stats.runner} | ${formatMillis(stats.medianMillis)} | ${formatMillis(stats.meanMillis)} | ${formatMillis(stats.minMillis)} | ${formatMillis(stats.maxMillis)} | ${round(stats.scenariosPerSecond)} | ${stats.runs} |`,
  ),
  "",
];

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
    <p>Config: ${result.config.warmups} warmup run(s), ${result.config.iterations} measured run(s), parallel=${result.config.parallel}</p>
    <p class="note">Performance data answers runner overhead on this corpus. The broader value proposition for <code>effect-bdd</code> is typed scenario chains and avoiding Cucumber's mutable <code>World</code> model.</p>
${result.suites.map(renderHtmlSuite).join("\n")}
  </body>
</html>
`;

const renderHtmlSuite = (suite: SuiteResult): string => `    <h2>${escapeHtml(suite.name)}</h2>
    <p>${escapeHtml(suite.description)}</p>
    <table>
      <thead>
        <tr><th>Runner</th><th>Median</th><th>Mean</th><th>Min</th><th>Max</th><th>Scenarios/sec</th><th>Runs</th></tr>
      </thead>
      <tbody>
${suite.stats.map(renderHtmlStats).join("\n")}
      </tbody>
    </table>`;

const renderHtmlStats = (stats: RunnerStats): string => `        <tr>
          <td>${escapeHtml(stats.runner)}</td>
          <td>${formatMillis(stats.medianMillis)}</td>
          <td>${formatMillis(stats.meanMillis)}</td>
          <td>${formatMillis(stats.minMillis)}</td>
          <td>${formatMillis(stats.maxMillis)}</td>
          <td>${round(stats.scenariosPerSecond)}</td>
          <td>${stats.runs}</td>
        </tr>`;

const statsFor = (suite: SuiteResult, runner: RunnerStats["runner"]): RunnerStats => {
  const stats = suite.stats.find((candidate) => candidate.runner === runner);
  if (stats === undefined) {
    throw new Error(`Missing stats for ${runner} in suite ${suite.id}`);
  }
  return stats;
};

const formatMillis = (value: number): string => `${round(value)}ms`;

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
