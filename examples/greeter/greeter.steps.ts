import { Bdd } from "effect-bdd";
import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { LanguageSchema } from "./greeter.ts";
import { startApp } from "./server.ts";

/** Captures a language name from a step, validated by the `Language` schema. */
const language = Bdd.capture("language", LanguageSchema);

/** Captures an expected health status string from a step. */
const status = Bdd.capture("status", Schema.String);

/** Captures an expected greeting string from a step. */
const greeting = Bdd.capture("greeting", Schema.String);

/**
 * The running app: the bound port plus the typed client for calling it.
 */
type RunningApp = Effect.Success<ReturnType<typeof startApp>>;

/**
 * The Greeter API behavior as executable BDD.
 *
 * Steps are defined inline in each scenario pipe; only captures live at the
 * top level. Each scenario boots the real server on an ephemeral port with
 * the chosen Greeter implementation and asserts through the typed client.
 *
 * `Bdd.tap` runs after every step of every scenario, reporting the state so
 * far. `Bdd.tapError` observes any failure and logs its tag and message; the
 * scenario still fails with the original error.
 */
export const greeterApi = Bdd.feature("Greeter API").pipe(
  Bdd.tapError((failure) => Effect.logError(`[GreeterApi] ${failure._tag} - ${failure.message}`)),
  Bdd.tap((state) => Effect.log(`[GreeterApi] step state: ${JSON.stringify(state)}`)),
  Bdd.scenario("The health check greets in the chosen language").pipe(
    Bdd.given`the app is using the ${language} greeter`(({ language }) =>
      Effect.succeed({ language }),
    ),
    Bdd.when`the app is running`((state) => startApp(state.language)),
    Bdd.then`the health check says status ${status} and greeting ${greeting}`(
      Effect.fn("GreeterApi.healthCheckSays")(function* (
        { status, greeting }: { readonly status: string; readonly greeting: string },
        state: RunningApp,
      ) {
        const health = yield* state.client.health();
        if (health.status !== status) {
          return yield* Effect.fail(`health status was ${health.status}, expected ${status}`);
        }
        if (health.greeting !== greeting) {
          return yield* Effect.fail(`health greeting was ${health.greeting}, expected ${greeting}`);
        }
        return state;
      }),
    ),
    Bdd.provide(FetchHttpClient.layer),
  ),
);
