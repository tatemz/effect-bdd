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
      to: { path: "^(?:test|examples|typetest|dist|coverage)/" },
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
  ],
  options: {
    combinedDependencies: true,
    doNotFollow: {
      path: "node_modules",
    },
    exclude: {
      path: "(^|/)(?:coverage|dist|node_modules|\\.examples)(/|$)",
    },
    tsConfig: {
      fileName: "tsconfig.json",
    },
    tsPreCompilationDeps: true,
  },
};

export default config;
