import * as Effect from "effect/Effect"

const one = Effect.gen(function*() {
  return yield* Effect.succeed(1)
})

export const program = (flag: boolean) => (flag ? one : Effect.succeed(0))
