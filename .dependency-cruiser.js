/** @type {import("dependency-cruiser").IConfiguration} */
const config = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Import cycles hide layering inversions; split the shared decision or dependency instead.",
      from: {},
      to: { circular: true },
    },
    {
      name: "production-does-not-import-tests",
      severity: "error",
      comment: "Production modules never reach into tests, examples, or generated scratch space.",
      from: { path: "^(?:src|scripts|oxlint-rules)/" },
      to: { path: "^(?:test|examples|benchmarks|typetest|dist|coverage)/" },
    },
    {
      name: "production-does-not-use-dev-dependencies",
      severity: "error",
      comment:
        "Runtime source must not depend on devDependencies; promote the dependency or isolate it in tests/tools.",
      from: { path: "^src/" },
      to: { dependencyTypes: ["npm-dev"], dependencyTypesNot: ["type-only"] },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment: "Don't import local modules that cannot be resolved; broken paths break the build.",
      from: {},
      to: {
        couldNotResolve: true,
        path: "^(?:\\.|/|src/|test/|scripts/|examples/|benchmarks/|oxlint-rules/)",
      },
    },
    {
      name: "not-to-undeclared",
      severity: "error",
      comment:
        "Every runtime import must be a declared dependency (incl. peer), not a hoisted accident.",
      from: { path: "^src/" },
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
    {
      name: "cucumber-only-in-adapter",
      severity: "error",
      comment:
        "@cucumber/* is a swappable infrastructure detail; only the Cucumber adapter may depend on it at runtime. Core depends on the GherkinCompiler port instead.",
      from: { path: "^src/", pathNot: "^src/internal/cucumberCompiler\\.ts$" },
      to: { path: "node_modules/@cucumber/", dependencyTypesNot: ["type-only"] },
    },
    {
      name: "core-does-not-import-cli",
      severity: "error",
      comment:
        "The reusable BDD library stays below the CLI; command wiring depends on core, never the other way around.",
      from: {
        path: "^src/(?:Bdd|Errors|index|internal/(?!cli/).+)\\.ts$",
      },
      to: {
        path: "^src/(?:bin|main|internal/cli/)",
      },
    },
    {
      name: "cli-internals-do-not-import-entrypoints",
      severity: "error",
      comment: "CLI internals are reusable services; bin/main are the outer runtime boundary.",
      from: { path: "^src/internal/cli/" },
      to: { path: "^src/(?:bin|main)\\.ts$" },
    },
    {
      name: "tests-do-not-import-dist",
      severity: "error",
      comment: "Tests exercise source or the example package explicitly; dist is generated output.",
      from: { path: "^(?:test|typetest|oxlint-rules)/" },
      to: { path: "^dist/" },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "Orphan modules are usually dead code or a missing wiring; delete or import them.",
      from: {
        orphan: true,
        path: "^src/",
        pathNot: [
          "\\.d\\.ts$",
          "^src/(?:bin|index)\\.ts$",
          "(^|/)(?:tsconfig|vitest\\.config|tstyche)",
          "(^|/)\\.[^/]+\\.(js|cjs|mjs)$",
        ],
      },
      to: {},
    },
  ],
  options: {
    combinedDependencies: true,
    doNotFollow: {
      path: "node_modules",
    },
    exclude: {
      path: "(^|/)(?:coverage|dist|node_modules|benchmarks/(?:dist|generated|results)|\\.examples|\\.effect-bdd-[^/]+)(/|$)",
    },
    tsConfig: {
      fileName: "tsconfig.json",
    },
    tsPreCompilationDeps: true,
  },
};

export default config;
