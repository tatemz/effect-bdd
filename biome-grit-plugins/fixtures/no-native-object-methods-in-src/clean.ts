import * as Record_ from "effect/Record"

export const names = (input: Record<string, number>): ReadonlyArray<string> => Record_.keys(input)
