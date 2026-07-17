# Authoring Loop Completion (C2/C4/C5 + #77) — Design

**Date:** 2026-07-17
**Status:** Approved (brainstorming) — pending implementation plan
**Branch:** `claude/plugin-ux-usability-9kaf4a`
**Sources:** `docs/ux-review/00-redesign-plan.md` (WS-C2/C4/C5), `docs/ux-review/03-authoring-loop.md` (R2/R6/R7, §3.2/3.4/3.5), GitHub issue #77.

## 1. Summary

This increment completes the **core authoring loop** track of the UX redesign
master plan — the remaining C-workstreams after C1 (loop rail) shipped. It
closes the two biggest usability gaps left in the Use Case → Feature → Steps →
Suite → Run pipeline and folds in the open issue #77:

1. **WS1 — Pending Steps companion (C2 + Mi4 + #77).** Step-definition
   implementation stops being an unguided cliff out of the app: a dedicated
   right-sidebar **Pending Steps** leaf lists every undefined step, generates
   stubs, shows the generated code read-only at the exact insertion lines, and
   opens the step file in the system editor. The two overlapping detail-view
   buttons collapse into one **Steps** action. A content-addressed
   **step-coverage cache** records bddgen verdicts so the loop rail's Steps
   stage becomes authoritative instead of conservatively static (closes #77).
2. **WS2 — Tag-aware suites (C4).** The suite modal's bare tag-expression text
   field grows a vault-wide **tag palette + operator buttons**; the Feature
   editor shows **"In N suites"** per scenario via a new per-scenario
   membership projection; a lightweight **Tag glossary** hub body lands in the
   Run section.
3. **WS3 — Rename identity guard (C5).** A structured-editor scenario rename
   that would drop recorded run history is intercepted with an inline blocking
   confirm; renames without history stay frictionless.

## 2. Decisions (locked)

| # | Decision |
|---|----------|
| D1 | **Scope = the authoring-loop track** (C2/C4/C5), not the Run view (C3), the board (D-track), or dashboards/settings (E-track). Product-owner pick, 2026-07-17. |
| D2 | **C2 depth: in-Hub read-only stub viewer** (report 03 open question 5). The Pending Steps panel shows generated stub code read-only, scrolled/highlighted via per-stub line ranges, plus an "Open step file" jump to the system editor. **No in-Obsidian step-file editor.** |
| D3 | **C5 model: blocking confirm, history case only** (report 03 open question 4). Copy softened to "has recorded history (N recent runs)" — N is the history index's recent-window count; **no exact-total count API**. No post-hoc "re-attach history" repair. |
| D4 | **Issue #77 is folded into WS1**; the **Tag glossary is folded into WS2**. Both explicitly opted in. |
| D5 | **The Pending Steps surface is a right-sidebar companion leaf** (like the Test Console), not an inline panel or modal — it stays open as a guide while the user edits the step file externally or the Feature in the main pane. |
| D6 | **Coverage cache is content-addressed on BOTH inputs** — `stepTextsHash` (the Feature's Gherkin step texts) *and* `defsHash` over the **raw step-file sources (path + bytes)** — instead of #77's sketched `defsRevision` event counter. Raw sources, not the scraped pattern set: bddgen coverage can depend on step-file code the scraper cannot model (custom parameter types, regex helpers, variable-built definitions), so a pattern-only digest could serve a stale verdict after such code is edited (Codex P2 on PR #102). `allStepsDefined` already reads the step files for its static pass, so this costs no extra I/O and catches **any** external steps-dir edit — extra misses are the safe direction. **Self-containment precondition:** a verdict is only recorded when no step source escapes `src/steps` via a relative parent import (`../`) — bddgen executes the whole runner graph, so an out-of-tree helper edit would be invisible to this digest; non-self-contained setups simply keep the pre-#77 static behavior (Codex P2 follow-up on PR #102). Runner config/package drift within a live session is out of scope: the cache is session-scoped and any detect re-records. **Feature-side validation:** bddgen reads the `.feature` from disk mid-spawn, so the verdict is recorded only if a post-spawn re-read still matches the pre-spawn step texts — an external edit landing inside the spawn window skips the record (miss-safe); an edit-and-revert entirely within the window is the accepted unobservable residual (Codex P2 on PR #102). Every generate entry point (detail rows AND the command palette) triggers the best-effort re-detect so a changed step-source set re-records promptly. |
| D7 | The cache is **in-memory, per-session** (a projection, rebuilt by use; a miss is always safe — it falls back to the static heuristic). Nothing is persisted. |
| D8 | The panel's **vault-wide target uses the static signal only** for its listing; bddgen runs only on explicit per-feature actions (open-refresh of a targeted feature, Verify, Generate). **No process spawn on render or on event-driven refresh** (#77 acceptance). |
| D9 | **Merged Steps action (Mi4):** the Use Case detail's per-Feature "Detect missing steps" + "Generate step definitions" buttons collapse into one **Steps** button that opens the panel. Command palette **ids stay unchanged** (B3 discipline). |
| D10 | The suite modal **stays an imperative `Modal`** (ADR-0033 Phase 5 modal migration remains deferred); the builder is added via pure helpers + the established DOM API pattern. |
| D11 | The "In N suites" badge uses a **new per-scenario suite-membership projection** (each suite's Tag Expression evaluated against the scenario's effective tags) — explicitly not `scenarioCounter`, which is a corpus aggregate (Codex catch in report 03 R6). |
| D12 | The Tag glossary lives as a **hub body in the Run section** beside Test Suites. Read-only this pass. |
| D13 | No new ADR: no hard-to-reverse, shape-defining decision is made here (the leaf follows the established console pattern; the cache is a session projection). CONTEXT.md gains the new named surfaces instead. |

## 3. WS1 — Pending Steps companion + authoritative step coverage

### 3.1 Service layer (pure, unit-tested)

**Insertion ranges.** `GenerateStepDefinitionsResult`
(`src/application/services/step-definition-service.ts`) gains:

```ts
/** 1-based line ranges of each stub in the written file, in write order. */
insertions: Array<{ step: string; startLine: number; endLine: number }>;
```

The service composes the exact written content itself (`buildAppendedStubs` /
`buildStepDefinitionStubFile` over the prior file content), so the ranges are
computed at write time — covering the appended-to-existing-file and multi-stub
cases the report's Codex catch calls out. The
`stepdefinition.generated` event payload is unchanged.

**Step-coverage cache (#77).** A new application-layer `StepCoverageCache`:

- Entry: `featurePath → { stepTextsHash, defsHash, covered }`.
- **Populated wherever bddgen actually runs:** `detectMissingSteps`, and a
  **post-generate re-detect** inside the generate flow so "Generate" lands an
  authoritative "covered" without a second manual Detect (#77 acceptance;
  one extra bddgen run per generate, explicitly user-triggered).
- **Consulted by `allStepsDefined`** (`specification-service.ts`): compute the
  current `stepTextsHash` from the freshly-read Feature(s) and `defsHash` from
  the freshly-loaded pattern set (both already read on this path today); on a
  full match return the cached authoritative `covered`, otherwise fall back to
  the existing static heuristic. The method signature does not change — the
  loop rail's `stepsDefined` fact (`loop-rail-rows.ts` `LoopRailFacts`)
  upgrades transparently.
- Hashing: a small pure stable-digest helper over the ordered step texts /
  ordered pattern sources (reuse the existing digest utility used for Scenario
  Outline row keys if suitable, else a tiny FNV-style helper in `shared/utils`).

**Panel data.** A pure projection assembles per-feature panel rows from the
parsed Feature + loaded patterns (static tier: per-step defined/undefined,
progress counts) and overlays bddgen results when present (authoritative tier,
from the cache or a just-run detect).

### 3.2 The Pending Steps leaf

- New view type (right-sidebar companion, registered in `register-views.ts`
  following the Test Console pattern), Vue app per ADR-0033, with
  `getState`/`setState` target persistence following the established
  restore-gap rule (first render in `onOpen()` after subscriptions).
- Target state: `{ kind: "use-case", useCaseId } | { kind: "feature", featurePath } | { kind: "vault" }`.
  Re-targeting an open panel reveals and repoints the single instance.
- **Per-feature group UI:** progress line + bar ("12 of 15 steps defined",
  `[data-status]`-reinforced), the undefined-step rows (keyword + text),
  actions: **Generate stubs**, **Verify (bddgen)**, **Open step file** — and
  the **read-only stub viewer**: after a generate, the panel reads the written
  step file and renders it read-only, auto-scrolled to and highlighting the
  returned insertion ranges, with a copy affordance. Collapsible per feature.
- **Vault target:** lists Features that the *static* signal reports incomplete,
  each expandable into the same per-feature group (D8).
- **When bddgen runs:** a **feature-targeted open** auto-runs one authoritative
  Verify (opening the panel at a Feature is an explicit user action); the
  use-case and vault targets render from the static tier until the user hits a
  per-feature **Verify** or **Generate** (D8) — so a many-feature target never
  fans out into a batch of spawns.
- **Live refresh:** `specification.updated` and `stepdefinition.generated`
  re-run the static pass only (cheap reads; the content-addressed cache
  self-invalidates by hash). During an active run, bddgen actions disable with
  the standard `RUN_IN_PROGRESS` reason.
- **System editor:** a new `openInSystemEditor(path)` on the workspace port
  (`src/application/ports/workspace-port.ts`), implemented in the Obsidian
  adapter via `openWithDefaultApp`. Desktop-only plugin, so unconditional.

### 3.3 Entry points

- **Use Case detail:** each `FeatureRow`'s two step buttons collapse into one
  **Steps** button → opens the panel targeted at that Feature. The Use
  Case-level rail action `generate-steps` re-points to open the panel targeted
  at the Use Case, CTA label becomes **"Open pending steps"**
  (`loop-rail-rows.ts` `ACTION_LABEL`).
- **Test Console:** the missing-steps prose hint (`test-console-format.ts`)
  becomes a **button** — "Open pending steps" — targeting the run's Use
  Case/Feature scope when it has one, else the vault target.
- **Command palette:** a new `Test Hub: Specification — Open pending steps`
  command (vault target); existing detect/generate command ids unchanged (D9).
- **Guided Tour:** its step-definitions stage completes on the
  `stepdefinition.generated` event (`tour-steps.ts`), which the panel's
  Generate emits unchanged; the tour step's action button re-points to open
  the panel so the taught flow matches the merged UI.

### 3.4 Acceptance (WS1)

- An advanced-construct Feature (custom parameter types, optional/alternative
  syntax) that bddgen confirms runnable advances the loop rail off Steps after
  one Verify or Generate — without a Detect on every render.
- Editing a Feature (in-plugin **or** externally) after a "covered" verdict
  never leaves the rail stale-green: the hash misses and the static heuristic
  resumes (#77 acceptance).
- Generate lands the user on the exact stub code: viewer scrolled to the
  inserted ranges + "Open step file" in the system editor.
- No bddgen spawn on render, on event refresh, or from the vault listing; no
  `.features-gen` churn outside explicit Verify/Generate.
- Issue #77 is closed by this workstream.

## 4. WS2 — Tag-aware suites

### 4.1 Suite modal tag-expression builder

- In `create-suite-modal.ts` (imperative, per D10): a **tag palette** of chips
  from `FeatureInsightService.listKnownTags()` and **operator buttons**
  (`and`, `or`, `not`, `(`, `)`).
- Clicking a chip/operator composes into the existing expression input via a
  pure `insertToken(expression, cursorPos, token) → { expression, cursorPos }`
  helper (spacing-aware); the input stays free-text editable and the existing
  debounced live "Matches N scenarios" preview is untouched.
- Empty-vault state: palette hidden, plain field as today.

### 4.2 "In N suites" per-scenario badge (Feature editor)

- New pure projection: `suiteMembership(scenarioEffectiveTags, suites) →
  matching suite names`, evaluating **each suite's Tag Expression against the
  scenario's effective tags** (feature tags + scenario tags, the existing
  `effectiveScenarioTags` helper) with the same evaluator the match counts use
  (D11).
- The Feature editor loads the suite list once per open (refreshing on suite
  events via the established live-refresh helper) and renders an
  **"In N suites"** chip under each scenario's tag row; tooltip lists the
  suite names; `N = 0` renders muted ("In no suites") so authors see the
  consequence of tag edits immediately.

### 4.3 Tag glossary (hub body, Run section)

- A new hub body registered in `hub-sections.ts` under **run**, beside Test
  Suites: a table of every known tag → scenario count → suites whose
  expression references it.
- One pure projection over (all Features' effective scenario tags, all suites'
  expressions — token extraction from the parsed expression, not substring
  matching). Suite names deep-link to the suite note via the existing navigate
  port; tag rows themselves don't link this pass. Read-only (D12).

## 5. WS3 — Rename identity guard

- **Intercept point:** the structured editor's scenario-name commit
  (`ScenarioCard.vue`, `v-model.lazy` + `@change` → `ctrl.commit()`). On a
  name change, before committing: if the **old** name's Scenario Reference has
  recorded history, swap the card's name row into an inline confirm strip:

  > Scenario "Checkout" has recorded history (7 recent runs) — renaming starts
  > fresh. **[Rename]** **[Keep name]**

  Rename → proceed with the normal commit; Keep name → restore the previous
  name, no commit. Scenarios without history commit exactly as today.
- **History fact:** from `ScenarioHistoryService.latestStatuses()`, prefix-
  matched as `featurePath::name` **and** `featurePath::name::row-*` so Outline
  example-row history also triggers the guard. N = the recent-window entry
  count summed across matching refs — additive `recentRuns` field on
  `ScenarioLatestStatus` (the index already holds the window; no new
  exact-total API, per D3). Copy without a count ("has recorded history")
  when the count is unavailable.
- The history map loads lazily once per editor open (the service caches its
  index; reads are queue-serialized) — no per-keystroke I/O.
- The existing passive `renameAdvisory` validation-strip warning stays as the
  backstop for raw-mode and external edits.
- Confirm-state decisions live in a pure module (given old name, new name,
  history map → `commit | confirm(prompt)`), unit-tested; the component test
  covers the strip swap/restore.

## 6. Cross-cutting

- **Architecture:** presentation stays thin — every new decision is a pure
  projection/helper with unit tests (`tests/`), Vue components get
  `tests/vue` component tests; services return `Result<T>`; layer boundaries
  per ESLint rules. No `innerHTML`; Obsidian DOM API / Vue templates only.
- **Styling:** A1 token sheet + A2 components (`spec-panel`, `spec-chip`,
  `spec-empty`, status chips); brand `--spec-accent` for chrome only; status
  colours via `--spec-status-*` always paired with `[data-status]` text
  reinforcement.
- **Docs:** CONTEXT.md gains **Pending Steps** (named surface) and **Tag
  glossary**; CHANGELOG entries per workstream; README "Working from the UI"
  updated for the Steps flow; issue #77 closed by WS1's PR.
- **Out of scope:** the Run view rebuild (C3/T4), run-time environment
  override (R5), first-feature slug prompt (report 03 Q7), re-attach-history
  repair, an editable glossary, in-Obsidian step-file editing, board (D) and
  dashboard/settings (E) tracks.

## 7. Sequencing & risks

**WS1 → WS2 → WS3**, each an independently shippable PR (mirroring E1/B2).

| Risk | Mitigation |
|---|---|
| Line ranges drift from written content (CRLF, trailing-newline edge) | Ranges computed from the exact composed string the service writes; unit tests over fresh-file, append, multi-stub, and no-trailing-newline cases |
| Stale "covered" from external step-file edits | D6 content-addressing on the defs side (hash the freshly-loaded pattern set every read) |
| bddgen cost creep | D8: bddgen only on explicit actions; static tier everywhere else |
| Sidebar leaf state restore | Follow the documented restore-gap rule (ADR-0031 pattern, `persisted-leaf-state.ts`) |
| Membership badge cost on large vaults | Suites list loaded once per editor open + event refresh; evaluation is pure/in-memory per scenario |
| Confirm strip fighting `v-model.lazy` | Guard runs in the change handler before `ctrl.commit()`; component test locks the swap/restore behaviour |
