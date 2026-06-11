import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"

export const doubled = (values: ReadonlyArray<number>): ReadonlyArray<number> => Arr.map(values, (value) => value * 2)

export const isList = (value: unknown): boolean => Arr.isArray(value)

export const effects = (values: ReadonlyArray<number>) => Effect.forEach(values, (value) => Effect.succeed(value))
