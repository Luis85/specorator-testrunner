---
id: EPIC-015
type: epic
title: Audit-Grade Evidence & Release Readiness
status: proposed
priority: P1
stories:
  - "[[US-060]]"
  - "[[US-061]]"
  - "[[US-062]]"
  - "[[US-063]]"
  - "[[US-064]]"
  - "[[US-065]]"
  - "[[US-066]]"
use-cases:
  - "[[UC-030]]"
  - "[[UC-031]]"
  - "[[UC-032]]"
  - "[[UC-033]]"
---

# EPIC-015 Audit-Grade Evidence & Release Readiness

> Evidence grows from "links + counts" into the compliance and client-report
> backbone. Auditors accept git/Markdown evidence **iff** it carries
> timestamps, commit SHA, environment, and approver identity (FDA CSA, IEC
> 62304, SOC 2 evidence research).

Proposed in the [V2 Research and Proposal](../proposals/2026-06-11%20V2%20Research%20and%20Proposal.md) §6 — *P1*.

## Outcome

Evidence and traceability are the monetizable job (proposal §5.2, bet 2):
compliance regimes want requirement→test→result chains with timestamps,
commit hashes, environments, and named approvers, and agencies pay up to
$399/mo elsewhere for client-facing test reports and UAT sign-off documents.
No local-first tool serves either need. This epic upgrades Evidence notes to
regulator-grade records, derives a traceability matrix and a GO/NO-GO
readiness verdict from the vault's links, makes sign-off a durable note
instead of an email, and packages everything as client reports and audit
bundles — while finally implementing the dead `evidenceRetentionDays`
setting so the vault doesn't grow forever.

## Stories

| Story | Title | Priority | Increment |
| --- | --- | --- | --- |
| [[US-060]] | Audit-grade evidence stamps | P1 | V2.0 |
| [[US-061]] | Traceability matrix note | P1 | V2.1 |
| [[US-062]] | Release readiness (GO/NO-GO) | P1 | V2.1 |
| [[US-063]] | Release sign-off note | P1 | V2.1 |
| [[US-064]] | Client/stakeholder report export | P1 | V2.1 |
| [[US-065]] | Audit export bundle | P1 | V2.1 |
| [[US-066]] | Evidence retention sweep | P1 | V2.1 |

## Use cases

- [[UC-030]] — Generate the traceability matrix
- [[UC-031]] — Evaluate release readiness and record sign-off
- [[UC-032]] — Export a client-facing test report
- [[UC-033]] — Assemble an audit evidence bundle

## Dependencies & sequencing

- [[US-060]] (stamps) lands in V2.0 alongside the migrated report pipeline;
  the rest follows in V2.1.
- The matrix's latest-result column and the readiness verdict consume
  per-scenario history and the quarantine signal ([[US-057]]/[[US-058]],
  [[EPIC-014]]).
- Pre-V2 groundwork it assumes (§9): per-note write serialization (1.1 —
  evidence stamps and sign-off links add concurrent Use Case note writers).
- The existing redaction posture (ADR-0014 research, credential redaction)
  must hold across every new surface: stamps, exports, bundles.

## Definition of done

- Evidence stamps render in frontmatter (machine-readable, Bases-queryable
  per [[US-076]]) and body (human-readable); git absence degrades
  gracefully; secrets never appear.
- Matrix and readiness artifacts are derived purely from links/frontmatter,
  regenerate idempotently, and every number drills down to its scenarios.
- Sign-off notes carry scope, verdict snapshot, deferred defects, named
  approver, decision, and timestamp; git history is the audit trail.
- Exports are self-contained (no Obsidian needed to read them) and live
  under `Test Evidence/exports/`; audit bundles carry an index with hashes.
- Retention sweep is explicit, dry-runnable, emits the reserved
  `evidence.swept` event, and never touches exports or signed-off releases.
- All seven stories accepted; Guided Tour (ADR-0020) extended for the
  readiness/sign-off workflow.
