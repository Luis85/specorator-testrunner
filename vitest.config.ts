import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        // Obsidian-bound surfaces are covered by manual/E2E testing, not unit
        // tests, since they require the Obsidian runtime.
        "src/main.ts",
        "src/infrastructure/obsidian/**",
        "src/presentation/**",
      ],
    },
  },
});
