import { Effect, Schema } from "effect";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  OpenApi,
} from "effect/http-api";
import { Greeter } from "./greeter.ts";

/**
 * The typed body of the health endpoint, shared by server and client.
 *
 * A tagged `"ok"` status plus the greeter's greeting, so the wire shape and
 * the decoded client type cannot drift apart.
 */
const HealthResponse = Schema.Struct({
  status: Schema.tag("ok"),
  greeting: Schema.String,
});

/**
 * The system group, marked `topLevel` so its endpoint sits directly on the
 * generated client as `client.health()`.
 */
class SystemApi extends HttpApiGroup.make("system", { topLevel: true }).add(
  HttpApiEndpoint.get("health", "/health", {
    success: HealthResponse,
  }).annotateMerge(
    OpenApi.annotations({
      summary: "Report service health",
      description: "Answers with the greeting of the configured Greeter.",
    }),
  ),
) {}

/**
 * The whole API contract, schema-first. Serving, the OpenAPI document, and
 * the typed client all derive from this single definition, so server
 * responses, docs, and clients cannot drift apart.
 */
export class Api extends HttpApi.make("greeter-api")
  .add(SystemApi)
  .annotateMerge(
    OpenApi.annotations({
      title: "Greeter API",
      version: "0.1.0",
    }),
  ) {}

/** The client type generated from `Api`: one method per endpoint. */
export type ApiClient = HttpApiClient.ForApi<typeof Api>;

/**
 * The `system` group implementation. The handler requires the request-scoped
 * `Greeter`, which the caller provides per request with
 * `HttpRouter.provideRequest` before the routes are served.
 */
export const HealthHandlers = HttpApiBuilder.group(Api, "system", (handlers) =>
  handlers.handleAll({
    health: Effect.fn("GreeterApi.health")(function* () {
      const greeter = yield* Greeter;
      const greeting = yield* greeter.greet;
      return { status: "ok", greeting };
    }),
  }),
);
