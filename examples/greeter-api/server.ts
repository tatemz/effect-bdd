import { NodeHttpServer } from "@effect/platform-node";
import { Context, Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder, HttpApiClient } from "effect/http-api";
import * as NetAddress from "effect/net/NetAddress";
import { createServer } from "node:http";
import { Api, HealthHandlers, type ApiClient } from "./api.ts";
import { type Language, Greeter } from "./greeter.ts";

/**
 * The served API routes: the typed `Api` with its handlers, plus the Greeter
 * implementation for the request handlers to resolve.
 *
 * A scenario picks the language by piping `Greeter.layerFor(language)` in as
 * the request-scoped implementation.
 */
const apiApp = (language: Language) =>
  HttpRouter.provideRequest(Greeter.layerFor(language))(
    HttpApiBuilder.layer(Api).pipe(Layer.provide(HealthHandlers)),
  );

/**
 * Builds the served app and returns the bound port and a typed client for it.
 *
 * The server runs until the surrounding scope closes; port `0` picks an
 * ephemeral port, which is how each scenario gets an isolated server.
 */
export const startApp = (language: Language) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      HttpRouter.serve(apiApp(language), { disableListenLog: true }).pipe(
        Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: 0 })),
      ),
    );
    const address = Context.get(context, HttpServer.HttpServer).address;
    if (!NetAddress.isInetAddress(address)) {
      return yield* Effect.die(`startApp expects an inet address, got ${address._tag}`);
    }
    const port = address.port;
    const client: ApiClient = yield* HttpApiClient.make(Api, {
      baseUrl: `http://127.0.0.1:${port}`,
    });
    return { port, client };
  });
