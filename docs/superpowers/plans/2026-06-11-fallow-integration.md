# Fallow Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or implement directly in-session for a change this size) task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate fallow (deterministic JS/TS codebase intelligence) as (1) local dev tooling — devDependency, repo-tuned `.fallowrc.jsonc`, `quality:*` npm scripts; (2) an advisory `quality` audit job in CI; (3) agent-facing surfaces — `.mcp.json` MCP server, a pointer Agent Skill, `AGENTS.md`, and CONTRIBUTING guidance.

**Spec:** `docs/superpowers/specs/2026-06-11-fallow-integration-design.md`

**Conventions you must follow (this codebase):**
- Comments explain constraints/why, not what. Match the existing density.
- CI workflow content is asserted by `tests/ci-workflow-content.test.ts` — extend it for any `ci.yml` change.
- Run `npm run lint && npm run format:check && npm run typecheck && npm test` before every commit. Use `npm run format` to fix formatting.
- Boundary enforcement stays in eslint; do NOT enable fallow boundary rules.

---

### Task 1: devDependency + config + scripts

- [x] `npm install --save-dev fallow` (done during design verification; commit the lockfile here)
- [ ] `.fallowrc.jsonc`: `$schema`, `entry: ["scripts/e2e-smoke-entry.ts"]` (esbuild-bundled by `scripts/e2e-smoke.mjs`, invisible to auto-detection), `rules: { "unused-class-members": "warn" }` (Obsidian invokes lifecycle overrides; "unused" is unreliable for this rule here)
- [ ] package.json scripts: `quality` → `fallow`, `quality:health` → `fallow health --score`, `quality:dead-code` → `fallow dead-code`, `quality:dupes` → `fallow dupes`, `quality:audit` → `fallow audit`
- [ ] Verify: `npm run quality:dead-code` no longer reports `scripts/e2e-smoke-entry.ts` as unused; `npm run quality:audit` runs

### Task 2: advisory CI audit job

- [ ] New `quality` job in `.github/workflows/ci.yml`: ubuntu-latest, Node 22, `checkout` with `fetch-depth: 0`, `npm ci`, audit step with `continue-on-error: true` appending `npx fallow audit --format markdown` to `$GITHUB_STEP_SUMMARY`, `FALLOW_AUDIT_BASE` pinned to the PR base ref when present
- [ ] Extend `tests/ci-workflow-content.test.ts` (write the failing assertions first) covering: job exists, fetch-depth 0, continue-on-error advisory step
- [ ] Verify: `npm test`

### Task 3: agentic surfaces

- [ ] `.mcp.json`: `fallow` stdio server via `npx fallow-mcp`
- [ ] `.claude/skills/fallow/SKILL.md`: thin pointer to the version-matched `node_modules/fallow/skills/fallow/SKILL.md` + `references/` (no copied body → no drift)
- [ ] `AGENTS.md`: scaffold with `npx fallow init --agents`, adapt to this repo (CONTEXT.md language, `quality:*` scripts, the two local caveats)
- [ ] CONTRIBUTING.md: "Quality evidence" section; CHANGELOG.md: Unreleased entry
- [ ] Verify: `npx fallow-mcp` starts (stdio MCP handshake), full check suite green

### Task 4: ship

- [ ] `npm run lint && npm run format:check && npm run typecheck && npm test` + `npm run quality:audit`
- [ ] Push `claude/fallow-agentic-integration-tqux2g`, open PR
