import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // NFR-002 target is Vitest coverage >= 80% (TIS §1527, Solution Design
      // §479). The suite currently sits well above that (statements/lines ~96%,
      // functions ~97%, branches ~85%); thresholds are pinned a few points
      // under the measured numbers so a real regression fails CI while normal
      // churn does not. Never drop below the documented 80% floor.
      thresholds: {
        statements: 93,
        lines: 93,
        functions: 93,
        branches: 80,
      },
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
