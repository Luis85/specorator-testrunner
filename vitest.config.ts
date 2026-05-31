import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        // Runtime-bound surfaces (Obsidian API, Node child_process/fs) are
        // covered by manual/E2E testing, not unit tests. Port-driven adapters
        // such as RunnerTemplateWriter stay covered.
        "src/main.ts",
        "src/infrastructure/obsidian/**",
        "src/infrastructure/runner/node-child-process-runner.ts",
        "src/infrastructure/filesystem/node-absolute-file-system.ts",
        "src/presentation/**",
      ],
    },
  },
});
