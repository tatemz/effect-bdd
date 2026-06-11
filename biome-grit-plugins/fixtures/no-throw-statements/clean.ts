import * as Effect from "effect/Effect"

export const explode = Effect.fail(new Error("boom"))
