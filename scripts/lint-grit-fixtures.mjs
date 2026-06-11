/**
 * Validates every Grit rule in biome-grit-plugins against its fixture pair.
 *
 * Each rule stages an isolated Biome project in a temp directory containing
 * only that rule, then lints `fires.ts` (must produce a plugin diagnostic)
 * and `clean.ts` (must produce none). A rule whose `fires` fixture stops
 * firing is dead; fix the rule, never the assertion.
 */
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const pluginsDir = join(root, "biome-grit-plugins")
const fixturesDir = join(pluginsDir, "fixtures")
const biomeBinary = join(root, "node_modules", ".bin", "biome")

const ruleNames = readdirSync(pluginsDir)
  .filter((file) => file.endsWith(".grit"))
  .map((file) => basename(file, ".grit"))

const fixtureRuleNames = readdirSync(fixturesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

const isolatedBiomeConfig = (ruleFile) =>
  JSON.stringify({
    root: true,
    vcs: { enabled: false },
    formatter: { enabled: false },
    linter: { enabled: true, rules: { recommended: false } },
    plugins: [`./${ruleFile}`]
  })

const lintInIsolation = (stageDir, fixtureName) => {
  const result = spawnSync(biomeBinary, ["lint", fixtureName], {
    cwd: stageDir,
    encoding: "utf8"
  })
  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`
  }
}

const ruleViolations = (temporaryRoot, rule) => {
  const fires = join(fixturesDir, rule, "fires.ts")
  const clean = join(fixturesDir, rule, "clean.ts")
  const fixtureFiles = readdirSync(join(fixturesDir, rule), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
  if (!fixtureFiles.includes("fires.ts") || !fixtureFiles.includes("clean.ts")) {
    return [`${rule}.grit has no fixture pair; add fixtures/${rule}/fires.ts and clean.ts.`]
  }
  const stageDir = join(temporaryRoot, rule)
  mkdirSync(stageDir, { recursive: true })
  writeFileSync(join(stageDir, "biome.json"), isolatedBiomeConfig(`${rule}.grit`))
  copyFileSync(join(pluginsDir, `${rule}.grit`), join(stageDir, `${rule}.grit`))
  copyFileSync(fires, join(stageDir, "fires.ts"))
  copyFileSync(clean, join(stageDir, "clean.ts"))

  const firesResult = lintInIsolation(stageDir, "fires.ts")
  const cleanResult = lintInIsolation(stageDir, "clean.ts")
  const violations = []
  if (firesResult.exitCode === 0 || !firesResult.output.includes("plugin")) {
    violations.push(
      `fixtures/${rule}/fires.ts: rule did not register a diagnostic; the rule is dead or the fixture is stale.`
    )
  }
  if (cleanResult.exitCode !== 0) {
    violations.push(`fixtures/${rule}/clean.ts: rule flagged the clean fixture:\n${cleanResult.output}`)
  }
  return violations
}

const orphanViolations = fixtureRuleNames
  .filter((rule) => !ruleNames.includes(rule))
  .map((rule) => `fixtures/${rule} has no matching ${rule}.grit; delete it.`)

const temporaryRoot = mkdtempSync(join(tmpdir(), "effect-bdd-grit-fixtures-"))
let violations = [...orphanViolations]
try {
  for (const rule of ruleNames) {
    violations = [...violations, ...ruleViolations(temporaryRoot, rule)]
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}

if (violations.length > 0) {
  console.error(`Every grit rule needs a firing and a clean fixture that behave as expected:\n${violations.join("\n")}`)
  process.exit(1)
}

console.log(`Validated ${ruleNames.length} grit rule(s).`)
