# Design: Fallow integration — quality evidence for humans, CI, and agents

Date: 2026-06-11
Status: approved (design dialogue 2026-06-11)
Branch: `claude/fallow-agentic-integration-tqux2g`

## Context

The repo already has strong *correctness* tooling: eslint (including hand-rolled
hexagonal layer enforcement via per-layer `no-restricted-imports`), prettier,
vitest + coverage, typecheck, and a matrix CI. What it lacks is *quality
evidence*: deterministic answers to "what is dead?", "what is duplicated?",
"what got riskier in this PR?" — for maintainers and, increasingly, for coding
agents working in this repo, which today infer all of that from grep.

[fallow](https://github.com/fallow-rs/fallow) (`fallow@^2.93.0` on npm, MIT) is
a Rust-native static-analysis engine for JS/TS that provides exactly this:
dead-code/cleanup findings, duplication clone groups, complexity hotspots,
health scoring, and a changed-code `audit` with pass/warn/fail verdicts and
new-vs-inherited attribution. It ships agent-facing surfaces: a stdio MCP
server (`fallow-mcp`), a version-matched Agent Skill under
`node_modules/fallow/skills/fallow`, and machine-actionable JSON output
(`actions` arrays with `auto_fixable` flags).

Verified against the installed CLI (2.93.0), zero-config on this repo:

- Health score **87 (A)**; deductions dominated by unit size (the same five
  refactoring targets the V1 review already knew about, e.g.
  `validateCiReadiness`, `repairSutShape`).
- Real findings: 1 unused file (false positive — `scripts/e2e-smoke-entry.ts`
  is an esbuild entry), ~17 unused class members (mostly false positives —
  Obsidian framework-invoked overrides like `onChooseItem`, `hide`,
  `getState`), ~30 small clone groups (mostly the known modal/view repetition).

## Decisions

**Approach (approved):** full native integration — devDependency + repo-tuned
config + npm scripts + advisory CI job + MCP/Agent Skill. Alternatives
rejected: scripts-only (leaves the agentic goal unmet) and maximal adoption
with fallow's boundary presets + SARIF (duplicates the deliberate eslint layer
enforcement; two sources of truth for boundaries is a maintenance trap).

1. **Boundary rules stay off.** eslint's per-layer `no-restricted-imports`
   blocks remain the single authority for the hexagonal layering.
2. **CI is advisory.** The audit job can never fail the build; a follow-up may
   flip it to gating once signal quality is observed on a few PRs.
3. **No ADR.** Reversible, tactical tooling choice — AD-N territory at most.
4. **No paid runtime-intelligence features.**

## Part 1 — Local dev tooling

- `fallow` as devDependency (`^2.93.0`).
- `.fallowrc.jsonc` at the repo root:
  - `$schema` pointer for editor validation.
  - `entry`: add `scripts/e2e-smoke-entry.ts` (bundled by
    `scripts/e2e-smoke.mjs` via esbuild; auto-detection cannot see that).
  - `rules`: `"unused-class-members": "warn"` — Obsidian invokes lifecycle
    overrides (`onChooseItem`, `getItems`, `hide`, `getState`, …) so "unused"
    is structurally unreliable for this rule here; keep it visible, never
    verdict-driving.
- npm scripts (a `quality` namespace, mirroring the existing `test`/`lint`
  naming):
  - `quality` → `fallow` (full analysis: dead-code + dupes + health)
  - `quality:health` → `fallow health --score`
  - `quality:dead-code` → `fallow dead-code`
  - `quality:dupes` → `fallow dupes`
  - `quality:audit` → `fallow audit` (changed-code verdict vs. the merge-base
    against `origin/main` / upstream)

## Part 2 — Advisory CI audit

New independent `quality` job in `.github/workflows/ci.yml`:

- Ubuntu only, single Node version (22), no matrix — it is advisory evidence,
  not a correctness gate.
- `actions/checkout@v4` with `fetch-depth: 0` (audit needs the merge-base).
- `npm ci`, then `npx fallow audit --format markdown` appended to
  `$GITHUB_STEP_SUMMARY`; `FALLOW_AUDIT_BASE` pinned to the PR base ref when
  present.
- **Advisory mechanism:** `continue-on-error: true` on the audit step — a
  warn/fail verdict shows as a failed step annotation but the job (and the
  PR check) stays green.
- `tests/ci-workflow-content.test.ts` extended to cover the new job, keeping
  the repo's "CI content is tested" idiom.

## Part 3 — Agentic integration

- **MCP:** project-scope `.mcp.json` registering the stdio server:
  `{ "mcpServers": { "fallow": { "command": "npx", "args": ["fallow-mcp"] } } }`.
  Read-only analysis tools; version-matched to the installed devDependency.
- **Agent Skill:** `.claude/skills/fallow/SKILL.md` as a thin pointer skill —
  its body instructs the agent to read the version-matched
  `node_modules/fallow/skills/fallow/SKILL.md` (and `references/`). No copy of
  the upstream skill body, so it cannot drift from the installed CLI version.
- **AGENTS.md:** scaffolded via `fallow init --agents`, then adapted to this
  repo: point at CONTEXT.md for domain language, name the `quality:*` scripts,
  and state the two local caveats (Obsidian lifecycle members, esbuild script
  entries).
- **CONTRIBUTING.md:** short "Quality evidence" section — when to run which
  command (notably `npm run quality:audit` before requesting review).
- **CHANGELOG.md:** entry under Unreleased.

## Out of scope / unchanged

No gating, no eslint/prettier/vitest changes, no fallow boundary or
feature-sliced presets, no SARIF upload, no git hooks (`fallow init --hooks`),
no runtime coverage. The pre-existing findings (clone groups, hotspots) are
*reported*, not fixed, in this change.

## Acceptance

1. `npm run quality` and `npm run quality:audit` run locally; the
   `scripts/e2e-smoke-entry.ts` unused-file false positive is gone.
2. CI on this branch's PR shows the advisory `quality` job green with the
   audit verdict in the job summary.
3. `npx fallow-mcp` starts and speaks MCP on stdio (registered via `.mcp.json`).
4. Existing suite stays green: lint, format:check, typecheck, vitest
   (including the extended `ci-workflow-content` test).
