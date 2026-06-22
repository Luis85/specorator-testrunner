import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // The published `obsidian` package is types-only (no runtime entry), so
    // presentation modules that import a value from it (Notice, setIcon) need a
    // runtime stand-in to be unit-testable. Alias it to a tiny test stub.
    alias: {
      obsidian: fileURLToPath(new URL("./tests/__stubs__/obsidian.ts", import.meta.url)),
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // NFR-002 floor is Vitest coverage >= 80% (TIS §1527, Solution Design
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
        // The two halves of main.ts's onload, extracted to keep the composition
        // root under the size budget: composeServices is straight-line service
        // wiring and registerViews is `plugin.registerView` factory plumbing —
        // both runtime-bound composition-root code, unit-test-exempt exactly as
        // main.ts is (no pure logic to assert).
        "src/compose-services.ts",
        "src/register-views.ts",
        "src/infrastructure/obsidian/**",
        // node-child-process-runner.ts and node-absolute-file-system.ts are
        // covered by integration-style adapter tests
        // (tests/node-child-process-runner.test.ts, P4-1;
        // tests/node-absolute-file-system.test.ts).
        //
        // Within presentation, only the Obsidian-runtime-bound surfaces
        // (ItemView/Modal/PluginSettingTab subclasses, command registration)
        // stay excluded; pure projection/format/scheduler/launcher modules
        // count toward coverage.
        "src/presentation/views/*-view.ts",
        "src/presentation/views/*-modal.ts",
        // WS-B1 / ADR-0031: the host-agnostic section bodies extracted from the
        // explorer & dashboard views so the Test Hub shell can render them in-leaf,
        // plus the two thin DOM-writer helpers they share and the deps/types module.
        // DOM-building only — the pure projections (`*-rows.ts`) they call stay
        // covered; the SAME exemption as the `*-view.ts` files they were lifted from
        // (mirrors the feature-editor-structured / settings-* extractions below).
        "src/presentation/views/*-body.ts",
        "src/presentation/views/list-header.ts",
        "src/presentation/views/link-button-cell.ts",
        "src/presentation/views/dashboard-view-deps.ts",
        // The Feature Editor's structured sub-renderers (scenario/step/examples
        // cards), extracted from feature-editor-view.ts to keep it under the
        // size budget. DOM-building only — the pure editing logic they call
        // lives in (and is covered through) feature-editor-format.ts.
        "src/presentation/views/feature-editor-structured.ts",
        "src/presentation/views/feature-editor-scenario.ts",
        "src/presentation/settings/settings-tab.ts",
        // The settings tab's extracted sections + their shared helpers — the
        // SUT-environment and maintenance/CI rows split out to keep settings-tab
        // under the size budget. Runtime-bound Obsidian Setting wiring, same as
        // settings-tab itself; the pure row projections stay in (and are covered
        // through) settings-rows.ts.
        "src/presentation/settings/settings-shared.ts",
        "src/presentation/settings/settings-environments.ts",
        "src/presentation/settings/settings-maintenance.ts",
        "src/presentation/settings/add-environment-modal.ts",
        "src/presentation/commands/register-commands.ts",
      ],
    },
  },
});
