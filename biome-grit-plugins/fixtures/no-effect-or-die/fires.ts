import * as Effect from "effect/Effect"

export const program = Effect.orDie(Effect.fail(new Error("boom")))
