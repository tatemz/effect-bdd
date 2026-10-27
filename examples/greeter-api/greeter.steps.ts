import { Bdd } from "effect-bdd";
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { type Language, Greeter, LanguageSchema } from "./greeter.ts";
import { Api, HealthHandlers } from "./api.ts";
import { startApp } from "./server.ts";

/** Captures a language name from a step, validated by the `Language` schema. */
const language = Bdd.capture("language", LanguageSchema);

/** Captures an expected health status string from a step. */
const status = Bdd.capture("status", Schema.String);

/** Captures an expected greeting string from a step. */
const greeting = Bdd.capture("greeting", Schema.String);

/**
 * The served app for a language: the typed `Api` with its handlers, plus the
 * Greeter implementation for the request handlers to resolve. The scenario
 * picks the language by wiring `Greeter.layerFor(language)` in as the
 * request-scoped implementation.
 */
const apiApp = (language: Language) =>
  HttpRouter.provideRequest(Greeter.layerFor(language))(
    HttpApiBuilder.layer(Api).pipe(Layer.provide(HealthHandlers)),
  );

/** The health payload the server answered with. */
type Health = { readonly status: string; readonly greeting: string };

/** The scenario state: the running app plus the response it answered with. */
type AppState = Effect.Success<ReturnType<typeof startApp>> & { readonly health: Health };

/**
 * The Greeter API behavior as executable BDD.
 *
 * The scenario follows one `Given`, one `When`, one `Then`, and each keyword
 * does only its own job:
 *
 * - `Given` starts the real server on an ephemeral port with the chosen
 *   Greeter implementation. This is setup, so it does not touch the endpoint
 *   under test.
 * - `When` issues the single HTTP request the scenario is about and keeps the
 *   response.
 * - `Then` asserts on that response and makes no calls of its own.
 *
 * Steps are defined inline in each scenario pipe; only captures and the app
 * composition live at the top level. `Bdd.tap` runs at its declared position
 * in the scenario chain, reporting the state so far. `Bdd.tapError` observes
 * the scenario's failure and logs its tag and message; the scenario still
 * fails with the original error.
 */
export const greeterApi = Bdd.feature("Greeter API").pipe(
  Bdd.scenario("The health check greets in the chosen language").pipe(
    Bdd.tapError((failure) => {
      return Effect.logError(`[GreeterApi] ${failure._tag} - ${failure.message}`);
    }),
    Bdd.given`the app is running with the ${language} greeter`(({ language }) => {
      return startApp(apiApp(language));
    }),
    Bdd.when`the health check is requested`((app) => {
      return Effect.gen(function* () {
        const health: Health = yield* app.client.health();
        return { ...app, health };
      });
    }),
    Bdd.tap((state: AppState) => {
      return Effect.log(`[GreeterApi] step state: ${JSON.stringify(state.health)}`);
    }),
    Bdd.then`the response says status ${status} and greeting ${greeting}`(
      ({ status, greeting }, state) => {
        return Effect.gen(function* () {
          const { health } = state;
          if (health.status !== status) {
            return yield* Effect.fail(`health status was ${health.status}, expected ${status}`);
          }
          if (health.greeting !== greeting) {
            return yield* Effect.fail(
              `health greeting was ${health.greeting}, expected ${greeting}`,
            );
          }
          return state;
        });
      },
    ),
    Bdd.provide(FetchHttpClient.layer),
  ),
);
