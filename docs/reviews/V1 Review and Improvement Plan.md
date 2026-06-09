# V1 Review & Improvement Plan

_Consolidated from a seven-track review of the V1 implementation (architecture & layering, domain model & ADR conformance, application services & event model, presentation & Obsidian integration, security & safety, testing & tooling, and an external best-practice benchmark grounded in web research). Date: 2026-05-31._

---

## 1. Executive summary

V1 is a **healthy, disciplined codebase**, not a prototype. The hard things are done well:

- **Layering is real, not cosmetic.** Domain and Application are clean of `obsidian`, Node `fs`/`child_process`, and Playwright; all five I/O boundaries are behind ports implemented only in `infrastructure/`. No circular dependencies found.
- **Tests are green and substantive.** `npm run test` → **37 files / 333 tests pass**; `typecheck` and `build` exit 0; coverage **94.43% stmt / 84.91% branch / 97.05% func** (above the 93/80/93/93 gates). Services are tested through ports with hand-written fakes; domain policies are tested adversarially.
- **Command-execution security is a genuine strength.** argv-shape allowlist, `shell:false`, Windows `.cmd`/`%`-expansion hardening (CVE-2024-27980 awareness), step-scoped CI secrets. This exceeds typical plugin hygiene.

The work ahead is concentrated in five themes: **(1) one confirmed security hole**, **(2) the documented event-driven architecture is partly fictional**, **(3) credential redaction is wired but inert**, **(4) doc/ADR drift from the implemented design**, and **(5) packaging gaps that block community-store acceptance**.

### Overall scores (reviewer consensus)

| Area | Health | Headline issue |
|---|---|---|
| Architecture & layering | 🟢 Strong | Event-driven flow documented but orchestrated imperatively in `main.ts` |
| Domain & ADR conformance | 🟡 Good w/ drift | ADR-0019 redaction inert; ADR-0017 policy diverges from ADR; 0015 partial |
| Services & event model | 🟡 Mixed | correlationId not propagated; payload drift from catalog; UC-010 missing |
| Presentation & Obsidian | 🟢 Strong | `onunload` race + `detachLeavesOfType`; empty `styles.css` |
| Security & safety | 🟢 Strong, 1 hole | **Template injection → RCE** via generated `cucumber.mjs` |
| Testing & tooling | 🟢 Strong | Process-boundary adapter untested; no lint step |
| External best-practice | 🟡 | Missing `LICENSE` + `versions.json` block store submission |

---

## 2. Cross-cutting themes (where multiple reviewers converged)

These were independently flagged by 2+ tracks and should be treated as the spine of the plan:

- **T1 — The event-driven model is partly fictional.** Architecture (H1) and Services (H4) both found that the documented run→`report.detected`→import→evidence watcher chain is actually an imperative `await` chain in `main.ts`; no `ReportFileWatcher` exists, nothing subscribes to `report.detected`, and `dashboard.*` events fire only as a view-render side-effect. _Decision required: build it, or amend the docs (the snapshot mechanism already removes the race the watcher was meant to handle, so imperative is defensible)._
- **T2 — `main.ts` is doing more than a composition root.** Architecture (H2, M1) and Services (M4) found `lastRun` state, the `evidenceChain` concurrency guard, run-status eligibility rules, and picker-modal workflows living in the 857-line plugin class.
- **T3 — Credential redaction is inert.** Domain (C1) and Security (Medium) independently found `ConsoleLogger` is constructed with an empty `secrets` set (`main.ts:134`), never populated from the active environment's `auth.env`, never rebuilt on settings change — so ADR-0019's value-based redaction never runs, and streamed child `stderr` is logged unscrubbed.
- **T4 — `onunload` lifecycle + `detachLeavesOfType`.** Presentation (H1, H2) and Web-research (1.4) agree: `onunload` is `async` but Obsidian discards its promise (cancel/wait race), and `detachLeavesOfType` destroys the user's layout across updates and is explicitly discouraged.
- **T5 — Unbranded value objects.** Architecture (L2) and Domain (L1) both note `VaultPath`/`UseCaseId`/etc. are comment-branded `string`s, so ADR-0008's "single chokepoint" is convention, not type-enforced — and (see SEC-1) this is what lets a malicious path reach a code-gen sink.
- **T6 — Doc/ADR drift from code.** Architecture (M2), Domain (M3), and Services (H1–H3) all found the Building Block View, Event Catalog, and several ADRs describe components/payloads/events that don't match the code.

---

## 3. Prioritized roadmap

### Phase 0 — Security & correctness (do first)

| ID | Item | Severity | Refs |
|---|---|---|---|
| **P0-1** | ✅ **Done** _(verified in code 2026-06-09)_. The features glob is emitted via `JSON.stringify` in `runner-templates.ts` (always a fully-escaped string literal), `PathSafetyPolicy` enforcement is type-carried by the branded `VaultPath` (P3-4), and `SettingsService.load()` sanitizes/validates paths. | 🔴 Critical (confirmed) | SEC-1 |
| **P0-2** | ✅ **Done.** `ConsoleLogger`'s `secrets` are populated from `settings.sut.environments[*].auth.env` and rebuilt on settings change; positionally-logged credentials are scrubbed (whole-value at any length, substring-scrubbed when ≥8 chars). **Live-console redaction follow-up (security M1) — DONE:** the value-scrubbing logic now lives in a shared pure helper `src/shared/logging/redact.ts` (`redactSecrets`), used by BOTH the `ConsoleLogger` and `DefaultTestExecutionService.runStreaming`. The run path builds the secret set ONCE per run via `collectCredentialValues(settings)` and redacts each `output.line` BEFORE publishing `testrun.output.received` (empty set short-circuits, keeping the hot path cheap), so a configured `auth.env` credential the runner echoes to stdout/stderr is scrubbed to `***` in the live Test Console — the earlier "not redacted in V1" gap is closed. Tests: `tests/redact.test.ts`, plus streamed-redaction and no-credential-passthrough cases in `tests/test-execution-service.test.ts`. | 🔴 Critical (inert safety net) | DOM-C1, SEC-Med |
| **P0-3** | ✅ **Done** _(verified in code 2026-06-09)_. The synchronous maintenance lock on `DefaultTestExecutionService` makes `reset()`/`repair()` and `execute()` mutually exclusive (see P2-4), and the reset path awaits settle (incl. the evidence chain — see §7) inside the lock. | 🟠 High | SVC-M4 |
| **P0-4** | ✅ **Done** _(verified in code 2026-06-09)_. `NodeChildProcessRunner.cancel` honors its `processId` (id-keyed cancel-kills-tree), covered by the real-spawn adapter tests under P4-1. | 🟠 High (latent) | TEST-H2 |

### Phase 1 — Store-readiness & lifecycle (unblocks shipping)

| ID | Item | Severity | Refs |
|---|---|---|---|
| **P1-1** | ✅ **Done** _(verified 2026-06-09)_. `LICENSE` (MIT) exists at the repo root. | 🟠 High (blocks) | WEB-1.1 |
| **P1-2** | ✅ **Done** _(verified 2026-06-09)_. `versions.json` exists and `release.yml` attaches the release assets. | 🟠 High (blocks) | WEB-1.2 |
| **P1-3** | ✅ **Done** _(verified 2026-06-09)_. `detachLeavesOfType` is intentionally NOT called in `onunload` (documented in `main.ts` with a P1-3/PRES-H2 comment); `registerView` + per-view `onClose` clean up. | 🟠 High | PRES-H2, WEB-1.4 |
| **P1-4** | ✅ **Done** _(verified 2026-06-09)_. `onunload` does synchronous teardown (`postRunCoordinator.stop()` etc., no awaited promise Obsidian would discard); the wait-for-settle guarantee lives in the service layer. | 🟠 High | PRES-H1 |
| **P1-5** | ✅ **Done** _(verified 2026-06-09)_. README has a Developer-Policy disclosure section: spawns `npm`/`npx`/`node`, downloads npm packages + Chromium over the network, writes `.testrunner` + workflow files. | 🟡 Medium (policy) | WEB-4.1 |
| **P1-6** | ✅ **Done** _(verified 2026-06-09)_. `esbuild.config.mjs` carries the full `@codemirror/*`/`@lezer/*` externals, production minify, generated-file banner, and aligned target. | 🟡 Medium | WEB-3.1–3.4 |

### Phase 2 — Event model & service correctness

| ID | Item | Severity | Refs |
|---|---|---|---|
| **P2-1** | ✅ **Done.** Built an in-process `PostRunCoordinator` (application layer) that subscribes to the EN-2 terminal run events (`testrun.completed`/`failed`/`cancelled`) and runs import → evidence → dashboard refresh — **no** `ReportFileWatcher`. The misplaced `report.detected` event was removed (union + payload map + emission). BBV §5.11a/§7/§14, RV-5/6, and Event Catalog §8/§10/§20 updated. | 🟠 High (architecture decision) | ARCH-H1, SVC-H4 |
| **P2-2** | ✅ **Done** _(verified in code 2026-06-09)_. `correlationId` is threaded through the init & reset flows: `documentation-generation-service.ts:57`, `suite-service.ts:276`, `runner-installation-service.ts:61`, `environment-validation-service.ts:381`, and the `maintenance-service.ts` reset chain (one id across the whole re-init, per P2-4). | 🔴 Critical (per catalog §19) | SVC-C1 |
| **P2-3** | ✅ **Done** _(verified in code 2026-06-09)_. Compiler-enforced `EventPayloads` map at `src/domain/events/domain-event.ts:81-180`; `createEvent` is generic over it, so payload drift is a type error, not prose. | 🟠 High | SVC-H1, H2 |
| **P2-4** | ✅ **Done.** `MaintenanceService.reset()` (UC-024) mints ONE reset-invocation `correlationId`, emits `settings.reset` (with it), deletes ONLY the regenerable `.testrunner` runtime (`VaultFileSystem.deleteFolder`, idempotent), then re-runs `InitializationService.initialize(…, correlationId)` so the whole `testhub.initialization.started → … → completed` chain shares the one id (Catalog §14/§19). **Conservative deletion:** user-authored Use Cases, Specifications, Features, Suites and Evidence are NOT deleted (only the dot-folder runtime); documentation/default suites are re-created idempotently by re-init. `settings.reset` already carried `{ profile: "default" }`. `main.ts` `resetSettings` + the settings-tab "Reset Test Hub" button delegate to it. **Security L1 (TOCTOU close):** `reset()`/`repair()` and `execute()` are now mutually exclusive via a SYNCHRONOUS maintenance lock on `DefaultTestExecutionService` — `execute()` reads it before reserving its single-run slot (returns `MAINTENANCE_IN_PROGRESS`), and the lock's `begin()` refuses (`RUN_IN_PROGRESS`) while a run is active, both check-then-act-free. _(AD-11 `sweepEvidence()` remains out of scope for V1.)_ | 🟠 High | SVC-C2 |
| **P2-5** | ✅ **Done.** Built `StepDefinitionService` (`step-definition-service.ts`) — given a feature's missing steps it generates non-destructive `Given(...)` stubs into `.testrunner/src/steps/<feature>.steps.ts` (same `VaultFileSystem` port + path `detectMissingSteps` reads), skipping already-defined steps and appending to hand-edited files. Publishes `stepdefinition.generated` with `causationId` = the originating `specification.missingSteps.detected` id (Catalog §5/§19; `MissingStepResult.detectionEventId` threads it). Trigger is an explicit **Generate Step Definitions** command in `main.ts` (detect → generate → Notice), not auto-on-edit. RV-4 marked implemented; BBV §5.10 fleshed out. | 🟠 High | SVC-H3 |
| **P2-6** | ✅ **Done.** The `PostRunCoordinator` PUSHES `TraceabilityService.refreshDashboard()` after evidence is generated, so `dashboard.refreshed`/`kpi.updated` fire from the run flow even when no view is open. To avoid a refresh loop, `TraceabilityService` now splits into an emitting `refreshDashboard()` (the push) and a non-emitting `snapshot()` (read by the views on re-render); `DashboardView` reacts to `dashboard.*` and renders from `snapshot()`. | 🟡 Medium | SVC-H3 |
| **P2-7** | ✅ **Done (post-run part).** `lastRun`, the `evidenceChain` concurrency guard, and the run-status eligibility rule moved out of `main.ts` into the `PostRunCoordinator`; `main.ts` now constructs it, `start()`s/`stop()`s it, awaits `whenSettled()` on reset, and delegates the "Import Report for Last Run" command to `importLastRun()`. _(Still open: move `.feature` discovery into `SpecificationService.listFeatures()` and extract command handlers to `presentation/commands/`.)_ | 🟡 Medium | ARCH-H2, M1 |

### Phase 3 — Domain hardening & ADR reconciliation

| ID | Item | Severity | Refs |
|---|---|---|---|
| **P3-1** | ✅ **Done (documented; behaviour unchanged).** Decision: document, do not change the policy. ADR-0017 now records the scope-aware pass roll-up and the prior-status "floor" (`use-case-automation-policy.ts:74-87`) as accepted V1 behaviour — including *why* the policy reads its own `automationStatus` as input (the floor prevents a targeted single-Feature rerun from regressing an already-`passing` multi-Feature UC, absent per-Feature history, which is a V2 item). Also fixed the ADR's opening sentence: `@wip` granularity is Feature-level, not scenario-level (scenario parenthetical removed). | 🟠 High | DOM-H1 |
| **P3-2** | ✅ **Done** _(verified in code 2026-06-09)_. Invariant-enforcing `Result` factories shipped for `FeatureSpecification`/`TestSuite`; the `TestRunAggregate` idea is explicitly deferred (see §7) — the EN-2 state machine in `TestExecutionService` already carries those invariants. | 🟡 Medium | DOM-M1 |
| **P3-3** | ✅ **Done** _(2026-06-09)_. Warning-level enforcement implemented (`SettingsService.detectSiblingTestHub`: advisory `settings.validated` WARNING, conservative sibling + sync/copy-suffix matching) + ADR-0015 amended to record it; hard rejection deferred beyond V1. | 🟡 Medium | DOM-M2 |
| **P3-4** | ✅ **Done.** `VaultPath` is now a branded type — `string & { readonly __brand: "VaultPath" }` (`domain/value-objects/identifiers.ts`) — with two constructors in `domain/value-objects/vault-path.ts`: the SMART `vaultPath(raw): Result<VaultPath>` runs `DefaultPathSafetyPolicy` (the type-enforced ADR-0008 chokepoint for untrusted input — settings load, frontmatter, user input), and the documented NO-OP `unsafeVaultPath(raw)` brands already-trusted values (DEFAULT_SETTINGS constants, `joinVaultPath` recombinations, Obsidian-managed paths, test fixtures) so `Result` need not be threaded everywhere. `grep -rn unsafeVaultPath src tests` enumerates the auditable trusted surface. `joinVaultPath` returns a branded `VaultPath`; `SettingsService.load()` brands sanitized paths at its existing validation boundary. Behaviour is identical (PathSafetyPolicy runs where it ran before); the brand only makes the type reflect the chokepoint. Only `VaultPath` is branded — `UseCaseId`/`SuiteId`/`RunId`/`EvidenceId` stay plain string aliases (smallest blast radius that captures the security value). ADR-0008 updated. (Also closes part of P0-1's root cause.) | 🟡 Medium | DOM-L1, ARCH-L2 |
| **P3-5** | ✅ **Done** _(verified 2026-06-09)_. Resolved by removal/deferral: the dead alias never shipped in code and the CONTEXT.md glossary term is marked deferred (under P3-6) — nothing left to decide for V1. | 🟡 Medium | DOM-M4 |
| **P3-6** | ✅ **Done (docs portions).** ADR-0019: added `VALIDATION_FAILED` to the documented `ErrorCode` union and rationalized it vs `SETTINGS_INVALID` (settings-document vs general per-input validation); renamed `RunnerExecutionPolicy` → the implemented `CommandSafetyPolicy`; noted `MAINTENANCE_IN_PROGRESS` exists in the real union. ADR-0017 `@wip`-granularity opening sentence fixed (under P3-1). ADR-0008: added "configured Node executable" + "runtime-derived paths (`getVaultBasePath()`)" to the sanctioned-absolute-path enumeration, verified against `command-safety-policy.ts` / `runner-paths.ts`. CONTEXT.md `Scenario Reference` marked deferred (no code representation). _(The code-side item — modelling `TestRunSummary.status` "skipped" as a named `UseCaseRunOutcome` type — shipped on this branch, commit `d43e8af`.)_ | 🟢 Low | DOM-M3, H2, L2, L3 |
| **P3-7** | ✅ **Done (docs portions).** Reconciled BBV/SDD with code (T6): repository ports marked **not built** (persistence is the `VaultFileSystem`/`AbsoluteFileSystem` ports; no `src/domain/repositories/`); renamed views/policies fixed (`TestRunPanel` → `TestConsoleView`, `TestHubView` → `DashboardView`, `RunnerExecutionPolicy` → `CommandSafetyPolicy`; fictional explorer/doc leaves and drafted-only policies flagged); fictional infra adapters replaced with the real classes; `ReportFileWatcher`/`report.detected` marked removed and `FeatureFileWatcher` deferred. The §10 layering claim was corrected to match reality: an ESLint setup **does** exist and runs in CI (`no-floating-promises`), but there is **no** `no-restricted-imports` layer rule or layer-import fixture — described accurately and marked TODO (P4-2). ✅ **Relocation now DONE:** the runner-template *source* moved from `src/application/content/runner-templates.ts` to `src/infrastructure/runner/templates/runner-templates.ts`. Generation is pushed behind the `TemplateWriter` port (`buildRunnerTemplates(settings)` on the port, implemented by `RunnerTemplateWriter`), so the application services call the port instead of importing infra content — the layer dependency rule holds (no `application/**` → `infrastructure/**` imports). The file/dep **manifest** the validators assert against stays as contract data at `src/application/content/runner-manifest.ts`. Docs updated (BBV §7.1, SDD §7). | 🟢 Low | ARCH-M2, M3 |

### Phase 4 — Tooling, tests & UX polish

| ID | Item | Severity | Refs |
|---|---|---|---|
| **P4-1** | ✅ **Done.** `NodeChildProcessRunner` is in the coverage set (no longer excluded) with real-spawn POSIX adapter tests (`shell:false` argv pass-through, output streaming, exit mapping, id-keyed cancel-kills-tree). **Windows cmd-branch coverage follow-up — DONE:** the previously win32-only branch (the `%`→`COMMAND_DISALLOWED` rejection and the `quoteForCmd` + outer-quote `cmd /d /s /c` composition) had ZERO automated coverage on ubuntu CI. The adapter now takes an **injectable platform** (default `process.platform`) and a `spawn` seam, and the cmd composition is a pure `buildCmdShimCommandLine` helper. Deterministic Linux unit tests (`tests/node-child-process-runner.test.ts`) exercise the win32 path: `%`-arg rejected without spawning, the composed `cmd.exe /d /s /c ""npm" "run" …""` line via a fake spawn, and non-shim programs spawned directly. A `windows-latest` leg was added to `.github/workflows/ci.yml` so the suite (and the real cmd path) also run on Windows; `.gitattributes` (`* text=auto eol=lf`) keeps a Windows checkout on LF so `prettier --check` / line-ending tests stay green. | 🟠 High | TEST-H1 |
| **P4-2** | ✅ **Done** _(2026-06-09)_. ESLint (`typescript-eslint`, `no-floating-promises`) + Prettier + the CI `lint` step landed earlier; the P3-7/P4-2 leftover — `no-restricted-imports` **layer-boundary rules** per source layer — added to `eslint.config.mjs` on 2026-06-09 (see §7). | 🟡 Medium | TEST-M1, WEB |
| **P4-3** | ✅ **Done** _(verified 2026-06-09)_. CI builds before testing (plus the `test-build` script), so the `release-validation` bundle check actually runs instead of being skipped. | 🟡 Medium | TEST-M3 |
| **P4-4** | ✅ **Done** _(verified 2026-06-09)_. `ci.yml` and `release.yml` use `npm ci` with a committed lockfile and carry least-privilege `permissions` blocks. | 🟡 Medium | SEC-Low |
| **P4-5** | ✅ **Done** _(verified 2026-06-09)_. Generated runner templates pin `@cucumber/cucumber ^12.0.0` and `playwright ^1.60.0`. | 🟡 Medium | WEB-2.1 |
| **P4-6** | ✅ **Done** _(verified in code 2026-06-09)_. `SuiteDashboardView`/`UseCaseDashboardView` coalesce concurrent event-driven renders (same render-chain guard as `DashboardView`). | 🟡 Medium | PRES-M2 |
| **P4-7** | **Ship `styles.css`.** It's empty, so every referenced class and the `[data-status]` banner styling are dead (KPI grid, banner colors, stderr emphasis). | 🟡 Medium | PRES-M3 |
| **P4-8** | ✅ **Done** _(verified in code 2026-06-09)_. `TestConsoleView` caps output at `MAX_OUTPUT_LINES` (oldest lines dropped). | 🟡 Medium | PRES-M4 |
| **P4-9** | ✅ **Done** _(verified in code 2026-06-09)_. Settings tab debounces per-field persistence with flush-on-blur and cancels pending debouncers on re-render/close; fields re-sync on failed save. | 🟡 Medium | PRES-M1 |
| **P4-10** | ✅ **Done (all but the E2E smoke test)** _(verified 2026-06-09)_. Modal client-side validation, real buttons instead of `<a href="#">`, and post-picker progress feedback shipped; the **opt-in E2E CI smoke test remains deferred** (needs a browser download in CI — see §7). | 🟢 Low | PRES-M5, L2, L3; TEST-M2 |

---

## 4. Quick wins (high value, low effort — batch into one PR)

- `LICENSE` file (P1-1) and `versions.json` (P1-2) — unblocks store submission.
- Remove `detachLeavesOfType` from `onunload` (P1-3).
- Ship `styles.css` (P4-7).
- esbuild `minify`/externals/target alignment (P1-6).
- README disclosure section (P1-5).
- ADR/glossary text fixes (P3-6).

## 5. What is explicitly good (preserve these)

- Hexagonal layering with real dependency inversion; no cycles; small single-purpose services.
- The EN-2 single-terminal-event state machine and ADR-0018 single-active-run guard (synchronous slot reservation) in `TestExecutionService` — rigorous and well-tested.
- `DefaultCommandSafetyPolicy` argv-shape allowlist + `shell:false` + Windows `.cmd`/`%` hardening; `PipelineGenerationService`'s exemplary multi-layer CI screening.
- Zero `innerHTML`/raw-HTML anywhere; all DOM via `createEl` with auto-escaped text; consistent event-bus unsubscribe in `onClose`.
- ADR-0012 (1:N), ADR-0016 (evidence partitioning), ADR-0010 are fully and correctly honored.
- Result/error model used consistently across all application services.

---

## 6. Suggested sequencing

1. **PR A (security):** P0-1, P0-2, P0-3, P0-4 — ship before anything else.
2. **PR B (store-readiness quick wins):** P1-1…P1-6, plus §4 quick wins.
3. **PR C (event-model decision):** P2-1 first (it's an architecture decision that shapes P2-2…P2-7), then the rest.
4. **PR D (domain + ADR reconciliation):** Phase 3.
5. **PR E (tooling/tests/UX):** Phase 4, with P4-1 (process-boundary tests) prioritized.

> Note: P2-1 (build the watcher vs. an in-process orchestrator) is **resolved** — an in-process `PostRunCoordinator` subscribes to the terminal run events; no `ReportFileWatcher` was built and `report.detected` was removed. P2-6 and the post-run part of P2-7 landed on top of it.

---

## 7. Follow-up review (2026-06-09)

_A second review round after the Phase 0–4 work above landed. The original plan is essentially executed: every Phase 0/1 item and all but one sub-item of Phases 2–4 are ✅ Done (the table notes above record the per-item verification). The findings below are what the second pass surfaced, with their disposition._

### 7.1 Findings being fixed

| Theme | Finding | Severity | Disposition |
|---|---|---|---|
| Settings ingestion | `auth.env` key **names** are not validated (only values are treated as secrets), `baseUrl` accepts non-URL strings, and `nodeExecutable` lacks a traversal check. | 🟡 Medium | **Being fixed:** `SettingsService.validate()` gains key-name/`baseUrl`/`nodeExecutable` checks and `load()` sanitizes on ingest (`settings-service.ts`) — load-time sanitization mirrors the save-time path, closing the tampered-`data.json` ingestion gap left after P0-1. |
| Presentation lifecycle | View `onClose` teardown ordering: the render scheduler must be disposed **before** event-bus unsubscribe, or a late event can schedule a render into a torn-down view. | 🟡 Medium | **Being fixed** across the dashboard views. |
| Presentation polish | Recent-Runs/KPI rows lack status affordances beyond color; missing `:focus-visible` styles and `aria-label`s; heading hierarchy skips levels; modals don't autofocus their first input; empty-state/wizard/settings copy is terse. | 🟢 Low | **Being fixed** as a UX/a11y batch. |
| Architecture (T2 leftovers) | The two P2-7 leftovers: `main.ts` command handlers belong in `presentation/commands/`, and `.feature` discovery belongs in `SpecificationService.listFeatures()`. | 🟡 Medium | **Being fixed** — completes the "composition root only" goal for `main.ts`. |
| Post-run robustness | `PostRunCoordinator` could silently swallow rejected post-run tasks; the maintenance path must await the **evidence chain's** settle inside the maintenance lock (not just the run slot). | 🟡 Medium | **Being fixed:** rejections are logged; evidence-chain settle awaited under the lock (hardens P0-3/P2-4). |

### 7.2 Findings fixed in this change

| Theme | Finding | Severity | Disposition |
|---|---|---|---|
| Store readiness | `manifest.json` description contained "Obsidian", which the plugin guidelines prohibit — a store-submission blocker. | 🟠 High (blocks) | **Fixed:** description now ends "…directly inside your vault." (`package.json`'s npm-only description already matched.) |
| Tooling | The documented layer boundaries (BBV §10) were convention only — no lint enforcement (the P3-7/P4-2 leftover). | 🟡 Medium | **Fixed:** per-layer `no-restricted-imports` flat-config blocks in `eslint.config.mjs` (domain → domain+shared; application additionally not `obsidian`/Node builtins; presentation not infrastructure; infrastructure not presentation; shared standalone, with the pre-existing **type-only** domain imports in `shared/event-bus` + `shared/utils/vault-path` carved out via `allowTypeImports`). `npx eslint src` is clean. |

### 7.3 Explicitly deferred (with rationale)

| Item | Rationale |
|---|---|
| Opt-in E2E CI smoke test (the P4-10 remainder) | Needs a Chromium download in CI on every run; kept as a tracked opt-in job rather than a default gate. |
| `TestRunAggregate` (P3-2 note) | ADR-0018's invariants are already enforced by the EN-2 single-terminal-event state machine in `TestExecutionService`; introducing an aggregate now would be vocabulary-driven churn. |
| Child-process env allowlist | Environment inheritance by the spawned runner is **intentional** (the runner needs the user's toolchain: PATH, npm config, proxies); secrets are step-scoped in CI and redacted in logs. |
| Spawn-boundary re-validation | Re-validating argv at the adapter would duplicate `CommandSafetyPolicy`, which already runs at every call site — and the new ESLint layer rules prevent unvetted call paths from reaching the adapter. |
