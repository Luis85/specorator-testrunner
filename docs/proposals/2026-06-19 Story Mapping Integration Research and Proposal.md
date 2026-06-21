# Story Mapping Integration — Research & Proposal

_Date: 2026-06-19. Synthesized from a three-track research effort dispatched as
dedicated subagents: (1) a technical dossier on **storymaps.io** (Jack Gleeson)
as a candidate tool, (2) **user-story-mapping methodology** and how it maps onto
this project's accepted artifact hierarchy, and (3) a **codebase integration
surface** map tracing the existing PRD vertical slice as the template to mirror.
Builds on — and assumes — [ADR-0026 (PRD Hierarchy Artifact Model)](../adr/0026-prd-hierarchy-artifact-model.md),
[EPIC-017 (Discovery & Non-Technical Collaboration)](../issues/EPIC-017.md), and
the [V2 Research and Proposal](./2026-06-11%20V2%20Research%20and%20Proposal.md)._

---

## 1. Executive summary

The ask: integrate **[storymaps.io](https://github.com/jackgleeson/storymaps.io)**
to add tooling for the **upstream design process** — building out PRDs and
stories. The research produced one clear strategic answer and one clear tactical
answer.

- **Strategic (where it fits):** A **story map fills a genuine, currently-empty
  gap** in the artifact model. The accepted hierarchy — **Domain → PRD → Use Case
  → Feature → Scenario** (ADR-0026) — is a *single-parent logical decomposition*.
  It deliberately encodes neither **user-journey sequence** (a backbone is an
  *ordered* narrative; PRD `scope_in` is an unordered *set*) nor **release
  slicing across capabilities** (a slice mixes Use Cases from different PRD
  branches into one end-to-end increment; the tree's single-parent invariant
  cannot express that). A story map adds exactly those two facts and nothing
  else.

- **Tactical (how to build it):** **Do not embed or fork storymaps.io.** It is
  **AGPL-3.0-only** (network-copyleft — would force the whole plugin to AGPL) and
  **architecturally incompatible** — a server-dependent app (Node + WebSocket +
  Yjs + LevelDB/SQLite) with **no offline / local-only mode**, the opposite of
  this project's local-first, Markdown-first, no-bundled-runtime principles.
  Instead, **clean-room reimplement its (excellent, plain JSON/YAML) data model**
  as a native Markdown artifact, mirroring the existing **PRD vertical slice**.
  Formats are not copyrightable; this is the AGPL-safe, principle-aligned path,
  and it optionally buys **interop** with storymaps.io's own YAML/CLI for users
  who want it.

The recommended shape: a **Story Map** is a new artifact that is a **sibling /
overlay to the PRD, not a layer inserted into the tree**. It references Use Cases
by `UC-NNN` id (never copies their content), so ADR-0026's single-parent
containment invariant stays intact and the Use Case's `prd-id` remains its one
true parent. It composes *above* the already-planned **Example Maps** (EPIC-017,
US-072/073) along the shared `UC-NNN` seam — story mapping shapes the journey and
selects/sequences Use Cases per slice; Example Mapping then drills each selected
Use Case into rules/examples that generate `@draft` scenarios. The two are
distinct techniques and must not be conflated.

---

## 2. Tool dossier — storymaps.io (Jack Gleeson)

Sources: [repo](https://github.com/jackgleeson/storymaps.io),
[storymaps-cli](https://github.com/jackgleeson/storymaps-cli), live site
`storymaps.io`. (The GitHub MCP tool is repo-scoped to this project, so the
dossier was gathered via public web fetch of the raw sources.)

| Area | Finding | Bearing on us |
| --- | --- | --- |
| **What it is** | A polished, free OSS **user-story-mapping** web app. Jeff-Patton-style 5-layer model: **Users → Activities (backbone) → Steps (journey columns) → Stories (cards) → Slices (release bands: MVP/V1/V2)**. Cards carry status, points, tags, colour, body. | Confirms the canonical model we should mirror. |
| **Tech stack** | Vanilla ES modules (no React/Vue), `type=module` import-map; **mandatory Node backend** (`server.js`): `y-websocket`, `ws`, `y-leveldb`, `better-sqlite3`. | Cannot run client-only; **cannot be embedded** in Obsidian. |
| **Persistence** | Server-side only — **LevelDB** (Yjs doc) + **SQLite** index. `yjs.js` hard-wires a `WebsocketProvider`; in-memory `Y.Doc`, **no `y-indexeddb`/localStorage fallback, no offline mode**. | Direct conflict with **P2 Local First**. |
| **Data model** | **The strong point.** Maps serialize to flat, human-readable **JSON/YAML**: `users` / `activities` / `steps` arrays + `slices[].stories` 2-D array; card fields `name, body, color, status, points, tags, url, hidden`. Import/export JSON, YAML, CSV; Jira/Asana/Linear importers. A YAML-based **CLI** exists precisely to *diff maps in pull requests*. | **Clean-room reimplement this** as Markdown/YAML. Optional interop target. |
| **License** | **AGPL-3.0-only** (`LICENCE` + `package.json`). Network copyleft. | **Decisive against embed/fork.** Any copied code → whole plugin becomes AGPL. |
| **Maintenance** | Created Jan 2026; ~100 commits; effectively a single maintainer; 0 releases (tags only); open issues **#2 "IDE plugin support"** and **#10 "CLI / MCP"** show the author is already thinking about exactly this kind of integration. | Low coupling risk if we own a clean-room model; possible future collaboration/interop. |

**Verdict: REIMPLEMENT THE DATA MODEL — do not embed or fork.** The decisive
evidence is the combination of `"license": "AGPL-3.0-only"` with `yjs.js`
hard-wiring a backend `WebsocketProvider` and an in-memory-only `Y.Doc` with no
offline fallback. The serialized format, by contrast, is plain and portable and
matches our constraints almost exactly.

---

## 3. Methodology — where a story map fits in *this* hierarchy

Canonical structure (Jeff Patton): **Backbone** = high-level **Activities** in
left-to-right journey order (cannot be prioritized) → **Tasks/Steps** decomposed
under each activity → **Stories** stacked beneath → **Release slices** = horizontal
bands cutting across the *whole* map, the topmost being the **walking skeleton**
("the smallest end-to-end system you could build"). Framing principle: *minimize
output, maximize outcome.* The load-bearing critique: a flat backlog is "a bag of
context-free mulch"; **the new backlog is a map.**

### 3.1 The axes are orthogonal to our tree — and that's the whole point

| Story-map element | Nature | Correspondence here |
| --- | --- | --- |
| Backbone / Activities | Horizontal, temporal, journey-ordered; **spans PRDs** | **No existing artifact** |
| Tasks / Steps | Decomposition of an activity | ~ a **Use Case** (single capability) |
| Story cards | Smallest buildable unit | existing **US-NNN** / increments |
| Release slices / walking skeleton | Horizontal bands **across PRD branches** | **No existing artifact** (`increment` is the closest, but it's per-UC and branch-local) |

Two structural facts make the placement decisive:

1. **Our tree is single-parent containment** (ADR-0026: "every `prd-id`
   reference unambiguous"; ADR-0012: no shared Features). A story map is the
   *opposite* shape — a backbone activity legitimately spans many PRDs, and a
   slice deliberately groups Use Cases from *different* branches. You cannot model
   activities or slices as nodes *inside* the tree without breaking the
   single-parent invariant or duplicating Use Cases.
2. **The PRD already owns "what problem / how far scope reaches"** but, by design,
   carries only `display_order` for sibling sort — **no cross-capability ordering
   and no temporal flow.** The gap is real, but it is *not* "between PRD and Use
   Case."

### 3.2 Recommendation: a Story Map is a **sibling overlay to the PRD**

- **Reject** "a new layer between PRD and Use Case" — inserts a fourth
  containment layer into a tree whose single-parent invariant is defended in two
  ADRs, forces every UC to re-home, and *still* can't model cross-branch slices.
- **Reject** "a pure ephemeral view over existing frontmatter" — tempting (zero
  new source of truth), but the two things a map adds (**activity sequence** and
  **slice membership**) exist nowhere in current frontmatter, and a view can only
  render data that exists.
- **Adopt** a **Story Map note (`type: story-map`) as a PRD sibling**, anchored to
  the product (`product: PRD-000`), that is a **pure index of references**: for
  each card it stores only a `UC-NNN` reference plus its `(activity, slice)`
  coordinates — never a copy of the Use Case. It introduces *exactly two* new
  persisted facts (backbone order + slice membership) and resolves everything else
  (title, status, automation roll-up) live from the referenced Use Cases.

> In one line: **the map is a sibling overlay keyed to the product, addressing
> Use Cases by id; the containment tree stays the source of truth, the map adds
> only sequence and slice.**

### 3.3 Story Mapping ≠ Example Mapping (they compose)

Distinct altitudes, distinct phases — and EPIC-017 already commits to the second:

- **Story Mapping** is *whole-product / journey shaping* (breadth-first): "what is
  the user trying to accomplish across the product, in what order, and what's the
  thinnest end-to-end slice we can ship?" Unit: activity / task / slice. Operates
  **above and across** Use Cases.
- **Example Mapping** (US-072/073, UC-035) is *per-story scenario discovery*
  (depth-first on one Use Case): rules → examples → questions, where an agreed
  example becomes a `@draft` Gherkin scenario. Operates **at and below** one Use
  Case.

The pipeline: **Story Map** selects/sequences the Use Cases for a slice →
**Example Map** drills each into rules/examples → **US-073** generates `@draft`
scenarios. The shared `UC-NNN` id is the seam that lets them compose without
merging — the map points *at* the UC; the example map hangs *under* it. Distinct
`type:` values keep them un-conflatable.

### 3.4 What a story map adds that the PRD hierarchy does not

1. **User-journey / temporal flow** — `scope_in` is a set; a backbone is a
   sequence.
2. **Release slicing across capabilities** — one end-to-end increment drawn from
   several PRD branches; the single-parent tree structurally can't say this.
3. **Cross-capability prioritization (walking skeleton)** — a *global* priority
   the tree was designed not to encode.
4. **Outcome-over-output framing** — "what outcome ships when this slice lands?"
   — EPIC-017's stated voice applied product-wide.

---

## 4. Proposed data model (Markdown, parser-safe, Bases-queryable)

Hard constraints pulled from the codebase (not preferences):

- The shared frontmatter parser round-trips **only string scalars and
  block-sequence arrays** — **no inline flow arrays, no `|` block scalars, no
  literal `null`** (ADR-0026; `prd-content.ts`).
- All queryable state must be **flat YAML properties** so it stays
  **Bases-queryable** (US-076, EPIC-018).
- Address Use Cases by **stable `UC-NNN` id**, never path or copied title.

The minimum viable model is a **2-D grid (activity column × release-slice row)
whose cells are `UC-NNN` references** — two new persisted axes and nothing else.
Encode each cell as a single **string scalar** (`"UC | activity | slice"`) so the
parser stays happy and Bases can still string-match membership:

```yaml
---
id: SM-001
type: story-map
title: Specorator end-to-end authoring journey
product: PRD-000            # anchors the map to the product root
status: draft
activities:                 # backbone — ordered (block sequence of slugs)
  - configure-sut
  - author-spec
  - run-tests
  - read-evidence
slices:                     # release bands — ordered; first = walking skeleton
  - walking-skeleton
  - next
  - later
cards:                      # each a parser-safe string scalar "UC | activity | slice"
  - "UC-013 | configure-sut | walking-skeleton"
  - "UC-037 | author-spec | walking-skeleton"
  - "UC-011 | run-tests | walking-skeleton"
  - "UC-035 | author-spec | next"
  - "UC-036 | author-spec | later"
display_order: 1
---

# Specorator end-to-end authoring journey

| Slice ↓ / Activity → | Configure SUT | Author spec | Run tests | Read evidence |
| --- | --- | --- | --- | --- |
| **Walking skeleton** | [[UC-013 Configure SUT\|UC-013]] | [[UC-037 Author a Use Case\|UC-037]] | [[UC-011 Run a Suite\|UC-011]] | … |
| **Next**             |            | [[UC-035 Facilitate discovery\|UC-035]]  |            |              |
| **Later**            |            | [[UC-036 Promote a checklist item\|UC-036]]  |            |              |
```

Why this exact shape: every value is a string scalar or block-sequence of string
scalars (passes the lenient parser); `activities` / `slices` / `cards` are flat
properties (Bases can query "which UCs are in `walking-skeleton`"); cards
reference UCs **by id only** (zero duplication; `prd-id` stays the single source
of containment truth); the map parents nothing (it's an index anchored by
`product:`); the body grid is a derived rendering, so git diffs stay small and
meaningful. This subset is **round-trippable to storymaps.io's YAML** later if we
want interop.

> **Rendering caveat (implementation, not schema).** The stored `cards` value is
> the bare `UC-NNN` id — that is the stable key. But the rendered body grid must
> use a **resolved, aliased wikilink** `[[<note name>|UC-NNN]]`, because generated
> Use Case notes are titled `UC-NNN <Title>.md` and a bare `[[UC-NNN]]` does
> **not** resolve in Obsidian. This mirrors the existing evidence renderer, which
> resolves each linked UC's note basename for exactly this reason
> (`src/application/services/evidence-generation-service.ts:99-101`, `:380-383`:
> `[[Note Name|UC-001]]` resolves to the real note while still showing the id).
> The Story Map grid projection must reuse that same UC-note-name resolution so
> cells never become dangling links.

---

## 5. Integration surface — mirror the PRD vertical slice

The hexagonal architecture makes this a near-mechanical mirror of the existing
PRD feature. Verified file:line anchors below.

### Files to create

| Layer | New file | Mirrors |
| --- | --- | --- |
| Domain | `src/domain/entities/story-map.ts` | `src/domain/entities/prd.ts` |
| Application | `src/application/content/story-map-content.ts` | `prd-content.ts` (`prdFolderName`, `buildPrdNote`) |
| Application | `src/application/services/story-map-service.ts` | `prd-service.ts` (`create`/`findAll`/`findById`/`delete`, `nextId` at `prd-service.ts:331`, folder-per-artifact path at `:132`, mutation lock at `:55`, event publish at `:168`) |
| Application | `src/application/services/story-map-builder.ts` | `prd-builder.ts` (pure state machine + projections) |
| Presentation | `src/presentation/views/story-map-builder-modal.ts` | `prd-builder-modal.ts` |
| Presentation | `src/presentation/views/story-map-explorer-view.ts` | `prd-explorer-view.ts` (`LiveDashboardView` base + tree build) |
| Presentation | `src/presentation/views/story-map-grid-rows.ts` | thin projection (`*-rows.ts`); the activity×slice grid model, unit-tested |
| Presentation | `src/presentation/views/dashboard-story-map-projection.ts` | `dashboard-prd-projection.ts` |
| Tests | `tests/story-map-service.test.ts`, `tests/story-map-builder-state.test.ts`, `tests/story-map-grid-rows.test.ts` | `tests/prd-service.test.ts`, `tests/prd-builder-state.test.ts` |

### Files to modify

| File | Change | Anchor |
| --- | --- | --- |
| `src/domain/settings/settings.ts` | add `storyMapsPath` to `TestHubPathSettings` + default `"Story Maps"` | `prdsPath` at `:13` / `:229` |
| `src/domain/events/domain-event.ts` | add `storymap.created` / `storymap.deleted` event names + payloads | `prd.*` at `:39-40` / `:120-121` |
| `src/compose-services.ts` | construct `DefaultStoryMapService`, expose on `ComposedServices` | PRD service wiring |
| `src/register-views.ts` | register `StoryMapExplorerView` | PRD view registration |
| `src/main.ts` | field + assign + ribbon ("Open Story Maps") + `openStoryMapBuilder()` | PRD opener / ribbon |
| `src/presentation/commands/register-commands.ts` | "New Story Map" / "Open Story Maps" commands | PRD commands |
| `src/presentation/views/dashboard-view.ts` | surface the roadmap projection tile | PRD roadmap section |

### Optional cross-link (defer; see §7 risk #1)

A Use Case → Story Map back-reference (`story-map-id` frontmatter on the UC,
`assignToStoryMap()` on `UseCaseService`) is **not required** by the
reference-overlay model and risks a second containment link competing with
`prd-id`. **Recommendation: omit it.** The map already references the UC by id;
the inverse link can be a *computed backlink* in the UC detail view rather than
stored state.

### The one genuinely hard part: 2-D rendering

The codebase renders **trees** (`prd-explorer-view.ts:121`) and **tables**
(`use-case-dashboard-view.ts:111`), but nothing draggable. Resolution, in line
with the V2 non-goal "no visual/drag-drop builder":

- **Render** the grid as a semantic **HTML `<table>`** (activities = columns,
  slices = rows, cells = links to the referenced Use Cases) — mirrors the
  existing UC table, accessible, mobile-degrades by horizontal scroll. Resolve
  each `UC-NNN` to its real note (reusing the evidence renderer's UC-note-name
  resolution; see §4 caveat) so cells link to titled notes rather than dangling.
  Keep the grid *model* in a unit-tested `*-rows.ts` projection; the view stays
  thin (AGENTS.md rule).
- **Author** via a structured detail view following the shipped **Feature
  Editor** pattern (round-trip parse/serialize, raw-mode fallback, live
  validation strip) — *not* a canvas. The builder modal stays a short wizard
  (title/product/domains → activities → slices → review); cell placement happens
  in the detail editor. This reuses the focus-preserving re-render groundwork
  (pre-V2 item 1.12 / TD-004) the rest of EPIC-017 already assumes.

---

## 6. Fit with existing direction

- **EPIC-017 (Discovery & Non-Technical Collaboration)** is the natural home: a
  story map is upstream-design / discovery tooling for POs/BAs, and it sits
  *above* the epic's Example Maps along the `UC-NNN` seam (§3.3). Proposed new
  stories: **US — Story Map artifact + builder**, **US — Story Map grid editor
  (Feature-Editor pattern)**, **US — Dangling-reference lint**, and an optional
  **US — storymaps.io YAML interop (import/export)**.
- **Product principles:** Markdown-first ✓, Local-first ✓ (no server, unlike the
  tool itself), Git-friendly ✓ (flat YAML diffs), CI-ready (N/A — design
  artifact), Zero-config ✓ (default `Story Maps/` folder).
- **Requires a new ADR** — "Story Map as PRD-sibling overlay" — because it is a
  shape-defining artifact-model decision, per the project's ADR discipline
  (companion to ADR-0026).
- **Guided Tour (ADR-0020):** the cross-cutting V2 expectation is that any new
  user-facing workflow extends the tour; the story-map create/edit flow publishes
  events, so it is teachable by construction.

---

## 7. Risks & anti-patterns (and the mitigations)

1. **Two sources of truth (cardinal sin).** If the map stored card titles/status
   it would fork from the Use Case. **Mitigation:** the map stores only `UC-NNN`
   ids + `(activity, slice)` coordinates; everything renderable is resolved live.
   Owns *exactly two* facts that exist nowhere else.
2. **Map ↔ backlog drift** (Patton's own warning — the map rots into fiction).
   **Mitigation:** a **dangling-reference lint** (reuse the structural-validation
   layer EPIC-017 §9 already plans) flags `UC-NNN` cards pointing at
   deleted/deprecated UCs, and UCs absent from every map. Broken references
   surface; the map can't silently disagree with the tree.
3. **Over-tooling / rebuilding Jira/Miro.** **Mitigation:** ship "a note that
   renders a grid of UC links" + a structured editor — no canvas, no swimlane
   styling, no WIP limits (§5; honors the V2 non-goals).
4. **Conflating map with PRD scope** ("isn't a slice just `scope_in`?"). No —
   `scope_in` is per-PRD set membership; a slice is a cross-PRD outcome band.
   **Mitigation:** separate artifacts; the map references PRDs/UCs rather than
   restating scope. State each fact once: problem/scope → PRD; sequence/slice →
   map; rules/examples → Example Map; behaviour → `.feature`.
5. **Conflating map with Example Map.** **Mitigation:** distinct `type:` values,
   distinct altitude, distinct unit (§3.3).
6. **AGPL contamination.** **Mitigation:** clean-room model only; never copy
   storymaps.io source. Formats aren't copyrightable; the model is reconstructed
   from the published schema.

---

## 8. Recommended sequencing

1. **Write & accept the ADR** — "Story Map as PRD-sibling overlay" (artifact
   model, parser-safe schema, single-source-of-truth rule). Hard-to-reverse →
   precedes implementation, per project discipline.
2. **Carve EPIC-017 stories** for the work (artifact + builder; grid editor;
   dangling-reference lint; optional interop), with acceptance criteria in the
   house format.
3. **Implement the vertical slice** mirroring PRD (domain → content → service →
   builder → explorer → dashboard projection → commands/ribbon → settings →
   events), each layer with the matching unit tests. UI: HTML-table grid +
   Feature-Editor-pattern detail editor.
4. **Extend the Guided Tour** with the story-map workflow.
5. **(Optional, later)** storymaps.io **YAML import/export** for interop — a
   `ReportParser`-style adapter, AGPL-safe because it only reads/writes the format.

**Estimated MVP** (artifact + builder + explorer + table grid + tests, no
optional interop, no UC back-link): a focused vertical slice on the PRD template.

---

## 9. Key sources

Tool: [storymaps.io repo](https://github.com/jackgleeson/storymaps.io) ·
[storymaps-cli](https://github.com/jackgleeson/storymaps-cli) · `LICENCE`
(AGPL-3.0-only) · `src/core/yjs.js`, `server.js` (server dependency) ·
`public/samples/coffee-ordering.json`, `src/core/serialization.js` (data model).
Methodology: Jeff Patton —
[The New Backlog](https://www.jpattonassociates.com/the-new-backlog/) /
[Story Mapping](https://www.jpattonassociates.com/story-mapping/) ·
[NN/g — Mapping User Stories in Agile](https://www.nngroup.com/articles/user-story-mapping/) ·
comparable models: [TextUSM](https://github.com/harehare/textusm),
[Featmap](https://github.com/amborle/featmap),
[aredridel/storymap](https://github.com/aredridel/storymap).
Internal: [ADR-0026](../adr/0026-prd-hierarchy-artifact-model.md),
[ADR-0012](../adr/0012-use-case-to-feature-is-one-to-many.md),
[EPIC-017](../issues/EPIC-017.md),
[V2 Research and Proposal](./2026-06-11%20V2%20Research%20and%20Proposal.md).
</content>
</invoke>
