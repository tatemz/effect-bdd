import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

export const startedAt = Clock.currentTimeMillis

export const parse = (raw: string): Effect.Effect<unknown, Schema.SchemaError> =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(raw)
