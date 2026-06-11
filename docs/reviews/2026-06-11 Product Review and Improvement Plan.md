# Product Review & Improvement Plan — 2026-06-11

_Consolidated from a five-track review (product/UX, code quality of the run-execution surface, application services, presentation layer, testing/CI/release readiness, and documentation accuracy). Builds on — and assumes — the completed "V1 Review and Improvement Plan" (2026-05-31)._

## 1. Executive summary

The codebase remains healthy: layering is lint-enforced, all 673 tests pass, lint/format/typecheck/coverage gate CI, and the Obsidian developer-policy checks (no `innerHTML`, `normalizePath` at boundaries, leveled logging, cleaned-up timers) all come back clean. The improvements below concentrate in five themes:

1. **Run-execution robustness** — races and missing escalation around cancel/complete, a missing `catch` that can wedge the UI in "running", and a stuck child that can permanently block the ADR-0018 run slot.
2. **Release safety** — the release workflow publishes without verifying the tag against `manifest.json` and without running tests; `versions.json` is validated nowhere.
3. **UX polish** — an unconfirmed destructive Reset, a glossary breach in settings copy ("Runner folder"), silent failures (init failure with closed modal, dead open-note buttons), dead-end error states, and accessibility regressions (`role="link"` on `<tr>`).
4. **Docs drift** — the README badly understated implemented scope; architecture docs denied the existence of shipped views/services.
5. **Test/tooling gaps** — typecheck didn't cover `tests/`/`scripts/`, coverage excluded tested presentation modules, and two unit-testable modules had no tests.

## 2. Implemented in this pass

### A. Run-execution correctness (`src/application/services/test-execution-service.ts`, `src/infrastructure/runner/node-child-process-runner.ts`, `src/shared/event-bus/event-bus.ts`, `src/main.ts`)

| ID | Item |
| --- | --- |
| A1 | `cancel()` re-checks `processClosed`/terminated **after** its `await` window so it can no longer re-label a run that completed during the await. |
| A2 | `execute()` catches non-`Result` throws after `testrun.started` and routes them through the `testrun.failed` terminal event (status `errored`) so the console can never be left "running" forever. |
| A3 | POSIX cancel escalates SIGTERM → SIGKILL (≈5 s) so a signal-ignoring child cannot permanently occupy the ADR-0018 run slot. |
| A4 | Windows cancel no longer runs `taskkill` synchronously on the renderer thread. |
| A5 | Streaming runs no longer accumulate unbounded stdout/stderr in memory; a bounded tail is kept for error context. |
| A6 | `NodeChildProcessRunner.disposeAll()` kills any remaining children (e.g. an in-flight `npm install`) on plugin unload. |
| A7 | EventBus guards its `onHandlerError` callback so a throwing error-callback cannot skip remaining subscribers. |

### B. Application services

| ID | Item |
| --- | --- |
| B1 | `environment-validation-service.ts`: removed the forced `as { ok: true }` cast (used the already-computed runner path instead). |
| B2 | `use-case-service.ts`: frontmatter status/automation/run-status/scope values are validated against the domain enums with safe fallbacks instead of being cast blindly (hand-edited notes can no longer inflate the Passing KPI). |
| B3 | `evidence-generation-service.ts`: the `createFolder` `Result` is checked before writing the evidence note. |
| B4 | Dead port methods `VaultFileSystem.listFiles` and `WorkspacePort.revealInExplorer` removed (no callers). |
| B5 | Duplicated `slugify`/`sanitizeFileName` helpers consolidated into a shared util. |
| B6 | `pipeline-generation-service.ts`: removed the injected-but-unused `CommandSafetyPolicy` and corrected the comment that claimed it was used. |
| B7 | `demo-content-service.ts`: creation events are only published when the file was actually created (no phantom `usecase.created` on reset/re-init). |

### C. UX / presentation

| ID | Item |
| --- | --- |
| C1 | "Reset Test Hub" now uses the same two-click arm/confirm pattern as "Remove environment", is disabled while running, and failures surface a Notice. |
| C2 | Glossary breach fixed: "Runner folder" → ".testrunner folder" (CONTEXT.md explicitly forbids "Runner folder"); related "runner" copy audited. |
| C3 | Initialization Wizard: turning off "Install dependencies" now visibly turns off and disables the "Install browser" toggle (no more silent desync); initialization failure raises a Notice even if the modal was closed. |
| C4 | Run-history tables (Dashboard, Evidence Explorer) keep proper table semantics: the Run ID cell is the link-button (the pattern the Use Cases table already used); whole-row click remains as a convenience. Shared keyboard-activation helper extracted. |
| C5 | Every view's error state gained a Retry button (previously dead ends until an unrelated event fired). |
| C6 | Test Console opened mid-run now shows the "running" banner and seeds the elapsed timer from the active run's real start time. |
| C7 | Enter-to-submit unified across all single-line modals (including the slug prompt, which was missing it) via a shared helper. |
| C8 | Internal decision IDs (AD-4, ADR-0017) removed from end-user copy. |
| C9 | Command palette names normalized to Obsidian's sentence-case convention while keeping glossary proper nouns (Use Case, Test Suite, Test Hub…). |
| C10 | "New …" vs "Create …" verb seam unified. |
| C11 | Use Case detail header gained an "All Use Cases" back-navigation button. |
| C12 | Settings: CI section copy made concrete (GitHub Actions), top-level `h2` removed per Obsidian guidelines, Esc-closing the dialog now flushes (not cancels) pending debounced saves. |
| C13 | Disabled console toolbar buttons mirror their aria-label into a visible tooltip. |
| C14 | Small fixes: Evidence filter options capitalized; label wraps the select (no hardcoded id); "Run Test Suite" aria-label; "View all runs" hidden when there are no runs; `openFile` failures surface a Notice everywhere (dead-button fix); dead `statusModifier` identity and constant `shouldShowOnboarding` parameter removed. |

### D. CI / release / tooling

| ID | Item |
| --- | --- |
| D1 | `release.yml`: verifies the tag matches `manifest.json` version and runs lint + typecheck + tests before publishing; `timeout-minutes` added. |
| D2 | `ci.yml` / `e2e-smoke.yml`: `concurrency` groups (cancel-in-progress) and `timeout-minutes`; the smoke job no longer re-fires for unrelated label events. |
| D3 | `tests/integration/release-validation.test.ts`: asserts `versions.json[manifest.version] === manifest.minAppVersion`. |
| D4 | `vitest.config.ts`: coverage exclusion narrowed so tested pure presentation modules (`*-rows.ts`, `*-format.ts`, `run-launcher.ts`, `render-scheduler.ts`) count toward the NFR-002 gate; only truly runtime-bound files (views/modals/settings-tab/register-commands) stay excluded. |
| D5 | `npm run typecheck` now type-checks `tests/` and `scripts/` (via `tsconfig.eslint.json`). |
| D6 | New tests: `render-scheduler` (pure scheduling logic) and `node-absolute-file-system` (tmpdir-based; coverage exclusion removed). |
| D7 | `.github/dependabot.yml` added (github-actions + npm). |
| D8 | `manifest.json`: `authorUrl` added; `.gitignore` trailing-newline fixed. |

### E. Documentation

| ID | Item |
| --- | --- |
| E1 | README: Status paragraph now reflects EPIC-001…010 as implemented; repository layout shows the five-layer `src/`, `tests/`, `scripts/`, all three workflows; npm script list completed. |
| E2 | Building Block View: naming notes reconciled (EvidenceExplorerView / UseCaseDetailView / `presentation/commands/` exist; layer lint **is** enforced); §5.16–5.18 added for DemoContentService, FeatureInsightService, RunHistoryService. |
| E3 | Event Catalog §19: stale `usecase.indexed` correlation row fixed. |
| E4 | CONTEXT.md: "monitor" → Test Console. |
| E5 | CHANGELOG.md and CONTRIBUTING.md added. |

### F. Shared kernel / infrastructure robustness

| ID | Item |
| --- | --- |
| F1 | `obsidian-data-store.ts`: `load()` no longer lets a corrupt/truncated `data.json` reject through `onload` and brick the plugin — it logs and falls back to defaults (which the downstream sanitizers already handle). |
| F2 | `DataStore.save` honors the `Result` contract (disk failures become `err`, surfaced as a Notice instead of an unhandled rejection), and `SettingsService.save()` is serialized through a promise chain so per-field debounced saves can't interleave and lose updates. |
| F3 | `main.ts`: `SettingsService` keeps the single shared logger (previously it held a stale bootstrap logger that never received the redaction secret set or configured level); `ConsoleLogger` gained `setMinLevel`. |
| F4 | `ConsoleLogger` redaction hardened: the message string is scrubbed too, and `redactFields` recurses into nested objects/arrays (secrets inside `Error.message`/`stack`/`AppError.details` no longer pass through). |
| F5 | The repair logs' field named `key` no longer collides with the `SENSITIVE_KEY` regex (the log existed to name the dropped entry but printed `***`). |
| F6 | `ObsidianWorkspaceAdapter` wraps `openFile`/`openView` in try/catch so exceptions can't escape its `Result`-returning API. |
| F7 | Dead code removed: `isOk`/`isErr` (result.ts), `RUN_TIMEOUT`/`SUT_ENV_NOT_FOUND` error codes, the unused `Id` type; `isValidAuthEnvKey`/`isReservedEnvKey` made module-private. |
| F8 | `PathSafetyPolicy.validate` takes a plain `string` (its job is screening unbranded input), removing the brand-inverting `as VaultPath` cast in the smart constructor. |

## 3. Post-implementation review & polishing pass

After the sections above landed, a second multi-angle review (line-by-line diff scan, removed-behavior audit, cross-file trace, reuse/efficiency sweep) was run over the full PR diff. Confirmed findings, fixed in the polishing pass:

| ID | Finding → fix |
| --- | --- |
| R1 | The SIGTERM→SIGKILL escalation gated on the wrapper's `exitCode`, which (a) never reflects signal-terminated children and (b) skips escalation exactly when the wrapper died but a SIGTERM-ignoring grandchild holds the stdio pipes — the very A3 stuck-slot scenario. Fixed: the timer always force-kills the group (ESRCH = already gone) and is cancelled by the `close` event in the normal case. |
| R2 | `execute()`'s new catch could fabricate a terminal `testrun.failed` for a setup throw before `testrun.started` (console flips to "Run failed" for a run it never displayed) and could relabel an already-terminated run's state. Fixed: the terminal route is taken only when `started && !terminated`. |
| R3 | The new cancel race-guard's benign "finished while cancelling" error reached the user as a red "Could not cancel run" Notice. Fixed: `RunLauncher.cancel` reports it as "The Test Run already finished". |
| R4 | `updateSettings` assigned `hubSettings` only after the awaited save — so the `settings.updated`-driven render painted stale state, and two debounced field-saves could build from a stale base and silently revert each other (the caller-side half of F2). Fixed: optimistic swap before the save with a superseded-aware rollback. |
| R5 | Prototype-chain traps: `validate()`/`runEnv()`/`switchEnvironment` used truthy indexing or `in` on the environments record, so `sut.active: "toString"` slipped every guard. Fixed with `Object.hasOwn` (matching `repairSutShape`). |
| R6 | `logging.level` was consumed by `setMinLevel` without load-time repair — a tampered value silently disabled the level filter; and a reset never re-applied the level. Both fixed. |
| R7 | `redactValue` skipped `Error` instances (a nested `details.cause` error could carry a credential through the scrub), null-prototype records, and had no cycle guard. Fixed (flatten + scrub errors, `WeakSet` cycle guard). |
| R8 | cmd-shim program token: quote on cmd metacharacters (`& \| < > ^ ( )`) too, not only whitespace/quotes — defense in depth behind CommandSafetyPolicy. |
| R9 | Cleanup: the six copy-pasted error-with-Retry blocks → shared `renderLoadError`; `main.openEvidenceNote` → shared `openOrNotice` (with options); the Test Console tick/meta duplication → one `renderRunningMeta`; tests added for the new `modal-helpers`/`keyboard-activation` modules. |

## 4. Reviewed and deliberately deferred

These were found, judged real, but deferred as too invasive for a polish pass; they are recorded here so they aren't lost:

- **Per-note write serialization** — UC notes have three read-modify-write writers (post-run linking, edit modal, feature linking) that can interleave across awaits; a per-path promise-chain mutex in `DefaultUseCaseService` is the right shape. Same pattern applies to `SettingsService.save()`.
- **Output-event ordering** — `testrun.output.received` publishes are fire-and-forget; chaining them per run and awaiting the tail before the terminal publish would make late-line-after-banner impossible. Low observed impact (subscribers are synchronous today).
- **`changedFields` accuracy in `UseCaseService.update()`** — publishes presence, not change; diff against the pre-write entity.
- **Settings scalar repair** — extend the `repairSutShape` posture to `ci.*`/`logging`/`automation.*` so a tampered `data.json` cannot crash `.trim()` call sites.
- **`LiveRefresh` extraction** — the subscribe/scheduler/teardown boilerplate is byte-identical across five views; extract once the next view lands.
- **Action SHA-pinning** — Dependabot now watches the actions; pinning to SHAs is still the stricter posture for `release.yml` (`contents: write`).
- **Playwright browser caching in `e2e-smoke.yml`** — saves ~150 MB/run; needs per-OS cache paths keyed on the template's Playwright version.
- **`register-commands` smoke test** and a `vault.adapter.exists` → Vault-API migration in `obsidian-vault-adapter.ts` (community-review bots flag adapter usage).
- **Six ribbon icons by default** — heavy default chrome; consider trimming to Dashboard + Console before store submission (product call).
- **Vault-base trailing-separator strip duplicated six times** — normalize once in `NodeAbsoluteFileSystem.getVaultBasePath()`, document the port as "no trailing separator", drop the inline `replace(/[/\\]$/, "")` calls.
- **`joinVaultPath` hardening** — assert no `..` segments / leading `/` inside the helper so an unsanitized future caller cannot mint a vault-escaping `VaultPath`.
- **Settings scalar repair** (also listed above) — `logging.level` is now repaired (R6); extend the posture to `ci.*`/`automation.*`.
- **Shared serial queue** — `SettingsService.serialize()` and `PostRunCoordinator.enqueue()` are near-identical hand-rolled promise chains; extract `src/shared/async/serial-queue.ts` when a third user appears. Note the documented constraint either way: a bus subscriber that AWAITS `save()`/`reset()` from inside a `settings.*` handler would deadlock the chain (none does today).
- **`save()` re-loads to diff** — each serialized save does a full load+sanitize pass just to compute `changedFields`; cache the last-persisted snapshot inside the chain if settings editing ever feels slow.
