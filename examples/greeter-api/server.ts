import { NodeHttpServer } from "@effect/platform-node";
import { Context, Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import * as NetAddress from "effect/net/NetAddress";
import { createServer } from "node:http";
import { Api, type ApiClient } from "./api.ts";

/**
 * Starts the given app layer on an ephemeral port and returns the bound port
 * and a typed client for it.
 *
 * The caller owns the app: it composes the layers it wants served — handlers,
 * implementations, request-scoped wiring — and hands the finished layer here.
 * The server runs until the surrounding scope closes; port `0` picks an
 * ephemeral port, which is how each scenario gets an isolated server.
 */
export const startApp = <A, E, R>(app: Layer.Layer<A, E, R>) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      HttpRouter.serve(app, { disableListenLog: true }).pipe(
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
