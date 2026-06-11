import * as Effect from "effect/Effect"

export const program = Effect.mapError(Effect.fail(new Error("boom")), (cause) => cause)
