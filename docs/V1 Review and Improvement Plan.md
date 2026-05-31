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
| **P0-1** | **Fix template injection → RCE.** `featureFilesPath` is interpolated raw into the generated `cucumber.mjs` (`runner-templates.ts:56-68`, value at `:233-236`). `PathSafetyPolicy` permits `"` `` ` `` `$` `{`. A tampered/synced `data.json` yields a `cucumber.mjs` that executes attacker code on the next `npm run test`. **Fix:** `JSON.stringify` the glob (don't hand-quote), add a strict relative-path charset to `PathSafetyPolicy` (mirror `pipeline-generation-service.ts:135-147`), and validate in `SettingsService.load()` (today only `save()` validates). | 🔴 Critical (confirmed) | SEC-1 |
| **P0-2** | **Wire credential redaction (T3).** Populate `ConsoleLogger`'s `secrets` from `settings.sut.environments[*].auth.env` values at construction; rebuild on `settings.updated`. Scrub/truncate raw child `stderr` before logging (`runner-installation-service.ts:108-111`). Add a test asserting a positionally-logged `auth.env` value is `***`. | 🔴 Critical (inert safety net) | DOM-C1, SEC-Med |
| **P0-3** | **Guard maintenance/reset against active runs (T2).** `repair()`/`reset()` rewrite `.testrunner`/settings with no check on `activeRunId()` or the in-flight `evidenceChain`; a concurrent reset can redirect evidence writes and corrupt runner state. Reject when a run is active; await `whenActiveSettles()` + `evidenceChain`. | 🟠 High | SVC-M4 |
| **P0-4** | **Fix `cancel(processId)` (T—).** `NodeChildProcessRunner.cancel` ignores its argument and kills **all** active children (`node-child-process-runner.ts:44-49`); the fake records `processId`, so the real adapter is laxer than tests assume. Honor the id, or encode the "kill-all under single-run" decision in an adapter test. | 🟠 High (latent) | TEST-H2 |

### Phase 1 — Store-readiness & lifecycle (unblocks shipping)

| ID | Item | Severity | Refs |
|---|---|---|---|
| **P1-1** | **Add `LICENSE` file** (MIT, matching `package.json`). Submission **blocker**. | 🟠 High (blocks) | WEB-1.1 |
| **P1-2** | **Add `versions.json`** and verify the release workflow attaches `manifest.json`/`main.js`/`styles.css` as release assets. Submission **blocker**. | 🟠 High (blocks) | WEB-1.2 |
| **P1-3** | **Remove `detachLeavesOfType` from `onunload`** (`main.ts:487-490`) — destroys user layout, discouraged by guidelines; `registerView` + per-view `onClose` already clean up (T4). | 🟠 High | PRES-H2, WEB-1.4 |
| **P1-4** | **Make `onunload` teardown synchronous & race-free** (T4). Do the sync teardown in `onunload`; move the "wait for child to exit" guarantee into the service layer (Obsidian discards the returned promise). | 🟠 High | PRES-H1 |
| **P1-5** | **README disclosure** (Developer Policy): plugin spawns `npm`/`npx`/`node`, downloads Chromium + npm packages over the network, and writes `.testrunner` + `.github/workflows` outside the vault. | 🟡 Medium (policy) | WEB-4.1 |
| **P1-6** | **Build config → match sample plugin:** complete `@codemirror/*` + `@lezer/*` externals; `minify: production`; add generated-file banner; align esbuild `target` (es2018) with tsconfig (ES2022). | 🟡 Medium | WEB-3.1–3.4 |

### Phase 2 — Event model & service correctness

| ID | Item | Severity | Refs |
|---|---|---|---|
| **P2-1** | ✅ **Done.** Built an in-process `PostRunCoordinator` (application layer) that subscribes to the EN-2 terminal run events (`testrun.completed`/`failed`/`cancelled`) and runs import → evidence → dashboard refresh — **no** `ReportFileWatcher`. The misplaced `report.detected` event was removed (union + payload map + emission). BBV §5.11a/§7/§14, RV-5/6, and Event Catalog §8/§10/§20 updated. | 🟠 High (architecture decision) | ARCH-H1, SVC-H4 |
| **P2-2** | **Propagate `correlationId` through init & reset flows** (`documentation.generated`, `suite.created`, `testrunner.installed/validated` all drop it). The run path already honors `correlationId = runId` correctly. | 🔴 Critical (per catalog §19) | SVC-C1 |
| **P2-3** | **Fix event payload drift.** Align `initialization.completed/failed`, `settings.updated/validated/reset`, `usecase.created`, and demo `specification.created` with the catalog. Add a compiler-enforced `DomainEventType → payload` map so the catalog is type-checked, not prose. | 🟠 High | SVC-H1, H2 |
| **P2-4** | **Implement `MaintenanceService.reset()` + UC-024 chain** (and `sweepEvidence()` if AD-11 is in scope). Reset must delete managed folders, re-init (RV-1), and emit `testhub.initialization.started/completed`; fix `settings.reset` payload to `{ profile: "default" }`. | 🟠 High | SVC-C2 |
| **P2-5** | ✅ **Done.** Built `StepDefinitionService` (`step-definition-service.ts`) — given a feature's missing steps it generates non-destructive `Given(...)` stubs into `.testrunner/src/steps/<feature>.steps.ts` (same `VaultFileSystem` port + path `detectMissingSteps` reads), skipping already-defined steps and appending to hand-edited files. Publishes `stepdefinition.generated` with `causationId` = the originating `specification.missingSteps.detected` id (Catalog §5/§19; `MissingStepResult.detectionEventId` threads it). Trigger is an explicit **Generate Step Definitions** command in `main.ts` (detect → generate → Notice), not auto-on-edit. RV-4 marked implemented; BBV §5.10 fleshed out. | 🟠 High | SVC-H3 |
| **P2-6** | ✅ **Done.** The `PostRunCoordinator` PUSHES `TraceabilityService.refreshDashboard()` after evidence is generated, so `dashboard.refreshed`/`kpi.updated` fire from the run flow even when no view is open. To avoid a refresh loop, `TraceabilityService` now splits into an emitting `refreshDashboard()` (the push) and a non-emitting `snapshot()` (read by the views on re-render); `DashboardView` reacts to `dashboard.*` and renders from `snapshot()`. | 🟡 Medium | SVC-H3 |
| **P2-7** | ✅ **Done (post-run part).** `lastRun`, the `evidenceChain` concurrency guard, and the run-status eligibility rule moved out of `main.ts` into the `PostRunCoordinator`; `main.ts` now constructs it, `start()`s/`stop()`s it, awaits `whenSettled()` on reset, and delegates the "Import Report for Last Run" command to `importLastRun()`. _(Still open: move `.feature` discovery into `SpecificationService.listFeatures()` and extract command handlers to `presentation/commands/`.)_ | 🟡 Medium | ARCH-H2, M1 |

### Phase 3 — Domain hardening & ADR reconciliation

| ID | Item | Severity | Refs |
|---|---|---|---|
| **P3-1** | **Reconcile ADR-0017 with its policy** (`use-case-automation-policy.ts:74-87`): the code adds scope-awareness + a prior-status "floor" and feeds its own `automationStatus` output back as input — none of which is in the ADR. Either document the refinement in the ADR or simplify the policy; stop the self-referential input. | 🟠 High | DOM-H1 |
| **P3-2** | **Add invariant-enforcing factories** returning `Result` for `FeatureSpecification`/`TestSuite` (today `useCaseId: ""` and `tagExpression: ""` are constructible despite non-optional types). Consider a real `TestRunAggregate` to match ADR-0018's vocabulary. | 🟡 Medium | DOM-M1 |
| **P3-3** | **Implement ADR-0015 sibling-`Test Hub/` rejection** (currently absent) or mark the ADR consequence deferred with a backlog link. | 🟡 Medium | DOM-M2 |
| **P3-4** | **Branded value objects (T5):** `type VaultPath = string & { readonly __brand }` with a `vaultPath()` smart constructor running `PathSafetyPolicy`, making construction the chokepoint ADR-0008 claims. (Also closes part of P0-1's root cause.) | 🟡 Medium | DOM-L1, ARCH-L2 |
| **P3-5** | **Decide `ScenarioReference`'s fate:** implement it as a value object (with `::row-<index>` semantics) where scenarios are identified, or remove the dead type alias + defer the glossary term. | 🟡 Medium | DOM-M4 |
| **P3-6** | **ADR/glossary text fixes:** add `VALIDATION_FAILED` to ADR-0019's `ErrorCode` union (and rationalize vs `SETTINGS_INVALID`); unify `RunnerExecutionPolicy` vs `CommandSafetyPolicy` naming; fix ADR-0017's `@wip`-granularity opening sentence; add "node executable" + "runtime-derived paths" to ADR-0008's sanctioned-absolute-path list; model `TestRunSummary.status` "skipped" as a named `UseCaseRunOutcome` type. | 🟢 Low | DOM-M3, H2, L2, L3 |
| **P3-7** | **Reconcile BBV/SDD with code (T6):** ~~missing `StepDefinitionService`~~ (now implemented, P2-5), repository ports, watchers, CI writer; renamed views/policies; the §10 "enforced via ESLint + CI fixture" claim is currently false. Mark deferred blocks as such. Relocate runtime-code templates (`content/runner-templates.ts`) under `infrastructure/`. | 🟢 Low | ARCH-M2, M3 |

### Phase 4 — Tooling, tests & UX polish

| ID | Item | Severity | Refs |
|---|---|---|---|
| **P4-1** | **Test the process boundary.** `NodeChildProcessRunner` (190 lines: `spawn`, kill-tree, `.cmd` shim) is excluded from coverage and only its 1-line `quoteForCmd` is tested. Add adapter tests (inject a fake `spawn` or run `node --version`) asserting `shell:false`, argv pass-through, output streaming, exit mapping, cancel-kills-tree; then remove it from the coverage `exclude` list. | 🟠 High | TEST-H1 |
| **P4-2** | **Add ESLint + Prettier + a CI `lint` step** (`typescript-eslint` with `no-floating-promises` — the many `void this.publish(...)` calls are currently unchecked). | 🟡 Medium | TEST-M1, WEB |
| **P4-3** | **Fix CI ordering so the bundle check runs.** `release-validation.test.ts:56` is `skipIf(!existsSync(main.js))` and tests run before build, so it's skipped in CI every time — build before test, or add a post-build assertion. | 🟡 Medium | TEST-M3 |
| **P4-4** | **Harden the plugin's own `ci.yml`:** `npm ci` + committed lockfile instead of `npm install`; add a least-privilege `permissions: { contents: read }` block. | 🟡 Medium | SEC-Low |
| **P4-5** | **Bump generated runner deps:** `@cucumber/cucumber ^11 → ^12`, `playwright ^1.49 → ^1.60`; validate `cucumber.mjs` loads under 12. | 🟡 Medium | WEB-2.1 |
| **P4-6** | **Add render coalescing to `SuiteDashboardView`/`UseCaseDashboardView`** (they lack the `renderChain` guard `DashboardView` deliberately has → stale-render clobber on event bursts). Extract a shared base. | 🟡 Medium | PRES-M2 |
| **P4-7** | **Ship `styles.css`.** It's empty, so every referenced class and the `[data-status]` banner styling are dead (KPI grid, banner colors, stderr emphasis). | 🟡 Medium | PRES-M3 |
| **P4-8** | **Cap console output** — `onOutputReceived` appends an unbounded `<div>` per line; keep last N / batch via `DocumentFragment`. | 🟡 Medium | PRES-M4 |
| **P4-9** | **Debounce settings persistence** (per-keystroke `saveData` + mid-typing "Invalid setting" Notices + divergent state on failed save). Validate/save on blur; re-sync field on failure. | 🟡 Medium | PRES-M1 |
| **P4-10** | **Minor UX/a11y:** client-side validation in create-suite/create-use-case modals (match `SlugPromptModal`); replace `<a href="#">`-as-button with real buttons; progress feedback on post-picker async work; integration-test E2E gap (one opt-in CI smoke test that actually installs + runs a generated `.testrunner`). | 🟢 Low | PRES-M5, L2, L3; TEST-M2 |

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
