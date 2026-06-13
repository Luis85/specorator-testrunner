---
type: adr
id: ADR-0026
status: accepted
title: PRD Hierarchy Artifact Model
date: 2026-06-13
related:
  - "[[0012-use-case-to-feature-is-one-to-many]]"
  - "[[0008-relative-vault-paths]]"
---

# PRD Hierarchy Artifact Model

There is a gap between **Domain research** and **Use Cases**. A research Domain is a bounded context the team investigates — market signals, competitor behaviour, user pain — and its output is findings, not commitments. A Use Case is a detailed, executable solution for a single capability (per ADR-0012, owning 0..N Feature Specifications). Nothing in between defines *which problem we are solving and how far that solution reaches*: the synthesis step that turns research into committed solution scope had no artifact, so scope lived implicitly inside Use Cases or informally in research notes.

This ADR introduces a three-layer artifact hierarchy — **Domain → PRD → Use Case** — and a **PRD** (Product Requirements Document) as the missing synthesis artifact. A PRD is *not* research: it states a problem and a bounded scope drawn from one or more research Domains, and it is the parent under which Use Cases hang. Research (Domains) and solution scope (PRDs) are kept as separate concerns rather than collapsed into one.

A PRD is a synthesis artifact: a **problem statement plus scope**, not a body of research. Each PRD is stored **one folder per PRD** on disk at `<prdsPath>/<id>-<slug>/<id>-<slug>.md` (relative vault paths, per ADR-0008), so each PRD owns a directory it can grow supporting notes into without colliding with siblings.

PRD ids are **immutable**: `PRD-NNN`, with `PRD-000` reserved for the **root product vision**. Sibling ordering is carried by a separate `display_order` frontmatter field — ids are **never** renamed to reorder, so cross-references stay stable. The root PRD is identified by an **empty `parent-prd:` field** (never the literal `null`); the read model normalizes the empty value to `undefined`. The `domains` field is **optional for the root PRD** and **required (1..N) for sub-PRDs**, since a sub-PRD's scope must trace to the research that motivates it while the root vision need not.

A Use Case links to **exactly one PRD** via a `prd-id` frontmatter field: the hierarchy is a **single-parent tree**, so a Use Case has one unambiguous home and every reference resolves to one place.

All PRD frontmatter uses **only parser-safe forms** — string scalars and block-sequence arrays, with **no inline arrays and no block scalars** — so the same lenient parser the rest of the vault relies on reads it without ambiguity.

## Considered alternatives

- **PRDs replace Domains.** Fold research and solution scope into one artifact. Rejected: research (a bounded context under investigation) and solution scope (a committed problem statement) are distinct concerns with different lifecycles; merging them loses the ability to revisit findings independently of the scope they motivated.
- **Multi-parent Use Cases.** Let a Use Case belong to several PRDs. Rejected: a single-parent tree keeps the hierarchy simple and every `prd-id` reference unambiguous; shared capability is expressed by scope wording, not by attaching one Use Case to many PRDs.

## Consequences

- Clear separation of **research vs. solution scope**: Domains stay the research layer, PRDs become the committed-scope layer, Use Cases stay the executable layer.
- The hierarchy is **navigable and references are stable**: immutable `PRD-NNN` ids with a separate `display_order` mean reordering siblings never rewrites cross-references.
- The root PRD is found by an empty `parent-prd:` (normalized to `undefined` by the read model), so there is one well-defined tree root (`PRD-000`).
- **Migration is needed for existing Use Cases**: they predate the PRD layer, so `prd-id` is **optional until backfilled**; once backfilling completes, `prd-id` can be tightened to required (mirroring the ADR-0012 path for `useCaseId`).
- `domains` is optional on the root PRD and required (1..N) on sub-PRDs, so every sub-PRD traces to the research that justifies it.
