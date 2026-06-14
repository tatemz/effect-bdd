/** @internal */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as Fn from "effect/Function";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as CliError from "effect/unstable/cli/CliError";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import PackageJson from "../package.json" with { type: "json" };
import { GlobResolver } from "./internal/cli/glob.ts";
import { isFatalDiagnostic, type CliOptions } from "./internal/cli/models.ts";
import { ModuleLoader } from "./internal/cli/moduleLoader.ts";
import * as Reporter from "./internal/cli/reporter.ts";
import * as Runner from "./internal/cli/runner.ts";
import * as CucumberCompiler from "./internal/cucumberCompiler.ts";

const features = Flag.string("features").pipe(
  Flag.withAlias("f"),
  Flag.withDescription("Feature file glob. Can be supplied multiple times."),
  Flag.between(1, Infinity),
);

const steps = Flag.string("steps").pipe(
  Flag.withAlias("s"),
  Flag.withDescription("Step definition module glob. Can be supplied multiple times."),
  Flag.between(1, Infinity),
);

const reporter = Flag.choice("reporter", ["text", "html", "json", "junit"] as const).pipe(
  Flag.withAlias("r"),
  Flag.withDescription("Reporter to run. Can be supplied multiple times."),
  Flag.between(0, Infinity),
);

const outputFileText = Flag.file("output-file.text").pipe(
  Flag.withDescription("File path for the text reporter. Defaults to stdout."),
  Flag.optional,
);

const outputFileHtml = Flag.file("output-file.html").pipe(
  Flag.withDescription("File path for the html reporter."),
  Flag.optional,
);

const outputFileJson = Flag.file("output-file.json").pipe(
  Flag.withDescription("File path for the json reporter. Defaults to stdout."),
  Flag.optional,
);

const outputFileJunit = Flag.file("output-file.junit").pipe(
  Flag.withDescription("File path for the junit reporter."),
  Flag.optional,
);

const parallel = Flag.integer("parallel").pipe(
  Flag.withAlias("p"),
  Flag.withDescription("Number of scenarios to run concurrently."),
  Flag.filter(
    (value) => value > 0,
    (value) => `Expected --parallel to be greater than 0, got ${value}`,
  ),
  Flag.withDefault(1),
);

const stepTimeout = Flag.string("step-timeout").pipe(
  Flag.withDescription(
    'Maximum duration for each step, using Effect Duration input such as "500 millis" or "5 seconds".',
  ),
  Flag.mapTryCatch(
    (value) => parseStepTimeout(value),
    () =>
      'Expected --step-timeout to be a positive finite Effect duration, such as "500 millis" or "5 seconds"',
  ),
  Flag.optional,
);

function parseStepTimeout(value: string): Duration.Duration {
  return Fn.pipe(
    Duration.fromInput(value as Duration.Input),
    Option.filter((duration) => Duration.isPositive(duration) && Duration.isFinite(duration)),
    Option.getOrThrowWith(
      () =>
        new Error(
          'Expected --step-timeout to be a positive finite Effect duration, such as "500 millis" or "5 seconds"',
        ),
    ),
  );
}

const verbose = Flag.boolean("verbose").pipe(
  Flag.withAlias("v"),
  Flag.withDescription("Print every scenario result instead of only failures and diagnostics."),
);

const tags = Flag.string("tags").pipe(
  Flag.withAlias("t"),
  Flag.withDescription("Cucumber-style tag expression. Can be supplied multiple times."),
  Flag.between(0, Infinity),
);

const title = Flag.string("title").pipe(
  Flag.withAlias("n"),
  Flag.withDescription(
    "Run scenarios whose feature/scenario title contains this text. Can be supplied multiple times.",
  ),
  Flag.between(0, Infinity),
);

const failFast = Flag.boolean("fail-fast").pipe(
  Flag.withDescription("Stop after the first failed scenario. Runs sequentially when enabled."),
);

const strict = Flag.boolean("strict").pipe(
  Flag.withDescription("Fail when any loaded feature or scenario definition is unused."),
);

/** @internal */
export const cli = Command.make(
  "effect-bdd",
  {
    features,
    steps,
    reporter,
    outputFileText,
    outputFileHtml,
    outputFileJson,
    outputFileJunit,
    parallel,
    stepTimeout,
    verbose,
    tags,
    title,
    failFast,
    strict,
  },
  Effect.fnUntraced(function* ({
    features,
    steps,
    reporter,
    outputFileText,
    outputFileHtml,
    outputFileJson,
    outputFileJunit,
    parallel,
    stepTimeout,
    verbose,
    tags,
    title,
    failFast,
    strict,
  }) {
    const options: CliOptions = {
      features,
      steps,
      reporters: reporter.length === 0 ? ["text"] : reporter,
      outputFiles: {
        ...(Option.isSome(outputFileText) ? { text: outputFileText.value } : {}),
        ...(Option.isSome(outputFileHtml) ? { html: outputFileHtml.value } : {}),
        ...(Option.isSome(outputFileJson) ? { json: outputFileJson.value } : {}),
        ...(Option.isSome(outputFileJunit) ? { junit: outputFileJunit.value } : {}),
      },
      verbose,
      filters: {
        tags,
        titles: title,
        failFast,
      },
      strict,
      parallel,
      ...(Option.isSome(stepTimeout) ? { stepTimeout: stepTimeout.value } : {}),
    };
    const reporters = yield* Reporter.makeReporters(options.reporters, options.outputFiles, {
      verbose,
    }).pipe(Effect.mapError(toUserError));
    const result = yield* Runner.run(options).pipe(Effect.mapError(toUserError));
    yield* Reporter.emitAll(reporters, result).pipe(Effect.mapError(toUserError));
    const failingDiagnostics = strict
      ? result.diagnostics
      : Arr.filter(result.diagnostics, isFatalDiagnostic);
    if (result.summary.failed > 0 || failingDiagnostics.length > 0) {
      return yield* Effect.fail(
        new CliError.UserError({
          cause:
            result.summary.failed > 0
              ? `${result.summary.failed} scenario(s) failed`
              : `${failingDiagnostics.length} diagnostic(s) reported`,
        }),
      );
    }
  }),
).pipe(
  Command.withDescription("Run effect-bdd feature files"),
  Command.provide(
    Layer.mergeAll(GlobResolver.layer, ModuleLoader.layer, CucumberCompiler.layerCucumber),
  ),
);

/** @internal */
export const run = Command.run(cli, {
  version: PackageJson.version,
});

const toUserError = (error: { readonly message: string }): CliError.UserError =>
  new CliError.UserError({ cause: error.message });
