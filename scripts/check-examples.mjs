/**
 * Extracts every fenced ```ts block under an `@example` JSDoc tag in the
 * public source modules and typechecks them against the real package types.
 *
 * Mirrors the docgen example-compile check used by effect-smol so examples
 * cannot drift from the API.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const sources = ["src/index.ts", "src/Bdd.ts", "src/Errors.ts", "README.md"]
const outDir = join(root, ".examples")

const fenceBody = (fence) => fence.split("\n").slice(1, -1).join("\n")

const extractExamples = (file) => {
  const text = readFileSync(join(root, file), "utf8")
  if (file.endsWith(".md")) {
    return (text.match(/```ts\n[\s\S]*?```/g) ?? []).map(fenceBody)
  }
  const examples = []
  const docComments = text.match(/\/\*\*[\s\S]*?\*\//g) ?? []
  for (const comment of docComments) {
    if (!comment.includes("@example")) continue
    for (const fence of comment.match(/```ts\n[\s\S]*?```/g) ?? []) {
      examples.push(
        fenceBody(fence)
          .split("\n")
          .map((line) => line.replace(/^\s*\* ?/, ""))
          .join("\n")
      )
    }
  }
  return examples
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

let count = 0
for (const file of sources) {
  for (const example of extractExamples(file)) {
    const name = `${file.replace(/[/.]/g, "-")}-${count}.ts`
    writeFileSync(join(outDir, name), `export {}\n${example}\n`)
    count += 1
  }
}

if (count === 0) {
  console.error("No @example blocks found; extraction is likely broken.")
  process.exit(1)
}

writeFileSync(
  join(outDir, "tsconfig.json"),
  JSON.stringify(
    {
      extends: "../tsconfig.json",
      include: ["./*.ts"],
      compilerOptions: {
        noEmit: true,
        rootDir: "..",
        allowImportingTsExtensions: true,
        noUnusedLocals: false,
        noUnusedParameters: false,
        paths: {
          "effect-bdd": ["../src/index.ts"],
          "effect-bdd/Bdd": ["../src/Bdd.ts"],
          "effect-bdd/Errors": ["../src/Errors.ts"]
        }
      }
    },
    null,
    2
  )
)

try {
  execFileSync("npx", ["tsc", "-p", outDir], { cwd: root, stdio: "inherit" })
  console.log(`Typechecked ${count} example(s).`)
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
