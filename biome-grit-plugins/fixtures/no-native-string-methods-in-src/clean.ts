import { pipe } from "effect/Function"
import * as Str from "effect/String"

export const shout = (text: string): string => pipe(text, Str.toUpperCase)

export const segments = (path: string): ReadonlyArray<string> => Str.split(path, "/")
