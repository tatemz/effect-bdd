import * as Effect from "effect/Effect";
import * as Fn from "effect/Function";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Str from "effect/String";
import { pathToFileURL } from "node:url";
import { ModuleLoadError } from "./errors.ts";
import { ModuleLoader } from "./moduleLoader.ts";

/**
 * A `ModuleLoader` that cache-busts every load: each call imports the module
 * with a fresh query string, so Node evaluates the current file contents
 * instead of returning the module cached from an earlier load.
 *
 * A normal CLI process exits after one run, so its loader can rely on the ESM
 * cache being cold. A watch session lives on, so its reruns need this layer
 * instead of `ModuleLoader.layer` to see step-definition edits. Each
 * generation re-evaluates the module and creates new feature definition
 * objects; nothing in the runner shares state across runs, so the extra
 * evaluations are safe.
 *
 * @internal
 */
export const reloadableModuleLoader: Layer.Layer<ModuleLoader, never, Path.Path> = Layer.effect(
  ModuleLoader,
  Effect.gen(function* () {
    const generation = yield* Ref.make(0);
    return ModuleLoader.of({
      load: (path) =>
        Effect.gen(function* () {
          const pathService = yield* Path.Path;
          const next = yield* Ref.updateAndGet(generation, (value) => value + 1);
          const resolved = pathService.resolve(path);
          return yield* Effect.tryPromise({
            try: (): Promise<Record<string, unknown>> =>
              import(`${pathToFileURL(resolved).href}?watch=${next}`).then((module) => module),
            catch: (cause) => moduleLoadError(resolved, cause),
          });
        }),
    });
  }),
);

const moduleLoadError = (path: string, cause: unknown): ModuleLoadError => {
  const reason = Predicate.isError(cause) ? cause.message : String(cause);
  const isTsLoaderFailure =
    Fn.pipe(reason, Str.includes("Unknown file extension")) && Fn.pipe(reason, Str.includes(".ts"));
  return new ModuleLoadError({
    path,
    message: isTsLoaderFailure
      ? `Could not load TypeScript step module "${path}". Register a TypeScript loader when running on Node, for example: node --import tsx ./node_modules/.bin/effect-bdd`
      : `Could not load step module "${path}": ${reason}`,
    cause,
  });
};
