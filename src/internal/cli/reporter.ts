import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fn from "effect/Function";
import * as Inspectable from "effect/Inspectable";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";
import { StepTimeoutError, type RunError } from "../../Errors.ts";
import { parseStackLocation } from "../stackLocation.ts";
import { ReporterError } from "./errors.ts";
import {
  isFatalDiagnostic,
  type CliDiagnostic,
  type CliRunResult,
  type DiscoverySummary,
  type ReporterName,
  type RunEvent,
  type ScenarioFailure,
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
    readonly cwd: string;
    readonly progress: "none" | "scenario";
    readonly color: boolean;
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
  readonly cwd: string;
  readonly progress: "none" | "scenario";
  readonly color: boolean;
};

type ReporterFactory = (
  outputFiles: ReporterOutputFiles,
  options: ReporterOptions,
) => Effect.Effect<Reporter, ReporterError>;

const reporterFactories: { readonly [Name in ReporterName]: ReporterFactory } = {
  text: (outputFiles, options) => Effect.succeed(textReporter(outputFiles.text, options)),
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
    const exits = yield* Effect.forEach(reporters, (reporter) =>
      Effect.exit(reporter.emit(result)),
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
  const exits = yield* Effect.forEach(reporters, (reporter) =>
    reporter.onEvent === undefined
      ? Effect.exit(Effect.void)
      : Effect.exit(reporter.onEvent(event)),
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

const textReporter = (outputFile: string | undefined, options: ReporterOptions): Reporter => ({
  name: "text",
  ...(outputFile === undefined && options.progress === "scenario"
    ? {
        onEvent: (event: RunEvent) =>
          event._tag === "ScenarioStarted"
            ? writeStderr(`${renderScenarioStartedEvent(event)}\n`)
            : Effect.void,
      }
    : {}),
  emit: Effect.fnUntraced(function* (result: CliRunResult) {
    const path = yield* Path.Path;
    const displayPath = (value: string) => path.relative(options.cwd, value);
    const text = `${renderText(
      result,
      options.verbose,
      displayPath,
      options.color && outputFile === undefined,
    )}\n`;
    if (outputFile === undefined) {
      yield* writeStdout(text);
    } else {
      yield* writeFile(outputFile, text);
    }
  }),
});

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
  displayPath: (path: string) => string,
  color: boolean,
): string => {
  const featureSources = featureSourceMap(result);
  const failed = Arr.filter(result.results, (scenario) => scenario.outcome._tag === "Failed");
  const selected = verbose ? result.results : failed;
  const scenarioLines = Arr.map(selected, (scenario) =>
    renderScenarioText(scenario, featureSources, displayPath, color),
  );
  const failureList =
    failed.length === 0
      ? ""
      : Arr.join(
          [
            "Failed scenarios:",
            ...Arr.map(failed, (scenario) => renderFailureListItem(scenario, displayPath)),
          ],
          "\n",
        );
  return Arr.join(
    Arr.filter(
      [
        renderDiscoveryText(result.discovery, verbose, displayPath),
        Arr.join(scenarioLines, "\n\n"),
        renderDiagnosticsText(result.diagnostics, displayPath),
        `Scenarios: ${result.summary.total} total, ${result.summary.failed} failed, ${result.summary.passed} passed (${result.summary.durationMillis}ms)`,
        failureList,
      ],
      (section) => section.length > 0,
    ),
    "\n\n",
  );
};

const featureSourceMap = (result: CliRunResult): Readonly<Record<string, string>> =>
  Record.fromEntries(
    Arr.map(result.featureSources, (source) => [source.path, source.source] as const),
  );

const renderFailureListItem = (
  result: ScenarioResult,
  displayPath: (path: string) => string,
): string =>
  `  ${displayPath(result.task.featurePath)}:${result.task.core.scenarioLine} ${renderScenarioName(
    result,
  )}`;

const renderDiscoveryText = (
  discovery: DiscoverySummary,
  verbose: boolean,
  displayPath: (path: string) => string,
): string => {
  if (!verbose) {
    return "";
  }
  const summary = `Discovery: ${discovery.featurePaths.length} feature file(s), ${discovery.stepModulePaths.length} step module(s), ${discovery.featureDefinitions.length} feature definition(s), ${discovery.scenariosDiscovered} scenario(s) (${discovery.scenariosSelected} selected)`;
  return Arr.join(
    [
      summary,
      "Feature files:",
      ...Arr.map(discovery.featurePaths, (path) => `  ${displayPath(path)}`),
      "Step modules:",
      ...Arr.map(discovery.stepModulePaths, (path) => `  ${displayPath(path)}`),
      "Feature definitions:",
      ...Arr.map(discovery.featureDefinitions, (title) => `  ${title}`),
      "Selected scenarios:",
      ...Arr.map(discovery.selectedScenarios, (scenario) =>
        renderDiscoveredScenario(scenario, displayPath),
      ),
    ],
    "\n",
  );
};

const renderDiscoveredScenario = (
  scenario: DiscoverySummary["selectedScenarios"][number],
  displayPath: (path: string) => string,
): string =>
  `  ${displayPath(scenario.featurePath)}:${scenario.scenarioLine} ${scenario.featureTitle} / ${scenario.scenarioTitle}`;

const renderScenarioStartedEvent = (
  event: Extract<RunEvent, { readonly _tag: "ScenarioStarted" }>,
): string =>
  `RUNNING ${event.task.featurePath}:${event.task.core.scenarioLine} ${renderTaskName(event.task)}`;

const renderScenarioText = (
  result: ScenarioResult,
  featureSources: Readonly<Record<string, string>>,
  displayPath: (path: string) => string,
  color: boolean,
): string => {
  const prefix = renderStatus(result.outcome._tag === "Passed" ? "PASS" : "FAIL", color);
  const line = failureLine(result);
  const base = `${prefix} ${displayPath(result.task.featurePath)}:${line} ${renderScenarioName(
    result,
  )} (${result.durationMillis}ms)`;
  if (result.outcome._tag === "Passed") {
    return base;
  }
  const frame = renderFrame(featureSources[result.task.featurePath], line);
  const error = indentText(
    addStepDefinition(result, displayPath, renderFailure(result.outcome.failure)),
    2,
  );
  return frame.length === 0
    ? `${base}\n\n${error}`
    : `${base}\n\n${Arr.join(frame, "\n")}\n\n${error}`;
};

// oxlint-disable-next-line complexity
const addStepDefinition = (
  result: ScenarioResult,
  displayPath: (path: string) => string,
  text: string,
): string => {
  if (
    result.outcome._tag !== "Failed" ||
    result.outcome.failure._tag !== "RunError" ||
    result.outcome.failure.error._tag !== "StepError"
  ) {
    return text;
  }
  const definition = result.outcome.failure.error.definition;
  return definition === undefined
    ? text
    : `${text}\nDefinition: ${displayPath(definition.path)}:${definition.line}`;
};

const failureLine = (result: ScenarioResult): number => {
  if (result.outcome._tag === "Passed") {
    return result.task.core.scenarioLine;
  }
  return result.outcome.failure._tag === "RunError"
    ? result.outcome.failure.error.line
    : result.task.core.scenarioLine;
};

const renderFrame = (source: string | undefined, line: number): ReadonlyArray<string> => {
  if (source === undefined) {
    return [];
  }
  const lines = Str.split(source, "\n");
  const start = Math.max(1, line - 2);
  const end = Math.min(lines.length, line + 2);
  const width = Str.length(Inspectable.toStringUnknown(end, 0));
  return Arr.map(Arr.range(start, end), (current) => {
    const marker = current === line ? ">" : " ";
    const lineNumber = Inspectable.toStringUnknown(current, 0);
    return `${marker} ${Str.padStart(width)(lineNumber)} | ${lines[current - 1] ?? ""}`;
  });
};

const renderStatus = (status: "PASS" | "FAIL", color: boolean): string =>
  color ? `\u001b[${status === "FAIL" ? "31" : "32"}m${status}\u001b[0m` : status;

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
  const error = result.outcome._tag === "Passed" ? "" : renderFailure(result.outcome.failure);
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

// oxlint-disable-next-line complexity
const renderDiagnosticsText = (
  diagnostics: ReadonlyArray<CliDiagnostic>,
  displayPath: (path: string) => string = identityPath,
): string => {
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
  return Arr.join(
    Arr.filter(
      [
        unmatched.length === 0
          ? ""
          : Arr.join(
              [
                "Unmatched source:",
                ...Arr.map(unmatched, (diagnostic) =>
                  renderDiagnosticText(diagnostic, displayPath),
                ),
              ],
              "\n",
            ),
        unused.length === 0
          ? ""
          : Arr.join(
              [
                "Unused definitions:",
                ...Arr.map(unused, (diagnostic) => renderDiagnosticText(diagnostic, displayPath)),
              ],
              "\n",
            ),
      ],
      (section) => section.length > 0,
    ),
    "\n\n",
  );
};

const renderDiagnosticText = (
  diagnostic: CliDiagnostic,
  displayPath: (path: string) => string = identityPath,
): string => {
  if (isUnusedDiagnostic(diagnostic)) {
    return `  ${diagnostic.message}`;
  }
  return renderUnmatchedDiagnosticText(diagnostic, displayPath);
};

type UnusedDiagnostic = Extract<
  CliDiagnostic,
  { readonly _tag: "UnusedFeatureDefinition" | "UnusedScenarioDefinition" }
>;

const isUnusedDiagnostic = (diagnostic: CliDiagnostic): diagnostic is UnusedDiagnostic =>
  diagnostic._tag === "UnusedFeatureDefinition" || diagnostic._tag === "UnusedScenarioDefinition";

const renderUnmatchedDiagnosticText = (
  diagnostic: Exclude<CliDiagnostic, UnusedDiagnostic>,
  displayPath: (path: string) => string,
): string => {
  switch (diagnostic._tag) {
    case "UnmatchedFeature": {
      return `  ${displayPath(diagnostic.featurePath)}:${diagnostic.line}\n    Feature: ${diagnostic.featureTitle}\n    Reason: ${diagnostic.message}`;
    }
    case "UnmatchedScenario": {
      return `  ${displayPath(diagnostic.featurePath)}:${diagnostic.scenarioLine}\n    Scenario: ${diagnostic.scenarioTitle}\n    Reason: ${diagnostic.message}`;
    }
  }
};

const identityPath = (path: string): string => path;

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
                error: renderFailure(scenario.outcome.failure),
                failure: failureData(scenario.outcome.failure),
              },
      })),
      diagnostics: result.diagnostics,
    },
    null,
    2,
  );

const failureData = (failure: ScenarioFailure): Record<string, unknown> =>
  failure._tag === "RunError"
    ? { _tag: "RunError", error: errorData(failure.error) }
    : { _tag: "Defect", cause: renderDefect(failure.cause) };

// oxlint-disable-next-line complexity
const errorData = (error: RunError): Record<string, unknown> => {
  switch (error._tag) {
    case "ParseError": {
      return {
        _tag: error._tag,
        message: error.message,
        line: error.line,
        column: error.column,
        path: error.path,
      };
    }
    case "MatchError": {
      return {
        _tag: error._tag,
        message: error.message,
        scenario: error.scenario,
        step: error.step,
        line: error.line,
        candidates: error.candidates,
        cause: renderCauseBody(error.cause),
      };
    }
    case "StepError": {
      return {
        _tag: error._tag,
        message: error.message,
        scenario: error.scenario,
        step: error.step,
        line: error.line,
        definition: error.definition,
        cause: renderCauseBody(error.cause),
      };
    }
    case "TapError": {
      return {
        _tag: error._tag,
        message: error.message,
        scenario: error.scenario,
        step: error.step,
        line: error.line,
        cause: renderCauseBody(error.cause),
      };
    }
    case "ScenarioSetupError": {
      return {
        _tag: error._tag,
        message: error.message,
        scenario: error.scenario,
        line: error.line,
        cause: renderCauseBody(error.cause),
      };
    }
    case "ScenarioTeardownError": {
      return {
        _tag: error._tag,
        message: error.message,
        scenario: error.scenario,
        line: error.line,
        cause: renderCauseBody(error.cause),
      };
    }
  }
};

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
    <failure message="${escapeXml(renderFailure(result.outcome.failure))}">${escapeXml(
      renderFailure(result.outcome.failure),
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

const renderFailure = (failure: ScenarioFailure): string =>
  failure._tag === "RunError" ? renderError(failure.error) : renderDefect(failure.cause);

/** @internal */
export const renderDefect = (cause: Cause.Cause<unknown>): string =>
  cause.reasons.length === 0
    ? "Defect: Unknown failure"
    : Arr.join(Arr.map(cause.reasons, renderDefectReason), "\n");

// oxlint-disable-next-line complexity
const renderDefectReason = (reason: Cause.Reason<unknown>): string => {
  switch (reason._tag) {
    case "Die": {
      return Predicate.isError(reason.defect)
        ? renderDefectError(reason.defect)
        : `Defect: ${renderCauseValue(reason.defect)}`;
    }
    case "Fail": {
      const body = renderCauseBody(reason.error);
      return body === undefined ? "Failure" : `Failure: ${body}`;
    }
    case "Interrupt": {
      return "Interrupt";
    }
  }
};

/** @internal */
export const renderDefectError = (error: Error): string => {
  const [first] = splitLines(error.stack ?? `${error.name}: ${error.message}`);
  const head = Str.startsWith("Error: ")(first)
    ? `Defect: ${Str.slice(7)(first)}`
    : `Defect: ${first}`;
  return Arr.join([head, ...Arr.map(errorStackLines(error), (line) => `  ${line}`)], "\n");
};

const errorStackLines = (error: Error): ReadonlyArray<string> => {
  const [, ...rest] = splitLines(error.stack ?? `${error.name}: ${error.message}`);
  return Fn.pipe(
    rest,
    Arr.filter((line) => !isNoiseFrame(line)),
    Arr.map((line) => frameLabel(line)),
    Arr.take(5),
  );
};

const frameLocation = (line: string): string | undefined => {
  const open = Str.lastIndexOf("(")(line);
  return Option.isSome(open)
    ? Str.slice(open.value + 1, -1)(line)
    : Fn.pipe(line, Str.trim, Str.replace(/^at /, ""));
};

const isNoiseFrame = (line: string): boolean => {
  const location = frameLocation(line);
  return (
    location === undefined ||
    Str.includes("node_modules/")(location) ||
    Str.startsWith("node:")(location)
  );
};

const frameLabel = (line: string): string => {
  const location = frameLocation(line);
  if (location === undefined) {
    return line;
  }
  const frame = parseStackLocation(location);
  return frame === undefined ? `at ${location}` : `at ${frame.path}:${frame.line}:${frame.column}`;
};

const renderCause = (cause: unknown): string | undefined => {
  const body = renderCauseBody(cause);
  return body === undefined ? undefined : `Cause: ${body}`;
};

const renderCauseBody = (cause: unknown, depth = 0): string | undefined => {
  if (cause === undefined) {
    return undefined;
  }
  const [first, ...rest] = renderCauseLines(cause, depth);
  return Arr.join([first, ...Arr.map(rest, (line) => `  ${line}`)], "\n");
};

// oxlint-disable-next-line complexity
const renderCauseLines = (cause: unknown, depth: number): ReadonlyArray<string> => {
  if (Schema.is(StepTimeoutError)(cause)) {
    return [`${cause._tag}: ${cause.message} (timeout: ${Duration.format(cause.timeout)})`];
  }
  if (Schema.isSchemaError(cause)) {
    return splitLines(formatSchemaIssue(cause.issue));
  }
  if (hasStringTag(cause)) {
    return renderTaggedCause(cause, depth);
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

// oxlint-disable-next-line complexity
const renderTaggedCause = (
  cause: { readonly _tag: string },
  depth: number,
): ReadonlyArray<string> => {
  const message =
    Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message)
      ? cause.message
      : undefined;
  const head = message === undefined ? cause._tag : `${cause._tag}: ${message}`;
  const fields = Fn.pipe(
    Record.toEntries<string, unknown>(cause),
    Arr.filter(([key]) => !Arr.contains(key)(causeMetadataKeys)),
  );
  const lines = [head, ...Arr.map(fields, ([key, value]) => `${key}: ${renderCauseValue(value)}`)];
  const stackLines = Predicate.isError(cause)
    ? Arr.map(errorStackLines(cause), (line) => `  ${line}`)
    : [];
  const nestedCause = Predicate.hasProperty(cause, "cause") ? cause.cause : undefined;
  const nested = depth < 2 ? renderCauseBody(nestedCause, depth + 1) : undefined;
  const nestedLines = nested === undefined ? [] : renderNestedCause(nested);
  return Arr.appendAll(Arr.appendAll(lines, stackLines), nestedLines);
};

const renderNestedCause = (nested: string): ReadonlyArray<string> => {
  const [nestedFirst, ...nestedRest] = Str.split(nested, "\n");
  return [`cause: ${nestedFirst}`, ...Arr.map(nestedRest, (line) => `  ${line}`)];
};

const renderCauseValue = (value: unknown): string =>
  Predicate.isError(value)
    ? value.message
    : Predicate.isString(value)
      ? value
      : Inspectable.toStringUnknown(value, 0);

const hasStringTag = (u: unknown): u is { readonly _tag: string } =>
  Predicate.isObject(u) && Predicate.hasProperty(u, "_tag") && Predicate.isString(u._tag);

const splitLines = (text: string): ReadonlyArray<string> =>
  Fn.pipe(
    Str.split(text, "\n"),
    Arr.map((line) => Str.trimStart(line)),
  );

const indentText = (text: string, spaces: number): string =>
  Fn.pipe(
    Str.split(text, "\n"),
    Arr.map((line) => `${Str.repeat(spaces)(" ")}${line}`),
    Arr.join("\n"),
  );

const formatSchemaIssue = SchemaIssue.makeFormatterDefault();

const causeMetadataKeys: ReadonlyArray<string> = ["_tag", "message", "name", "stack", "cause"];

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
