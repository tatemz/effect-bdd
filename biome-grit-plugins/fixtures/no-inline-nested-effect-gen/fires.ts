import * as Effect from "effect/Effect"

export const program = (flag: boolean) =>
  flag
    ? Effect.gen(function*() {
      return yield* Effect.succeed(1)
    })
    : Effect.succeed(0)
