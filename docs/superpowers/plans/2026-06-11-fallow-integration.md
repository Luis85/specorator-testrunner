# Fallow Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or implement directly in-session for a change this size) task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate fallow (deterministic JS/TS codebase intelligence) as (1) local dev tooling — devDependency, repo-tuned `.fallowrc.jsonc`, `quality:*` npm scripts; (2) an advisory `quality` audit job in CI; (3) agent-facing surfaces — `.mcp.json` MCP server, a pointer Agent Skill, `AGENTS.md`, and CONTRIBUTING guidance.

**Spec:** `docs/superpowers/specs/2026-06-11-fallow-integration-design.md`

**Conventions you must follow (this codebase):**
- Comments explain constraints/why, not what. Match the existing density.
- Run `npm run lint && npm run format:check && npm run typecheck && npm test` before every commit. Use `npm run format` to fix formatting.
- Boundary enforcement stays in eslint; do NOT enable fallow boundary rules.

---

### Task 1: devDependency + config + scripts

- [x] `npm install --save-dev fallow` (done during design verification; commit the lockfile here)
- [x] `.fallowrc.jsonc`: `$schema`, `entry: ["scripts/e2e-smoke-entry.ts"]` (esbuild-bundled by `scripts/e2e-smoke.mjs`, invisible to auto-detection), `rules: { "unused-class-members": "warn" }` (Obsidian invokes lifecycle overrides; "unused" is unreliable for this rule here)
- [x] package.json scripts: `quality` → `fallow`, `quality:health` → `fallow health --score`, `quality:dead-code` → `fallow dead-code`, `quality:dupes` → `fallow dupes`, `quality:audit` → `fallow audit`
- [x] Verify: `npm run quality:dead-code` no longer reports `scripts/e2e-smoke-entry.ts` as unused; `npm run quality:audit` runs

### Task 2: advisory CI audit job

- [x] New `quality` job in `.github/workflows/ci.yml`: ubuntu-latest, Node 22, `checkout` with `fetch-depth: 0`, `npm ci`, audit step with `continue-on-error: true` appending `npx fallow audit --format markdown` to `$GITHUB_STEP_SUMMARY`, `FALLOW_AUDIT_BASE` pinned to the PR base ref when present
- [x] ~~Extend `tests/ci-workflow-content.test.ts`~~ — dropped: that test covers the plugin-**generated** vault workflow, not this repo's own `ci.yml`; no repo workflow file is unit-tested today
- [x] Verify: `npm test`

### Task 3: agentic surfaces

- [x] `.mcp.json`: `fallow` stdio server via `npx fallow-mcp`
- [x] `.claude/skills/fallow/SKILL.md`: thin pointer to the version-matched `node_modules/fallow/skills/fallow/SKILL.md` + `references/` (no copied body → no drift)
- [x] `AGENTS.md`: scaffold with `npx fallow init --agents`, adapt to this repo (CONTEXT.md language, `quality:*` scripts, the two local caveats)
- [x] CONTRIBUTING.md: "Quality evidence" section; CHANGELOG.md: Unreleased entry
- [x] Verify: `npx fallow-mcp` starts (stdio MCP handshake), full check suite green

### Task 4: ship

- [x] `npm run lint && npm run format:check && npm run typecheck && npm test` + `npm run quality:audit`
- [x] Push `claude/fallow-agentic-integration-tqux2g`, open PR — https://github.com/Luis85/specorator-testrunner/pull/32
