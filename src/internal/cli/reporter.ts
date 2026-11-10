import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fn from "effect/Function";
import * as Inspectable from "effect/Inspectable";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";
import { StepTimeoutError, type RunError } from "../../Errors.ts";
import { ReporterError } from "./errors.ts";
import {
  isFatalDiagnostic,
  type CliDiagnostic,
  type CliRunResult,
  type DiscoverySummary,
  type ReporterName,
  type RunEvent,
  type ScenarioResult,
  type ScenarioTask,
} from "./models.ts";

/** @internal */
export interface Reporter {
  readonly name: ReporterName;
  readonly onEvent?: (event: RunEvent) => Effect.Effect<void, ReporterError, Stdio.Stdio>;
  readonly emit: (
    result: CliRunResult,
  ) => Effect.Effect<void, ReporterError, FileSystem.FileSystem | Path.Path | Stdio.Stdio>;
}

/** @internal */
export const makeReporters = (
  names: ReadonlyArray<ReporterName>,
  outputFiles: {
    readonly text?: string;
    readonly html?: string;
    readonly json?: string;
    readonly junit?: string;
  },
  options: {
    readonly verbose: boolean;
  },
): Effect.Effect<ReadonlyArray<Reporter>, ReporterError> =>
  Effect.forEach(names, (name) => makeReporter(name, outputFiles, options));

type ReporterOutputFiles = {
  readonly text?: string;
  readonly html?: string;
  readonly json?: string;
  readonly junit?: string;
};

type ReporterOptions = {
  readonly verbose: boolean;
};

type ReporterFactory = (
  outputFiles: ReporterOutputFiles,
  options: ReporterOptions,
) => Effect.Effect<Reporter, ReporterError>;

const reporterFactories: { readonly [Name in ReporterName]: ReporterFactory } = {
  text: (outputFiles, options) => Effect.succeed(textReporter(outputFiles.text, options.verbose)),
  html: (outputFiles) => requireOutputFile("html", outputFiles.html).pipe(Effect.map(htmlReporter)),
  json: (outputFiles) => Effect.succeed(jsonReporter(outputFiles.json)),
  junit: (outputFiles) =>
    requireOutputFile("junit", outputFiles.junit).pipe(Effect.map(junitReporter)),
};

const makeReporter = (
  name: ReporterName,
  outputFiles: ReporterOutputFiles,
  options: ReporterOptions,
): Effect.Effect<Reporter, ReporterError> => reporterFactories[name](outputFiles, options);

const requireOutputFile = (
  name: "html" | "junit",
  outputFile: string | undefined,
): Effect.Effect<string, ReporterError> =>
  outputFile === undefined
    ? Effect.fail(new ReporterError({ message: `Reporter ${name} requires --output-file.${name}` }))
    : Effect.succeed(outputFile);

/** @internal */
export const emitAll: (
  reporters: ReadonlyArray<Reporter>,
  result: CliRunResult,
) => Effect.Effect<void, ReporterError, FileSystem.FileSystem | Path.Path | Stdio.Stdio> =
  Effect.fnUntraced(function* (reporters: ReadonlyArray<Reporter>, result: CliRunResult) {
    const exits = yield* Effect.forEach(
      reporters,
      (reporter) => Effect.exit(reporter.emit(result)),
      {
        concurrency: "unbounded",
      },
    );
    const failures = Fn.pipe(
      exits,
      Arr.filter((exit) => exit._tag === "Failure"),
      Arr.map((exit) => exit.cause),
    );
    if (failures.length > 0) {
      return yield* new ReporterError({
        message: "One or more reporters failed",
        cause: failures,
      });
    }
  });

/** @internal */
export const emitEventAll: (
  reporters: ReadonlyArray<Reporter>,
  event: RunEvent,
) => Effect.Effect<void, ReporterError, Stdio.Stdio> = Effect.fnUntraced(function* (
  reporters: ReadonlyArray<Reporter>,
  event: RunEvent,
) {
  const exits = yield* Effect.forEach(
    reporters,
    (reporter) =>
      reporter.onEvent === undefined
        ? Effect.exit(Effect.void)
        : Effect.exit(reporter.onEvent(event)),
    {
      concurrency: "unbounded",
    },
  );
  const failures = Fn.pipe(
    exits,
    Arr.filter((exit) => exit._tag === "Failure"),
    Arr.map((exit) => exit.cause),
  );
  if (failures.length > 0) {
    return yield* new ReporterError({
      message: "One or more reporters failed",
      cause: failures,
    });
  }
});

const textReporter = (outputFile: string | undefined, verbose: boolean): Reporter => {
  const streamProgress = outputFile === undefined;
  return {
    name: "text",
    ...(streamProgress
      ? {
          onEvent: (event: RunEvent) => {
            const text = renderRunEvent(event, verbose);
            return text === undefined ? Effect.void : writeStderr(`${text}\n`);
          },
        }
      : {}),
    emit: (result) =>
      outputFile === undefined
        ? writeStdout(`${renderText(result, verbose, false)}\n`)
        : writeFile(outputFile, renderText(result, verbose, true)),
  };
};

const htmlReporter = (outputFile: string): Reporter => ({
  name: "html",
  emit: (result) => writeFile(outputFile, renderHtml(result)),
});

const jsonReporter = (outputFile: string | undefined): Reporter => ({
  name: "json",
  emit: (result) =>
    outputFile === undefined
      ? writeStdout(`${renderJson(result)}\n`)
      : writeFile(outputFile, renderJson(result)),
});

const junitReporter = (outputFile: string): Reporter => ({
  name: "junit",
  emit: (result) => writeFile(outputFile, renderJunit(result)),
});

const writeFile: (
  outputFile: string,
  content: string,
) => Effect.Effect<void, ReporterError, FileSystem.FileSystem | Path.Path> = Effect.fnUntraced(
  function* (outputFile: string, content: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = path.dirname(outputFile);
    if (directory !== ".") {
      yield* fs.makeDirectory(directory, { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new ReporterError({
              message: `Could not create report directory "${directory}"`,
              cause,
            }),
        ),
      );
    }
    yield* fs.writeFileString(outputFile, content).pipe(
      Effect.mapError(
        (cause) =>
          new ReporterError({
            message: `Could not write report file "${outputFile}"`,
            cause,
          }),
      ),
    );
  },
);

const writeStdout = (content: string): Effect.Effect<void, ReporterError, Stdio.Stdio> =>
  writeStdio("stdout", content);

const writeStderr = (content: string): Effect.Effect<void, ReporterError, Stdio.Stdio> =>
  writeStdio("stderr", content);

const writeStdio: (
  name: "stdout" | "stderr",
  content: string,
) => Effect.Effect<void, ReporterError, Stdio.Stdio> = Effect.fnUntraced(function* (
  name: "stdout" | "stderr",
  content: string,
) {
  const stdio = yield* Stdio.Stdio;
  const sink = name === "stdout" ? stdio.stdout() : stdio.stderr();
  yield* Stream.run(Stream.make(content), sink).pipe(
    Effect.mapError(
      (cause) =>
        new ReporterError({
          message: `Could not write ${name}`,
          cause,
        }),
    ),
  );
});

const renderText = (
  result: CliRunResult,
  verbose: boolean,
  includeScenarioLines: boolean,
): string => {
  const featureSources = featureSourceMap(result);
  const failed = Arr.filter(result.results, (scenario) => scenario.outcome._tag === "Failed");
  const selected = verbose ? result.results : failed;
  const scenarioLines = includeScenarioLines
    ? Arr.map(selected, (scenario) => renderScenarioText(scenario, featureSources))
    : [];
  const failureList =
    failed.length === 0
      ? ""
      : ["Failed scenarios:", ...Arr.map(failed, renderFailureListItem)].join("\n");
  return [
    renderDiscoveryText(result.discovery, verbose),
    scenarioLines.join("\n\n"),
    renderDiagnosticsText(result.diagnostics),
    `Scenarios: ${result.summary.total} total, ${result.summary.failed} failed, ${result.summary.passed} passed (${result.summary.durationMillis}ms)`,
    failureList,
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
};

const featureSourceMap = (result: CliRunResult): ReadonlyMap<string, string> =>
  new Map(Arr.map(result.featureSources, (source) => [source.path, source.source] as const));

const renderFailureListItem = (result: ScenarioResult): string =>
  `  ${result.task.featurePath}:${result.task.core.scenarioLine} ${renderScenarioName(result)}`;

const renderDiscoveryText = (discovery: DiscoverySummary, verbose: boolean): string => {
  const summary = `Discovery: ${discovery.featurePaths.length} feature file(s), ${discovery.stepModulePaths.length} step module(s), ${discovery.featureDefinitions.length} feature definition(s), ${discovery.scenariosDiscovered} scenario(s) (${discovery.scenariosSelected} selected)`;
  if (!verbose) {
    return summary;
  }
  return [
    summary,
    "Feature files:",
    ...Arr.map(discovery.featurePaths, (path) => `  ${path}`),
    "Step modules:",
    ...Arr.map(discovery.stepModulePaths, (path) => `  ${path}`),
    "Feature definitions:",
    ...Arr.map(discovery.featureDefinitions, (title) => `  ${title}`),
    "Selected scenarios:",
    ...Arr.map(discovery.selectedScenarios, renderDiscoveredScenario),
  ].join("\n");
};

const renderDiscoveredScenario = (
  scenario: DiscoverySummary["selectedScenarios"][number],
): string =>
  `  ${scenario.featurePath}:${scenario.scenarioLine} ${scenario.featureTitle} / ${scenario.scenarioTitle}`;

const renderRunEvent = (event: RunEvent, verbose: boolean): string | undefined =>
  event._tag === "ScenarioStarted"
    ? renderScenarioStartedEvent(event)
    : renderScenarioFinishedEvent(event, verbose);

const renderScenarioStartedEvent = (
  event: Extract<RunEvent, { readonly _tag: "ScenarioStarted" }>,
): string =>
  `RUNNING ${event.task.featurePath}:${event.task.core.scenarioLine} ${renderTaskName(event.task)}`;

const renderScenarioFinishedEvent = (
  event: Extract<RunEvent, { readonly _tag: "ScenarioFinished" }>,
  verbose: boolean,
): string | undefined =>
  event.result.outcome._tag === "Passed" && !verbose
    ? undefined
    : renderScenarioText(event.result, emptyFeatureSources);

const renderScenarioText = (
  result: ScenarioResult,
  featureSources: ReadonlyMap<string, string>,
): string => {
  const prefix = result.outcome._tag === "Passed" ? "PASS" : "FAIL";
  const line =
    result.outcome._tag === "Passed" ? result.task.core.scenarioLine : result.outcome.error.line;
  const base = `${prefix} ${result.task.featurePath}:${line} ${renderScenarioName(
    result,
  )} (${result.durationMillis}ms)`;
  if (result.outcome._tag === "Passed") {
    return base;
  }
  const frame = renderFrame(featureSources.get(result.task.featurePath), line);
  const error = indentText(renderError(result.outcome.error), 2);
  return frame.length === 0 ? `${base}\n\n${error}` : `${base}\n\n${frame.join("\n")}\n\n${error}`;
};

const renderFrame = (source: string | undefined, line: number): ReadonlyArray<string> => {
  if (source === undefined) {
    return [];
  }
  const lines = source.split("\n");
  const start = Math.max(1, line - 2);
  const end = Math.min(lines.length, line + 2);
  const width = String(end).length;
  return Arr.map(Arr.range(start, end), (current) => {
    const marker = current === line ? ">" : " ";
    return `${marker} ${String(current).padStart(width)} | ${lines[current - 1] ?? ""}`;
  });
};

const emptyFeatureSources: ReadonlyMap<string, string> = new Map();

const renderTaskName = (task: ScenarioTask): string =>
  task.core.ruleTitle === undefined
    ? `${task.core.featureTitle} / ${task.core.scenarioTitle}`
    : `${task.core.featureTitle} / ${task.core.ruleTitle} / ${task.core.scenarioTitle}`;

const renderHtml = (result: CliRunResult): string =>
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>effect-bdd report</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; }
      .passed { color: #166534; }
      .failed { color: #991b1b; }
    </style>
  </head>
  <body>
    <h1>effect-bdd report</h1>
    <p>Features: ${result.summary.features}, scenarios: ${result.summary.total}, passed: ${result.summary.passed}, failed: ${result.summary.failed}</p>
    <p>Duration: ${result.summary.durationMillis}ms</p>
    <table>
      <thead>
        <tr><th>Status</th><th>Source</th><th>Feature</th><th>Scenario</th><th>Tags</th><th>Duration</th><th>Error</th></tr>
      </thead>
      <tbody>
${Fn.pipe(result.results, Arr.map(renderScenarioHtml), Arr.join("\n"))}
      </tbody>
    </table>
    <h2>Diagnostics</h2>
    <pre>${escapeHtml(renderDiagnosticsText(result.diagnostics))}</pre>
  </body>
</html>
`;

const renderScenarioHtml = (result: ScenarioResult): string => {
  const status = result.outcome._tag === "Passed" ? "passed" : "failed";
  const error = result.outcome._tag === "Passed" ? "" : renderError(result.outcome.error);
  return `        <tr>
          <td class="${status}">${status}</td>
          <td>${escapeHtml(`${result.task.featurePath}:${result.task.core.scenarioLine}`)}</td>
          <td>${escapeHtml(result.task.core.featureTitle)}</td>
          <td>${escapeHtml(renderScenarioName(result))}</td>
          <td>${escapeHtml(Fn.pipe(result.task.core.tags, Arr.join(", ")))}</td>
          <td>${result.durationMillis}ms</td>
          <td>${escapeHtml(error)}</td>
        </tr>`;
};

const renderDiagnosticsText = (diagnostics: ReadonlyArray<CliDiagnostic>): string => {
  if (diagnostics.length === 0) {
    return "";
  }
  const unmatched = Fn.pipe(
    diagnostics,
    Arr.filter(
      (diagnostic) =>
        diagnostic._tag === "UnmatchedFeature" || diagnostic._tag === "UnmatchedScenario",
    ),
  );
  const unused = Fn.pipe(
    diagnostics,
    Arr.filter(
      (diagnostic) =>
        diagnostic._tag === "UnusedFeatureDefinition" ||
        diagnostic._tag === "UnusedScenarioDefinition",
    ),
  );
  return [
    unmatched.length === 0
      ? ""
      : ["Unmatched source:", ...Arr.map(unmatched, renderDiagnosticText)].join("\n"),
    unused.length === 0
      ? ""
      : ["Unused definitions:", ...Arr.map(unused, renderDiagnosticText)].join("\n"),
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
};

const renderDiagnosticText = (diagnostic: CliDiagnostic): string => {
  if (isUnusedDiagnostic(diagnostic)) {
    return `  ${diagnostic.message}`;
  }
  return renderUnmatchedDiagnosticText(diagnostic);
};

type UnusedDiagnostic = Extract<
  CliDiagnostic,
  { readonly _tag: "UnusedFeatureDefinition" | "UnusedScenarioDefinition" }
>;

const isUnusedDiagnostic = (diagnostic: CliDiagnostic): diagnostic is UnusedDiagnostic =>
  diagnostic._tag === "UnusedFeatureDefinition" || diagnostic._tag === "UnusedScenarioDefinition";

const renderUnmatchedDiagnosticText = (
  diagnostic: Exclude<CliDiagnostic, UnusedDiagnostic>,
): string => {
  switch (diagnostic._tag) {
    case "UnmatchedFeature": {
      return `  ${diagnostic.featurePath}:${diagnostic.line}\n    Feature: ${diagnostic.featureTitle}\n    Reason: ${diagnostic.message}`;
    }
    case "UnmatchedScenario": {
      return `  ${diagnostic.featurePath}:${diagnostic.scenarioLine}\n    Scenario: ${diagnostic.scenarioTitle}\n    Reason: ${diagnostic.message}`;
    }
  }
};

const renderJson = (result: CliRunResult): string =>
  JSON.stringify(
    {
      summary: result.summary,
      discovery: result.discovery,
      scenarios: Arr.map(result.results, (scenario) => ({
        source: {
          path: scenario.task.featurePath,
          line: scenario.task.core.scenarioLine,
        },
        feature: scenario.task.core.featureTitle,
        rule:
          scenario.task.core.ruleTitle === undefined
            ? undefined
            : {
                name: scenario.task.core.ruleTitle,
                line: scenario.task.core.ruleLine,
              },
        scenario: scenario.task.core.scenarioTitle,
        tags: scenario.task.core.tags,
        durationMillis: scenario.durationMillis,
        outcome:
          scenario.outcome._tag === "Passed"
            ? {
                status: "passed",
                steps: scenario.outcome.steps,
              }
            : {
                status: "failed",
                error: renderError(scenario.outcome.error),
              },
      })),
      diagnostics: result.diagnostics,
    },
    null,
    2,
  );

const renderJunit = (result: CliRunResult): string => {
  const diagnostics = result.diagnostics.length;
  const fatalDiagnostics = Fn.pipe(result.diagnostics, Arr.filter(isFatalDiagnostic)).length;
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="effect-bdd" tests="${result.summary.total + diagnostics}" failures="${
    result.summary.failed + fatalDiagnostics
  }" time="${result.summary.durationMillis / 1000}">
${Fn.pipe(result.results, Arr.map(renderJunitScenario), Arr.join("\n"))}
${Fn.pipe(result.diagnostics, Arr.map(renderJunitDiagnostic), Arr.join("\n"))}
</testsuite>
`;
};

const renderJunitScenario = (result: ScenarioResult): string => {
  const name = renderScenarioName(result);
  const failure =
    result.outcome._tag === "Passed"
      ? ""
      : `
    <failure message="${escapeXml(renderError(result.outcome.error))}">${escapeXml(
      renderError(result.outcome.error),
    )}</failure>`;
  return `  <testcase classname="${escapeXml(result.task.core.featureTitle)}" name="${escapeXml(name)}" file="${escapeXml(
    result.task.featurePath,
  )}" line="${result.task.core.scenarioLine}" time="${result.durationMillis / 1000}">${failure}
  </testcase>`;
};

const renderJunitDiagnostic = (diagnostic: CliDiagnostic): string =>
  isFatalDiagnostic(diagnostic)
    ? `  <testcase classname="effect-bdd diagnostics" name="${escapeXml(diagnostic.message)}">
    <failure message="${escapeXml(diagnostic.message)}">${escapeXml(renderDiagnosticText(diagnostic))}</failure>
  </testcase>`
    : `  <testcase classname="effect-bdd diagnostics" name="${escapeXml(diagnostic.message)}"></testcase>`;

const renderScenarioName = (result: ScenarioResult): string =>
  result.task.core.ruleTitle === undefined
    ? `${result.task.core.featureTitle} / ${result.task.core.scenarioTitle}`
    : `${result.task.core.featureTitle} / ${result.task.core.ruleTitle} / ${result.task.core.scenarioTitle}`;

const renderError = (error: RunError): string => {
  const cause = "cause" in error ? renderCause(error.cause) : undefined;
  return cause === undefined
    ? `${error._tag}: ${error.message}`
    : `${error._tag}: ${error.message}\n${cause}`;
};

const renderCause = (cause: unknown): string | undefined => {
  if (cause === undefined) {
    return undefined;
  }
  const [first, ...rest] = renderCauseLines(cause);
  return [`Cause: ${first}`, ...rest.map((line) => `  ${line}`)].join("\n");
};

const renderCauseLines = (cause: unknown): ReadonlyArray<string> => {
  if (Schema.is(StepTimeoutError)(cause)) {
    return [`${cause._tag}: ${cause.message} (timeout: ${Duration.format(cause.timeout)})`];
  }
  if (Schema.isSchemaError(cause)) {
    return splitLines(formatSchemaIssue(cause.issue));
  }
  if (hasStringTag(cause)) {
    return renderTaggedCause(cause);
  }
  if (Predicate.isError(cause)) {
    return splitLines(Cause.pretty(Cause.fail(cause)));
  }
  return splitLines(
    Predicate.isString(cause) ||
      Predicate.isNumber(cause) ||
      Predicate.isBoolean(cause) ||
      Predicate.isBigInt(cause)
      ? String(cause)
      : Inspectable.toStringUnknown(cause, 0),
  );
};

const renderTaggedCause = (cause: { readonly _tag: string }): ReadonlyArray<string> => {
  const message =
    Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message)
      ? cause.message
      : undefined;
  const head = message === undefined ? cause._tag : `${cause._tag}: ${message}`;
  const fields = Object.entries(cause).filter(([key]) => !causeMetadataKeys.has(key));
  return [head, ...fields.map(([key, value]) => `${key}: ${renderCauseValue(value)}`)];
};

const renderCauseValue = (value: unknown): string =>
  Predicate.isString(value) ||
  Predicate.isNumber(value) ||
  Predicate.isBoolean(value) ||
  Predicate.isBigInt(value)
    ? String(value)
    : Predicate.isError(value)
      ? value.message
      : Inspectable.toStringUnknown(value, 0);

const hasStringTag = (u: unknown): u is { readonly _tag: string } =>
  Predicate.isObject(u) && Predicate.hasProperty(u, "_tag") && Predicate.isString(u._tag);

const splitLines = (text: string): ReadonlyArray<string> =>
  text.split("\n").map((line) => line.trimStart());

const indentText = (text: string, spaces: number): string =>
  text
    .split("\n")
    .map((line) => `${" ".repeat(spaces)}${line}`)
    .join("\n");

const formatSchemaIssue = SchemaIssue.makeFormatterDefault();

const causeMetadataKeys: ReadonlySet<string> = new Set([
  "_tag",
  "message",
  "name",
  "stack",
  "cause",
]);

const escapeHtml = (text: string): string =>
  Fn.pipe(
    text,
    Str.replaceAll("&", "&amp;"),
    Str.replaceAll("<", "&lt;"),
    Str.replaceAll(">", "&gt;"),
    Str.replaceAll('"', "&quot;"),
    Str.replaceAll("'", "&#039;"),
  );

const escapeXml = escapeHtml;
