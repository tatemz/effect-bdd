export const doubled = (values: ReadonlyArray<number>): ReadonlyArray<number> => values.map((value) => value * 2)

export const isList = (value: unknown): boolean => Array.isArray(value)
