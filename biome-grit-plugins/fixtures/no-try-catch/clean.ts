import * as Effect from "effect/Effect"

export const risky = (run: () => number) =>
  Effect.try({
    try: run,
    catch: (cause) => new Error(String(cause))
  })
