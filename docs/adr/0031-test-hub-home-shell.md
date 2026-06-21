---
type: adr
id: ADR-0031
status: accepted
title: Test Hub Home Shell
date: 2026-06-21
related:
  - "[[0029-story-map-visual-board]]"
  - "[[0026-prd-hierarchy-artifact-model]]"
---

# Test Hub Home Shell

The plugin grew one workspace leaf per surface (dashboard, PRDs, Story Maps, Use
Cases, Suites, Evidence, Console, …), each opened from its own ribbon icon. That
scatters the experience across many top-level entry points and gives no single
"home" the user lands on. WS-B1 (01-§3.6) decides a **Test Hub home shell**: one
leaf with a persistent left-rail section switcher that organizes the surfaces
into a small, ordered set of sections.

This ADR records the shell's shape and the lifecycle/persistence/migration
decisions it forces. **This PR (B1-PR1) is model-only**: it lands the pure
projection (`hub-sections.ts`) and an additive breadcrumb generalization; the hub
view itself is a later increment.

## Decision

### Single leaf, five-section rail
The hub is a **single `ItemView` leaf** with a persistent left rail. The rail has
**five sections, in order**: `overview`, `plan`, `build`, `run`, `review`. The
default landing section is **`overview`** — a health/status home that hosts the
KPI funnel + recent runs (the full health hero is a later E1 increment).

Each section hosts content (`hub-sections.ts` `contents` map):
- **overview** — KPI/health summary + recent runs (in-hub bodies).
- **plan** — PRD roadmap + Story Map list (in-hub bodies).
- **build** — Use Cases list (in-hub body).
- **run** — Test Suites list (in-hub body); Open Test Console is a section leaf
  opened in the **sidebar**.
- **review** — Evidence list (in-hub body).

A section's `contents` lists only what it renders statically: in-hub bodies, plus
the **no-required-state** Test Console as a `leaf` content ref. The `leaf` ref
carries its `location` (`"main" | "sidebar"`, the `openView` param) so the console
opens as its sidebar companion rather than defaulting to a main tab. The id-TARGETED
leaves — a specific Story Map *board* or Use Case *detail* — are **not** section
contents: they open **per row** from the `story-maps` / `use-cases` bodies via the
B4 navigate port (`navigate({ kind: "artifact", id })`), which resolves the id to a
leaf carrying the required `{ storyMapId }` / `{ useCaseId }` state. Modelling them
as a bare `viewType` would open an untargeted, empty leaf.

Section icons (Lucide, 01-§3.6): overview `layout-dashboard`, plan `git-fork`,
build `file-check`, run `play`, review `gauge`. The brand `--spec-accent` token
highlights only the **active** nav node (chrome), never a run/automation status.

### Re-render bodies, not child leaves
Obsidian has **no supported nested-`ItemView` API**; view lifecycle is leaf-bound.
The hub therefore **re-renders its body content in place** when the active section
changes — it does not host child leaves. Demoted list surfaces render as plain
in-hub bodies inside the single leaf; the surfaces that genuinely need their own
leaf lifecycle (board / console / use-case detail / feature editor) stay leaves.

### Active-section persistence via getState/setState + a pure resolver
The active section is **ephemeral-but-persisted view state**: `getState()` returns
`{ section }` and `setState()` reads it back, so the rail survives a workspace
reload. All validation lives in the pure `resolveActiveSection(persisted)`
(`hub-sections.ts`): unknown / undefined / empty all fall back to the default
(`overview`), so a stale layout never strands the hub on a non-existent section.
The view stays a thin render over the unit-tested projection (ADR-0029).

### Workspace-restore (restore-gap) handling
Mirroring `use-case-detail-view.ts`: on a workspace **restore** Obsidian calls
`setState()` **before** `onOpen()`, before the event-bus subscriptions exist. The
hub follows the same rule — `setState()` only re-renders when the view is already
open; the first render is left to `onOpen()` (after subscribing), so an event in
the restore gap can't paint stale content.

### Demotion strategy
List surfaces become **in-hub bodies**; the **board / console / detail /
feature-editor** stay **leaves**, opened via the B4 navigate port. The pure model
encodes this as a discriminated `HubContentRef` (`section-body` vs `leaf`), so the
routing is data, not branching scattered through the view.

### Dashboard view-type alias migration
The existing dashboard leaf (`e2e-test-hub-dashboard`) is the closest predecessor
to the hub. To avoid orphaning persisted layouts, that **old view type stays
registered and is aliased to the hub** — a saved workspace referencing
`e2e-test-hub-dashboard` opens the hub (on the overview section) rather than a
dead leaf.

## Consequences
- The hub becomes the single home; per-surface ribbon entry points can shrink
  (B3) and onboarding can target one leaf (B2).
- All hub logic (section model, rail projection, active-section resolution,
  breadcrumb root) is pure and tested; the view stays thin (complexity gate).
- The breadcrumb root is generalized to `Test Hub › <Section>` via `hubCrumbRoot`,
  added as an **optional** parameter that defaults to `plan` so every existing
  trail (and its A4/B4 tests) is unchanged.
- Board/console/detail/feature-editor keep their own leaves and lifecycles; only
  list surfaces are demoted into the hub.
- The old dashboard view type is kept as a registered alias indefinitely, so
  persisted layouts never orphan.

## Deferred (unblocked by B1)
- **B2** — onboarding rail hosted in the hub shell.
- **B3** — ribbon reduction now that the hub is the single home.
- **Identity bar** — the hub's top identity/context strip.
- **E1** — the full health hero on the overview section (PR1 lands only the
  KPI + recent-runs bodies it will sit above).

This PR (B1-PR1) lands only the pure model and the breadcrumb generalization; no
view, `main.ts`, or `register-views.ts` change.
