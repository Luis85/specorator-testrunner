# Story Maps — Workflow & Integration Polishing Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Each increment lands gate-green (format:check · lint · typecheck · build · test ≥80% · `fallow audit --base origin/main` exit 0) on PR #68 / branch `claude/storymaps-prd-tooling-k9tpnx` before the next.

**Goal:** Make the Story Maps feature easy and coherent, get the user **fast to a working board** (upstream), and **close the upstream→downstream seam** (card → Use Case) so the map lays a solid foundation for downstream processes and testing. **P5 (zoom/pan) is deferred indefinitely.**

**Decisions (locked with the product owner):**
- **Empty-vault onboarding → auto-seed a default `PRD-000`** so map creation always completes from a fresh vault.
- **Downstream seam is the headline** → add **Promote card → Use Case** (create the UC, anchor it to the map's product, set the card `ref`) + a UC **picker** for existing refs + an **"not created"** marker for unresolved refs.
- **Full editing-surface consolidation** → board `+ card`/edit route into the **Card modal** (single deep-edit surface); add a **Map-settings** surface (title/status/product); make the **users lane** board-editable; **rename "Rebuild grid" → "Refresh tables"** behind an Advanced/⋯ action; **remove the standalone Card-manager modal**.

**Source map (feature files):** domain `story-map.ts`; services `story-map-service.ts`, `story-map-builder.ts`, `story-map-cards.ts`, `story-map-card-form.ts`, `use-case-service.ts`, `prd-service.ts`; content `story-map-content.ts`; views `story-map-builder-modal.ts`, `story-map-explorer-view.ts`, `story-map-card-modal.ts`, `story-map-card-manager-modal.ts`, `story-map-card-rows.ts`, `story-map-board-view.ts`, `story-map-board-scene.ts`, `story-map-board-layout.ts`; `CONTEXT.md`, `README.md`, ADR-0027/0028/0029.

---

## Status — COMPLETE (all passes landed gate-green on PR #68)

- **W1** Fast to a working board — `083f91b` (+ seed fix `0110be9`)
- **W3** Upstream→downstream seam (promote card → Use Case) — `628ffd0`
- **W2b + W4** Coherence + discoverability (Refresh tables, hint, tooltips, README) — `4b7dd07`
- **W2c** Map-settings surface (title/status/product) — `47791a9`
- **W2a** Editable users lane on the board — `6eb9535`
- **W2d** Edit-details pencil → Card modal; remove standalone Card-manager — `cb8dda2`

Codex P2 review fixes landed alongside: header reorder preview vs persisted order `f8e08c6`; managed-block `$`-token literal replacement `021b642`; settings-modal sends only changed fields `c8cb15b`.

**Product decision for W2d `+ card`:** kept the fast one-click placeholder add; the deep Card modal is reached by a per-card ✎ "Edit details" affordance (points/tags/ref/promote), not by `+ card`.

---

## Pass W1 — Fast to a working board (onboarding)

- [ ] **Default backbone.** Add `DEFAULT_ACTIVITIES` to `story-map-builder.ts` initial state (mirror `DEFAULT_SLICES`) so Next→Create works out of the box. Test.
- [ ] **Auto-seed `PRD-000`.** Ensure the reserved root PRD exists at map-create time when no PRD resolves: investigate `PrdService.create`/root handling; add an "ensure root PRD-000" path invoked from the create flow (service or builder modal). Empty vault must reach a working map with no detour. Tests (create in an empty vault succeeds + seeds PRD-000; existing PRDs untouched).
- [ ] **Wizard fast path.** Allow **Create** from step 1 once title + product are valid (a "Create now / Add detail" affordance), collapsing the minimum path to ~2 clicks. Optional steps (users/steps) remain skippable.
- [ ] **Wizard step descriptions.** Add a one-line `.setDesc()` under each step explaining the jargon (backbone = the left→right journey of activities; slices = horizontal release bands, top = walking skeleton; steps = tasks under an activity).
- [ ] **Route to the board.** Explorer row's primary (title) click → **opens the board** (demote "open note" to secondary); after a successful create, **open the board** for the new map directly. Add an "Open board" command if missing.
- [ ] Docs (CONTEXT/README touch as needed) + gate + commit + push.

## Pass W2 — Coherent editing model (full consolidation)

- [ ] **Board `+ card` → Card modal.** Replace the placeholder `addCard` with opening `StoryMapCardModal` pre-seeded with the clicked cell's coordinate; on save it persists a full card. (Wire the board's deps to construct the modal + `storyMapService.addCard`.) Remove the board placeholder fork.
- [ ] **Board → full card edit.** Add a per-card "edit" affordance (hover ⋯/pencil) that opens the Card modal for the card's full attributes (points/tags/ref/coordinate); keep double-click inline-title rename for the fast path.
- [ ] **Map-settings surface.** New lightweight modal (rename title / set status / re-anchor product) reached from the explorer row and/or board title; product reassignment uses the existing `requireResolvableProduct` safe-write path. Closes the YAML-only gap.
- [ ] **Users lane editable on the board.** Domain ops `addUser`/`renameUser`/`removeUser` (pure, tested) + scene affordances + view wiring, mirroring activity headers.
- [ ] **"Rebuild grid" → "Refresh tables".** Rename the action + note prose (drop the CONTEXT.md-reserved "grid" term for the board), move it behind an Advanced/⋯ row action in the explorer.
- [ ] **Remove the standalone Card-manager modal.** Delete `story-map-card-manager-modal.ts` (+ rows) and its launch button; the board + Card modal cover its capability. Update tests/commands.
- [ ] Gate + commit + push (likely split into 2–3 commits).

## Pass W3 — Upstream→downstream seam (the foundation)

- [ ] **UC picker for refs.** Replace the Card modal's raw "Reference" textbox with a dropdown of the map's product's existing Use Cases (`UC-NNN` + title) plus free entry for forward refs. Inject `Pick<UseCaseService, "findAll">` (or a resolver) into the modal.
- [ ] **Promote card → Use Case.** On a reference-less card, a **"Promote to Use Case"** action: `useCaseService.create({ title: card.title })` → `assignToPrd(newId, map.product)` (UC inherits the map's product anchor) → `updateCard` to set the card's `ref`. One click closes the manual handoff; keeps `prd-id` as the single parent (ADR-0026/0027). Investigate `UseCaseService.create`/`assignToPrd` signatures first.
- [ ] **Mark unresolved refs.** Show a "not created" cue for a card whose canonical `ref` doesn't resolve to a UC note — in the Card modal and on the board card — driven by the resolver the service already has, paired with "Create this UC now" (the promote action). Forward refs become visibly actionable instead of silently dangling.
- [ ] Domain/content tests for resolution state; gate + commit + push.

## Pass W4 — Discoverability & docs

- [ ] **Board legend/hint.** A persistent one-line board hint/toolbar: "Hover a cell for + card; hover a card to edit/color/status/remove; double-click any header or card to rename; drag to move/reorder." (Scene text or a small DOM toolbar above the SVG.)
- [ ] **Header rename tooltips.** Add `<title>` "Double-click to rename" to activity/slice/step header rects.
- [ ] **README "Using Story Maps".** A short workflow section: create map → add cards (board `+ card`) → arrange (drag, double-click rename, swatch/chip) → promote cards to Use Cases → tables stay in sync.
- [ ] **Terminology cleanups.** Standardize "no planning status" to "(none)" across board/modal; label the explorer status pill ("Map status: …"); board status-chip tooltip "Cycle planning status".
- [ ] Gate + commit + push.

---

## Self-review notes
- Each increment is gate-green + pushed before the next; pure logic (domain ops, resolution state, builder defaults) lives in tested modules, views stay thin/test-exempt.
- W1 first (fastest user value), then W3 (the downstream foundation), then W2 (consolidation), then W4 (discoverability) — but W2's "remove Card-manager" depends on W2's board→modal routing landing first.
- Watch the complexity gate on the board view (already near the file-size warning); extract pure helpers / `fallow-ignore` for untested view methods as established.
