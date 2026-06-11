import * as Effect from "effect/Effect"
import { pipe } from "effect/Function"

export const program = pipe(Effect.succeed(1), Effect.map((value) => value + 1))
