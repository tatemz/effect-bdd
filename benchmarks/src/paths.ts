import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const benchmarkRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(benchmarkRoot);
export const resultsRoot = path.join(benchmarkRoot, "results");

export const fromRepoRoot = (...segments: ReadonlyArray<string>): string =>
  path.join(repoRoot, ...segments);

export const fromBenchmarkRoot = (...segments: ReadonlyArray<string>): string =>
  path.join(benchmarkRoot, ...segments);

export const displayPath = (absolutePath: string): string => path.relative(repoRoot, absolutePath);
