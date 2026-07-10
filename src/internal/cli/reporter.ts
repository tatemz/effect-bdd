import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fn from "effect/Function";
import * as Inspectable from "effect/Inspectable";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";
import { StepTimeoutError } from "../../Errors.ts";
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

type OutputFiles = CliOptionsOutputFiles;

type CliOptionsOutputFiles = {
  readonly text?: string;
  readonly html?: string;
  readonly json?: string;
  readonly junit?: string;
};

type ReporterOptions = {
  readonly verbose: boolean;
};

type ReporterFactory = (
  outputFiles: OutputFiles,
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
  outputFiles: OutputFiles,
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
      return yield* Effect.fail(
        new ReporterError({
          message: "One or more reporters failed",
          cause: failures,
        }),
      );
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
    return yield* Effect.fail(
      new ReporterError({
        message: "One or more reporters failed",
        cause: failures,
      }),
    );
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
  const discovery = renderDiscoveryText(result.discovery, verbose);
  const summary = [
    `Features: ${result.summary.features}, Scenarios: ${result.summary.total}, passed: ${result.summary.passed}, failed: ${result.summary.failed}`,
    `Duration: ${result.summary.durationMillis}ms`,
    "",
  ];
  const scenarioLines = verbose
    ? Arr.map(result.results, renderScenarioText)
    : Fn.pipe(
        result.results,
        Arr.filter((scenario) => scenario.outcome._tag === "Failed"),
        Arr.map(renderScenarioText),
      );
  const diagnosticLines = renderDiagnosticsText(result.diagnostics);
  return Fn.pipe(
    discovery,
    Arr.appendAll(summary),
    Arr.appendAll(includeScenarioLines ? scenarioLines : []),
    Arr.appendAll(diagnosticLines),
    Arr.join("\n"),
  );
};

const renderDiscoveryText = (
  discovery: DiscoverySummary,
  verbose: boolean,
): ReadonlyArray<string> => {
  const summary = [
    `Discovery: ${discovery.featurePaths.length} feature file(s), ${discovery.stepModulePaths.length} step module(s), ${discovery.featureDefinitions.length} feature definition(s), ${discovery.scenariosDiscovered} scenario(s) (${discovery.scenariosSelected} selected)`,
    "",
  ];
  if (!verbose) {
    return summary;
  }
  return Fn.pipe(
    summary,
    Arr.appendAll(["Feature files:"]),
    Arr.appendAll(Arr.map(discovery.featurePaths, (path) => `  ${path}`)),
    Arr.appendAll(["Step modules:"]),
    Arr.appendAll(Arr.map(discovery.stepModulePaths, (path) => `  ${path}`)),
    Arr.appendAll(["Feature definitions:"]),
    Arr.appendAll(Arr.map(discovery.featureDefinitions, (title) => `  ${title}`)),
    Arr.appendAll(["Selected scenarios:"]),
    Arr.appendAll(Arr.map(discovery.selectedScenarios, renderDiscoveredScenario)),
    Arr.appendAll([""]),
  );
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
  event.result.outcome._tag === "Passed" && !verbose ? undefined : renderScenarioText(event.result);

const renderScenarioText = (result: ScenarioResult): string => {
  const prefix = result.outcome._tag === "Passed" ? "PASS" : "FAIL";
  const base = `${prefix} ${result.task.featurePath}:${result.task.core.scenarioLine} ${renderScenarioName(
    result,
  )} (${result.durationMillis}ms)`;
  return result.outcome._tag === "Passed"
    ? base
    : `${base}\n  ${renderError(result.outcome.error)}`;
};

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
    <pre>${escapeHtml(Fn.pipe(renderDiagnosticsText(result.diagnostics), Arr.join("\n")))}</pre>
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

const renderDiagnosticsText = (
  diagnostics: ReadonlyArray<CliDiagnostic>,
): ReadonlyArray<string> => {
  if (diagnostics.length === 0) {
    return [];
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
  return Fn.pipe(
    unmatched.length === 0 ? [] : ["", "Unmatched source:"],
    Arr.appendAll(Arr.map(unmatched, renderDiagnosticText)),
    Arr.appendAll(unused.length === 0 ? [] : ["", "Unused definitions:"]),
    Arr.appendAll(Arr.map(unused, renderDiagnosticText)),
  );
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

const renderError = (error: {
  readonly _tag: string;
  readonly message: string;
  readonly cause?: unknown;
}): string => {
  const cause = renderCause(error.cause);
  return cause === undefined
    ? `${error._tag}: ${error.message}`
    : `${error._tag}: ${error.message}\n  Cause: ${cause}`;
};

const renderCause = (cause: unknown): string | undefined =>
  cause === undefined
    ? undefined
    : cause instanceof StepTimeoutError
      ? `${cause._tag}: ${cause.message} (timeout: ${Duration.format(cause.timeout)})`
      : Predicate.isError(cause)
        ? cause.message
        : Inspectable.toStringUnknown(cause, 0);

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
