# PRD Creator System Design

**Date:** 2026-06-13  
**Status:** Approved for implementation  
**Author:** Brainstorming session with Luis85  

---

## 1. Overview

This design adds a hierarchical **Product Requirements Document (PRD)** system to Specorator Testrunner. PRDs sit above Use Cases as synthesis artifacts that define solution scope, drawing from domain research.

### Problem Statement

Currently, Specorator has:
- **Domains:** Bounded contexts for research/discovery (PM/UX space)
- **Use Cases:** Detailed solution implementation

**Gap:** No layer to synthesize domain research into solution scope. Teams lack a way to:
- Articulate the problems they're solving (from domain research)
- Define what's in/out of scope before building Use Cases
- Organize Use Cases hierarchically around feature areas
- Trace the path from research → problem definition → solution

### Solution

Introduce **PRDs as synthesis artifacts**:
- **PRD 0:** System-level product vision (top-level)
- **Sub-PRDs:** Feature/capability areas derived from domain research
- **Use Cases:** Detailed implementation of each PRD

**Key principle:** Domains (research-agnostic) and PRDs (solution-focused) remain separated and complementary.

---

## 2. Architecture & Data Model

### 2.1 Three-Layer Structure

```
Domain (research/problem space)
  ↓ [informs]
PRD (problem definition + solution scope)
  ↓ [decomposes into]
Use Case (solution detail)
```

**Invariants:**
- Use Case has exactly one parent PRD (`prd-id` field)
- Use Case retains its `domain` (research context)
- Sub-PRDs reference 1..N domains (cross-cutting concerns allowed); root PRD (`parent-prd: null`) has optional domains (0..N)
- PRD tree is single-parent (each sub-PRD has one parent; PRD-000 is root)
- PRD IDs are immutable; display order managed via `display_order` frontmatter field

### 2.2 PRD Frontmatter Schema

```yaml
id: PRD-001
type: prd
title: "Dashboard & KPI Tracking"
status: draft | active | deprecated
parent-prd: PRD-000  # null for PRD-000 (root)
domains: [dashboard, reporting]  # which domain research informs this (optional for root PRD)
vision: "Single source of truth for test health"
scope_in: [KPI tiles, recent runs, 7-day trend]  # what's included
scope_out: [historical analytics, custom exports]  # what's excluded
research-notes: []  # Reserved for V2: link to domain artifacts
display_order: 1  # for sibling ordering in tree (optional; auto-assigned if omitted)
```

Required fields: `id`, `type`, `title`, `status`, `parent-prd`, `vision`, `scope_in`, `scope_out`.  
Optional fields: `domains` (required for sub-PRDs, optional for root), `research-notes`, `display_order`.  
**Note on scope:** Scope is stored as two array fields (`scope_in`, `scope_out`) instead of block scalar to remain parseable by the shared frontmatter parser (which supports scalars/arrays only, not block scalars).  
**Note:** Root PRD (`parent-prd: null`) has `domains: []` or omitted (no domains apply to system-level vision).

**Backwards compatibility:** Existing Use Cases lack `prd-id` field until migration runs. Validation must treat `prd-id` as optional until per-vault backfill completes; enforce only after migration assigns a PRD to all Use Cases.

### 2.3 Use Case Updates

Existing Use Cases gain one new frontmatter field:

```yaml
prd-id: PRD-001  # Required; links UC to its parent PRD
```

The existing `domain` field is retained (not replaced).

### 2.4 File Structure

All artifact paths respect Vault settings (prdsPath, domainsPath, useCasesPath, etc.). Default configuration shown below:

```
PRDs folder (defaults to "PRDs", configurable via settings.paths.prdsPath)
├── PRD-000-product-vision/
│   └── PRD-000-product-vision.md
├── PRD-001-dashboard/
│   ├── PRD-001-dashboard.md
│   └── (future: diagrams, related docs)
├── PRD-002-evidence/
│   └── PRD-002-evidence.md
└── PRD-003-ci-integration/
    └── PRD-003-ci-integration.md

Use Cases folder (existing; configurable via settings.paths.useCasesPath)
├── UC-001.md  # References prd-id: PRD-001
└── UC-002.md

Domains folder (existing research space; configurable via settings.paths.domainsPath; default: "Domains")
├── Dashboard/
│   ├── research.md
│   └── ...
└── Evidence/
    └── ...
```

**Path Configuration:** 
- **PRDs:** `settings.paths.prdsPath` (default: `"PRDs"`)
- **Domains:** `settings.paths.domainsPath` (default: `"Domains"`)
- Both follow the same pattern as useCasesPath, specificationsPath, etc., allowing users to customize artifact locations via settings. Each domain gets its own folder under the domains path (e.g., `Domains/Dashboard/`, `Domains/Evidence/`).

**Naming convention:** `PRD-NNN-slug` (kebab-case). `PRD-000` reserved for product vision (canonical root ID).

### 2.5 PRD Markdown Sections

All PRD markdown includes these standard sections (flexible content):

```markdown
# PRD-001: Dashboard & KPI Tracking

## Executive Summary
[What problem are we solving? Why now?]

## Research Summary
[Key findings from domain research that led to this PRD]

## Scope
- **In:**
  - KPI tiles showing pass/fail rates
  - Recent test runs (last 7 days)
- **Out:**
  - Historical analytics beyond 7 days
  - Custom export formats

## Success Criteria
1. Dashboard loads in <2s
2. KPI data updates within 5s of run completion
3. Non-technical users can interpret KPIs without documentation

## Key Constraints
- Obsidian API limits realtime subscriptions

## Sub-PRDs
- (if this is PRD-0 or a parent PRD, list children)

## Related Use Cases
- UC-009: View Dashboard
- UC-010: Interpret KPI metrics
```

The "Research Summary" section is the synthesis artifact — it shows why this PRD exists (what problems, what assumptions).

---

## 3. PRD Builder Workflow

The **PRD Builder** is a multi-step modal that guides users through PRD creation, ensuring alignment with domain research and scope clarity.

### Step 1: Identify Problem & Domain(s)

**Goal:** Establish which research contexts inform this PRD.

- **Input:** User selects one or more domains from a dropdown, or adds new domain values via free text
- **Domain source:** Options derived from the `domain` field in existing Use Cases (all domains referenced by any UC become available options). User can also type a new domain name to create one not yet in Use Cases.
  - **Implementation note:** `DefaultUseCaseService.parse()` does not currently expose `domain` field. Implementation must either (a) add `domain` to the UC read model, or (b) use a separate frontmatter scan to derive available domains. See domain population section below.
- **UI:** Multi-select dropdown with domain titles (shows UC count per domain) + "Add new domain" text input field
- **Guidance:** "Which research spaces inform this solution? Select existing domains or type new ones. Cross-domain PRDs are OK (e.g., a new Dashboard feature might draw from Dashboard + KPI domains)."
- **Output:** Populates `domains: [...]` frontmatter field with both selected and newly created domain names

### Step 2: Research Summary

**Goal:** Synthesize the problem from domain research.

- **Input:** Free-text editor (or in V2, link to domain research artifacts)
- **Content:** Key findings, validated assumptions, why we're solving this now
- **UI:** Large text area with placeholder:
  ```
  E.g., "Domain research revealed that 60% of users 
  can't quickly assess test health. They need a 
  single view showing pass rates and recent trends."
  ```
- **Guidance:** "Summarize the problem: What did we learn from the research? What are we assuming?"
- **Output:** Populates markdown "Research Summary" section

### Step 3: Define Vision

**Goal:** Articulate the desired future state.

- **Input:** Single-line vision statement
- **UI:** Text input
- **Placeholder:** "Single source of truth for test health"
- **Guidance:** "Keep it concise: what's the benefit to the user?"
- **Output:** Populates `vision` frontmatter field

### Step 4: Scope (In/Out)

**Goal:** Set boundaries for this PRD.

- **Input:** Two-column editor (In | Out)
- **UI:** Side-by-side text areas, each accepts bullet list or free text
- **Guidance:** "Be explicit about what you're NOT solving. This keeps the PRD focused and helps prevent scope creep."
- **Output:** Populates `scope_in` and `scope_out` frontmatter fields (as arrays) + markdown "Scope" section

### Step 5: Success Criteria

**Goal:** Define measurable outcomes.

- **Input:** User enters 3–5 criteria (one per line)
- **UI:** Textarea or structured input (add/remove rows)
- **Guidance:** "How will we measure if this PRD shipped successfully? Examples: load time <2s, 90% test pass rate, onboarding <5 min"
- **Output:** Populates markdown "Success Criteria" section

### Step 6: Assign Use Cases (Optional)

**Goal:** Link existing Use Cases to this PRD (for existing PRDs with existing UCs).

- **Input:** Checkbox list of existing Use Cases, filtered by the domains selected in Step 1
- **UI:** Checkbox list with UC titles; count shown
- **Guidance:** "Which existing Use Cases implement this PRD? Leave empty if this is a new PRD with UCs to be written."
- **Note:** This step can be skipped; UCs can be linked later via Use Case editor
- **Output:** Update each selected UC's `prd-id: PRD-NNN` frontmatter

### Step 7: Review & Create

**Goal:** Finalize PRD details and write the file.

- **Input:** 
  - PRD title (auto-filled from vision or user override)
  - Parent PRD (dropdown; defaults to PRD-000 for new top-level PRDs)
  - Status (draft | active | deprecated)
  - Slug (auto-generated from title, user can edit)
- **UI:** Form with preview of final markdown
- **Guidance:** "Review the PRD structure below. Adjust title or status if needed."
- **Output:** 
  - Create folder `docs/prds/PRD-NNN-slug/`
  - Write `docs/prds/PRD-NNN-slug/PRD-NNN-slug.md`
  - Update all linked Use Cases' `prd-id` field
  - Emit domain event: `prd.created` with payload `{ prd-id, parent-prd, uc-count }`

---

## 4. UI Integration in Test Hub

The PRD system surfaces at three entry points (explorer, dashboard, modal), supporting multiple workflows.

### 4.1 PRD Explorer View

**Location:** Sidebar panel (alongside Use Case explorer)

**Content:**
- Hierarchical tree: PRD-0 at root, sub-PRDs as collapsible children
- Each node shows: PRD title + badge (UC count)
- Indentation indicates hierarchy depth

**Interactions:**
- **Click node:** Open PRD detail view (show title, domains, vision, scope, research summary, linked UCs)
- **Right-click node:** Context menu
  - "Create sub-PRD" → open builder with `parent-prd` pre-filled
  - "Edit" → open builder with existing fields populated
  - "Delete" (if no child PRDs or UCs) → confirm + delete folder
  - "Open in file explorer" → reveal folder in OS file system
- **Drag-to-reorder:** Reorder sub-PRDs within same parent (maintains immutable PRD-NNN IDs; updates `display_order` frontmatter field for tree rendering)
- **Search:** Filter PRDs by title or domain (e.g., search "dashboard" shows all PRDs tagged with dashboard domain)

**Tree example:**
```
PRD-0: Specorator Testrunner (P)
├── PRD-1: Dashboard & KPI (9 UCs)
├── PRD-2: Evidence Reporting (5 UCs)
├── PRD-3: CI/CD Integration (3 UCs)
└── PRD-4: Step Definition Authoring (4 UCs)
```

### 4.2 Dashboard Integration

**Location:** New "PRD & Roadmap" section on Dashboard (below KPI tiles)

**Content:**
- **PRD 0 summary card:**
  - Title: "Specorator Testrunner"
  - Vision excerpt (first 100 chars)
  - Stats: "4 sub-PRDs, 21 Use Cases"
  - Status badge (Draft | Active | Deprecated)
- **Sub-PRD list** (next level children of PRD-0):
  - Show each with title, UC count, status
  - Example: "PRD-1: Dashboard & KPI (9 UCs) — Active"

**Actions:**
- **"New PRD"** → opens builder modal (parent-prd auto-set if in PRD context)
- **"View PRD Tree"** → focuses PRD explorer (can also use keyboard shortcut)
- **"Manage Domains"** → opens Domain explorer (research context)

### 4.3 PRD Builder Modal

**Trigger points:**
- Dashboard "New PRD" button
- PRD Explorer right-click → "Create PRD"
- Command palette: `PRD: Create` or `PRD: Edit`

**Behavior:**
- Full-screen modal (or large dialog, depending on Obsidian constraints)
- 7-step wizard with progress indicator (Step 1 of 7, etc.)
- Back/Next navigation (can skip Step 6 if no existing UCs to assign)
- Cancel button; warn if unsaved changes

**On completion:**
- Close modal
- Focus PRD explorer on the newly created PRD
- Show toast: "PRD created: PRD-001 Dashboard"

### 4.4 Use Case Detail View Integration

**Change:** Add PRD breadcrumb at top of Use Case detail.

```
Domain: Dashboard  >  PRD-001: Dashboard & KPI
```

**Interactions:**
- Click "PRD-001" → navigate to PRD detail view
- Hover shows full PRD title + status

---

## 5. Migration Strategy

Transition existing artifacts into the PRD system with semi-automated analysis + manual refinement.

### Phase 1: Analyze Existing Structure (Automated)

**Script:** `scripts/analyze-uc-domains.mjs`

```bash
npm run migrate:analyze-domains
```

**What it does:**
- Reads all Use Cases from the configured `useCasesPath` (default: `"Use Cases"`, respects `settings.paths.useCasesPath`)
- Groups by `domain` field
- Outputs a report (console + file)
- Example:
  ```
  Dashboard: UC-009, UC-010, UC-015, UC-019 (4 UCs)
  Evidence: UC-008, UC-016, UC-017 (3 UCs)
  Specification: UC-003, UC-004, UC-005, UC-006 (4 UCs)
  Installation: UC-001, UC-002, UC-007 (3 UCs)
  [... 9 more domains, 37 total UCs]
  ```

**Output:** `docs/migration-report-domains.md` (human-readable)

### Phase 2: Propose PRD Decomposition (Manual)

**User action:** Review the domain groupings and decide:
- Does each domain map to one PRD? (typical case)
- Do multiple domains group into one PRD? (cross-cutting)
- Does a domain split into multiple PRDs? (rare)

**Guidance document provided:** `docs/prds/HOW-TO-DECOMPOSE.md` with:
- Principles for PRD scoping
- Examples from Specorator (Dashboard, Evidence, etc.)
- Template: "My decomposition plan"

**User documents their decision** in a checklist (e.g., "Dashboard + KPI domains → PRD-001", "Evidence domain → PRD-002", etc.)

### Phase 3: Create PRD-0 (System Vision)

**Script:** `scripts/migrate-prd-0.mjs`

```bash
npm run migrate:create-prd-0
```

**What it does:**
- **Backup original first:** Copies `docs/Specorator Testrunner.md` → `docs/Specorator Testrunner.md.backup` (before any rewrites)
- Creates `<prds-path>/PRD-000-product-vision/PRD-000-product-vision.md` (respects `settings.paths.prdsPath`)
- Copies content from `docs/Specorator Testrunner.md` and adjusts frontmatter:
  ```yaml
  id: PRD-000
  type: prd
  title: "Specorator Testrunner"
  status: active
  parent-prd: null
  domains: []  # root PRD may omit or leave empty
  vision: "Enable teams to transform requirements into executable specifications..."
  scope_in: "[from current PRD section]"  # list of included features
  scope_out: "[from current PRD section]"  # list of excluded features
  display_order: 0  # root always first
  ```
- **Preserves backlinks:** Keeps original `docs/Specorator Testrunner.md` as a redirect note with Obsidian alias:
  ```yaml
  ---
  aliases: [PRD-000-product-vision]
  ---
  # Moved to PRD-000
  See [[PRD-000-product-vision/PRD-000-product-vision|PRD-000: Specorator Testrunner]]
  ```
  This preserves existing `[[Specorator Testrunner]]` links in architecture docs and ADRs.
- Outputs: "PRD-000 created; backup saved at `docs/Specorator Testrunner.md.backup`; redirect note created at `docs/Specorator Testrunner.md`"

**Why:** 
- Obsidian link resolution supports aliases, so existing `[[Specorator Testrunner]]` references in ADRs and architecture docs continue to work through the alias
- Backup created first ensures rollback is always possible if migration fails partway through

### Phase 4: Create Sub-PRDs

**Script/UI:** Interactive script OR use PRD Builder modal

**Option A (Scripted, faster):**
```bash
npm run migrate:create-sub-prds
```
User provides a migration plan file (YAML or JSON listing domain → PRD mappings), script creates folder structure and scaffolds PRD files.

**Option B (UI-driven, more guidance):**
User opens PRD Builder modal repeatedly, creates each sub-PRD manually (more time, but better familiarity with the tool).

**Result:** 5–8 sub-PRDs created with frontmatter and basic markdown skeleton. User can edit in the PRD Builder or directly in markdown.

### Phase 5: Link Use Cases to PRDs

**Script:** `scripts/link-uc-to-prds.mjs`

```bash
npm run migrate:link-ucs-to-prds
```

**What it does:**
- Iterates through all Use Cases
- For each UC, prompts:
  ```
  UC-001: Initialize Test Hub (domain: Installation)
  Which PRD does this belong to?
  1. PRD-000 (Specorator Testrunner)
  2. PRD-001 (Installation & Setup)
  3. [Skip, decide manually later]
  ```
- User selects PRD → script adds `prd-id: PRD-NNN` to UC frontmatter
- Outputs a final report:
  ```
  Linked 37 UCs to PRDs:
    PRD-001: 9 UCs
    PRD-002: 5 UCs
    ...
  Orphaned: 0 UCs (all assigned)
  ```

### Timeline

- **Phase 1:** ~5 min (automated)
- **Phase 2:** ~1–2 hours (manual review, one-time)
- **Phase 3:** ~5 min (automated)
- **Phase 4:** ~30 min (scripted or modal-driven)
- **Phase 5:** ~30 min (interactive script, with user prompts)
- **Total:** ~2.5–3 hours (one-time effort)

### Rollback

If the migration goes wrong:
- Restore `docs/Specorator Testrunner.md.backup` → `docs/Specorator Testrunner.md`
- Delete `docs/prds/` folder
- Restore Use Cases from git (no `prd-id` field)
- Restart migration

---

## 6. Evolution Path (V2+)

This design supports a progression toward richer traceability and visualization.

### V1.5 (Next minor release)

**Domain Research Artifacts Linking:**
- Add optional `research-notes: ["domain/dashboard/research.md"]` field to PRD frontmatter
- PRD detail view surfaces linked research as markdown embeds or links
- Builder Step 2 updated: "Link domain research artifacts" (not just free text synthesis)

**Outcome:** Explicit, traceable path from domain research → PRD synthesis.

### V2 (Major release, future)

**Research-to-Solution View:**
- New "Lineage" view showing full traceability graph:
  ```
  Dashboard domain (research)
    ↓ [informs]
  PRD-001: Dashboard & KPI (problem + scope)
    ↓ [decomposes into]
  UC-009, UC-010, UC-015, UC-019 (solution detail)
  ```
- Visualization: Mermaid flowchart or Obsidian graph view integration
- Dashboard enhancement: "Research Gaps" widget highlighting unmapped domains

**Coverage Metrics:**
- "Which domains have PRDs synthesizing from them?"
- "Which PRDs have all Use Cases implemented?"
- Dashboard KPI: "Research Coverage (%)" and "Solution Coverage (%)"

**Outcome:** Full traceability end-to-end, with visibility into completeness.

### V2.5+ (Future)

**Cross-PRD Dependencies:**
- Allow PRDs to reference other PRDs (e.g., "PRD-3 depends on PRD-1")
- Visualization in Lineage view (show dependency edges)
- Validation: warn if circular dependencies detected

**Integration with Epics/Stories:**
- Link PRDs to existing Epics/Features in `docs/issues/`
- Unified roadmap view: PRD tree + Epic hierarchy

---

## 7. Testing & Validation

### Unit Tests

- **Frontmatter validation:** PRD frontmatter passes schema (required fields, valid enums for status)
- **File structure:** PRD folder creation follows naming convention
- **Relationship integrity:** Use Case `prd-id` references an existing PRD

### Integration Tests

- **Builder workflow:** 7-step wizard successfully creates PRD file and updates linked UCs
- **Explorer rendering:** PRD tree renders correctly (parent-child relationships, UC counts)
- **Migration scripts:** Phase 1–5 migrations run without data loss; Use Cases linked correctly

### Manual Validation Checklist

- [ ] PRD Explorer shows PRD-0 and sub-PRDs in correct hierarchy
- [ ] Clicking PRD in explorer shows detail view with correct domains, vision, scope
- [ ] Creating a new PRD via builder creates file + folder in correct location
- [ ] Assigning Use Cases to PRD updates UC frontmatter with `prd-id`
- [ ] Use Case detail breadcrumb shows correct PRD link
- [ ] Dashboard shows PRD-0 summary + sub-PRD list
- [ ] Migration scripts run without errors; all 37 existing UCs linked to PRDs
- [ ] Backward compatibility: existing Use Cases still render correctly with new `prd-id` field

---

## 8. Implementation Order

1. **Data model & schemas** (frontmatter, validation)
2. **File structure** (folder creation, naming)
3. **PRD Builder** (7-step wizard, modal)
4. **PRD Explorer** (tree rendering, interactions)
5. **Dashboard integration** (PRD summary card)
6. **Use Case integration** (breadcrumb link)
7. **Migration scripts** (Phases 1–5)
8. **Tests** (unit, integration, manual validation)

---

## 9. Success Criteria

- PRD Creator is usable without documentation (builder guides the workflow)
- All 37 existing Use Cases are linked to PRDs after migration
- New PRDs can be created and edited via builder or markdown
- PRD hierarchy is clear in explorer and dashboard
- Evolution path (V1.5, V2) is feasible without rework

---

## 10. Design Decisions & Implementation Notes

**Slug generation (DECIDED):**
PRD slugs are auto-generated from title (title → kebab-case) with optional user override in Step 7. This prevents collisions while allowing customization.

**PRD numbering (DECIDED):**
PRD IDs are auto-incremented (`PRD-001`, `PRD-002`, etc.) by scanning existing PRD files and incrementing the highest ID found. PRD-000 is reserved for system vision. User cannot manually assign IDs to prevent collisions.

**Domain vs. PRD alignment (DECIDED):**
If a Use Case's `domain` doesn't match any domain in its PRD's `domains` list, the PRD detail view shows a warning badge: "Misaligned domain metadata". This signals potential scope issues without blocking linking. User can edit either field to align.

**Research artifacts storage (DEFERRED to V1.5):**
V1 uses free-text synthesis in the "Research Summary" section. In V1.5, add optional `research-notes: []` field linking to `docs/domains/<domain-name>/research.md` files. Storage location TBD in V1.5 design.

---

## 11. Required Documentation Updates (Before Implementation)

This design introduces architecture-shaping decisions and new product terminology. Per project standards, implementation must include:

1. **ADR (Architectural Decision Record):** Create `docs/adr/NNNN-prd-hierarchy-artifact-model.md` documenting:
   - Why PRDs are needed (separate from Use Cases)
   - Three-layer model: Domain → PRD → Use Case
   - Why PRD IDs are immutable
   - Why domains are optional for root PRD

2. **CONTEXT.md Glossary Updates:** Add entries for:
   - **PRD (Product Requirements Document):** A synthesis artifact that defines solution scope, drawing from domain research. Each PRD owns 0..N Use Cases. Distinct from "PRD" in other contexts.
   - **parent-prd:** The parent PRD of a sub-PRD or Use Case. Null for PRD-000 (root).
   - **prd-id:** Frontmatter field linking a Use Case to its parent PRD (immutable once assigned).
   - **Domain:** Research/discovery context (solution-agnostic). Separate from PRD.
   - **display_order:** Frontmatter field managing sibling PRD ordering without mutating immutable IDs.

These updates ensure the design is formally recorded and product language is consistent across the codebase.

