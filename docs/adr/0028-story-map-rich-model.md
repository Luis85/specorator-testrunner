---
type: adr
id: ADR-0028
status: accepted
title: Story Map Rich Model (single-user, vault-local parity)
date: 2026-06-19
related:
  - "[[0027-story-map-prd-sibling-overlay]]"
  - "[[0026-prd-hierarchy-artifact-model]]"
---

# Story Map Rich Model (single-user, vault-local parity)

ADR-0027 introduced a minimal Story Map: a backbone of `activities`, a set of `slices`, and `cards` that were nothing but a `UC-NNN` reference at an (activity, slice) coordinate. To bring the artifact to **modeling parity with storymaps.io** — while staying **fully vault-local and single-user (no interop, no collaboration, no server/canvas)** — this ADR extends the model with the storymaps.io structure that is meaningful inside an Obsidian vault.

The expanded model adds three things:

1. **Users/personas** — a top lane of audience labels (`users`), the "who" of the journey. A flat ordered list of strings.
2. **Steps** — the task level **between an activity and a card** (storymaps.io's Activity → Step → Story). A step belongs to exactly one activity; encoded parser-safely as a `"activity | step"` string in an ordered `steps` block sequence. Steps are optional — a card may sit directly under an activity with no step.
3. **Rich cards** — a card keeps its **optional `UC-NNN` reference** (so the single-source-of-truth rule of ADR-0027 still holds for *referenced* Use Cases) but also carries **map-owned planning attributes** that do **not** duplicate the Use Case: a free-text **title**, a **planning status**, **story points**, **tags**, and a **color**. A card may also be **reference-less** (a free-text story not yet promoted to a Use Case), which storymaps.io allows and which discovery needs.

**Planning status is not automation status.** A card's status is one of `planned | in-progress | done | blocked` — a *planning* state the team sets by hand. It is deliberately distinct from a Use Case's **automation** status (passing/failing, derived from test runs, ADR-0017/US-057). They are different axes — a card can be `planned` while its Use Case has no automation yet — so the map owning a planning status does **not** duplicate the Use Case rollup (it would only duplicate if it mirrored automation, which it does not).

## Encoding (parser-safe, ADR-0026/0027 rules preserved)

Frontmatter still uses **only string scalars and block-sequence arrays**. The richer card is a single **positional, pipe-delimited string scalar** with nine fields:

```
ref | activity | step | slice | status | points | tags | color | title
```

- `ref` — `UC-NNN` or empty (a reference-less card).
- `step` — empty when the card hangs directly under the activity.
- `status` — empty or one of the four planning statuses.
- `points` — empty or a non-negative integer.
- `tags` — comma-separated, or empty.
- `color` — empty or a short token/hex.
- `title` — free text; the **last** field so it may contain anything except `|` and newlines (both stripped on input, as labels already are).

**Backward compatibility:** a legacy three-field card `ref | activity | slice` (ADR-0027) still parses — three fields are read as `(ref, activity, slice)` with no step/attributes — so existing Story Map notes keep working without migration.

`users`, `activities`, `slices`, and `steps` (each `"activity | step"`) remain flat block sequences of string scalars — Bases-queryable, parser-safe.

## Rendering

The note body's managed grid block renders **per activity**: each activity is a sub-section with a slices × steps table (a column per step, or a single column when the activity has no steps), cells listing their cards as `title` plus a resolved `[[note\|UC-NNN]]` link when referenced, with status/points/tags shown inline. A **points roll-up per slice** and a **status/color legend** are rendered alongside. This keeps a readable Markdown rendering without a canvas (the V2 "no visual/drag-drop builder" non-goal stands; authoring is by editing the parser-safe `cards` list and rebuilding).

## Considered alternatives

- **Rich card data as a JSON block in the body.** Cleaner for free text, but drops the parser-safe, Bases-queryable frontmatter the rest of the vault relies on, and diverges from ADR-0026/0027. Rejected: the positional string keeps cards in queryable frontmatter.
- **Cards own automation status too.** Rejected: that would duplicate the Use Case's run-derived rollup (ADR-0017/US-057) — the one thing ADR-0027 forbids. Planning status is a separate, map-owned axis.
- **Interop/import-export and real-time collaboration.** Explicitly out of scope per the product owner: the artifact is vault-local and single-user. storymaps.io's server, Yjs collaboration, and JSON/YAML/CSV interchange are not implemented.

## Consequences

- Story Maps reach storymaps.io **modeling** parity (users, steps, rich cards, points, legend) while staying Markdown-native, local-first, and single-user.
- `prd-id` and Use Case content stay the source of truth for *referenced* Use Cases; the map adds only planning facts (sequence, slices, steps, planning status, points, tags, color, and free-text titles for not-yet-promoted stories).
- Existing minimal Story Map notes parse unchanged (three-field cards remain valid).
- The grid renders per-activity sub-tables with a points roll-up and legend; authoring remains edit-frontmatter-then-rebuild (no canvas).
