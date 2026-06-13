import type { ViteUserConfig } from "vitest/config";

const config: ViteUserConfig = {
  esbuild: {
    target: "es2022",
  },
  test: {
    include: ["test/**/*.test.ts", "oxlint-rules/**/*.test.mjs"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    fakeTimers: {
      toFake: undefined,
    },
    sequence: {
      concurrent: true,
    },
  },
};

export default config;
