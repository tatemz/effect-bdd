export const startedAt = (): number => Date.now()

export const parse = (raw: string): unknown => JSON.parse(raw)
