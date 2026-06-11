export const shout = (text: string): string => text.toUpperCase()

export const segments = (path: string): ReadonlyArray<string> => path.split("/")
