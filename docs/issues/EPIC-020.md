---
id: EPIC-020
type: epic
title: Trust, Security & CI Depth
status: proposed
priority: P2-P3
stories:
  - "[[US-084]]"
  - "[[US-085]]"
  - "[[US-086]]"
  - "[[US-087]]"
  - "[[US-088]]"
---

# EPIC-020 Trust, Security & CI Depth

> Deepen the security posture and CI generation: credentials out of
> plaintext, session reuse, sharded and multi-environment pipelines, and a
> second pipeline provider.

Proposed in the [V2 Research and Proposal](../proposals/2026-06-11%20V2%20Research%20and%20Proposal.md) §6 — *P2–P3*.

## Outcome

Trust is the moat's load-bearing wall: a synced vault with plaintext
credentials in `data.json` is a leak waiting to happen, and V1's
GitHub-only, single-environment, unsharded CI generation caps suite scale.
This epic moves credentials into the OS keychain (Electron `safeStorage`),
cuts suite time with Playwright `storageState` session reuse and sharded
workflows with blob-report merge, runs suites across multiple named
Environments in one CI run, and adds GitLab CI as a second provider behind
the existing seam — all while keeping the generated pipelines inside the
established command-safety and YAML screening posture.

## Stories

| Story | Title | Priority | Increment |
| --- | --- | --- | --- |
| [[US-084]] | Credential storage upgrade | P2 | V2.1 |
| [[US-085]] | Session/auth reuse (storageState) | P2 | V2.1 |
| [[US-086]] | Sharded CI generation | P2 | V2.1 |
| [[US-087]] | Multi-environment CI matrix | P3 | V2.x |
| [[US-088]] | GitLab CI provider | P3 | V2.x |

## Dependencies & sequencing

- [[US-085]] and [[US-086]] assume the native runner ([[US-051]],
  [[EPIC-013]]): `storageState` setup projects and blob-report merge are
  `@playwright/test` capabilities.
- Pre-V2 groundwork it assumes (§9): settings scalar repair extended to
  `ci.*`/`automation.*` (1.4) and SHA-pinned release actions (0.3); the
  per-OS browser caching from 0.2 carries into the generated sharded
  workflow.
- [[US-084]] requires a new ADR superseding AD-9 (env-var transport per
  ADR-0014 stays; only storage at rest changes).

## Definition of done

- New credential-storage ADR accepted; migration is consensual and
  transparent; documented fallback where the keychain is unavailable;
  export/repair never prints values.
- Storage state files are git-ignored and excluded from evidence.
- Generated workflows (GitHub sharded/multi-env, GitLab) pass the same
  command-safety and YAML screening as the existing template; CI readiness
  checks validate each variant per provider.
- Results import and evidence stay attributable per environment and per
  shard; all five stories accepted.
