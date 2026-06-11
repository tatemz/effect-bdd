import * as Arr from "effect/Array"

export const total = (values: ReadonlyArray<number>): number =>
  Arr.reduce(values, 0, (sum, value) => sum + value)
