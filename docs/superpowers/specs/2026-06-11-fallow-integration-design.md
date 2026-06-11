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
- Correction discovered during implementation: `tests/ci-workflow-content.test.ts`
  covers the **plugin-generated vault workflow**
  (`src/application/content/ci-workflow-content.ts`), not this repo's own
  `ci.yml` — no repo workflow file is unit-tested today, so the new job needs
  no test extension.

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

## Addendum (2026-06-11): ESLint 10 + Obsidian plugin guidelines

Follow-up request in the same session: "do the same with latest eslint …, also
add the obsidian linter rules — goal is a stable quality harness."

- **ESLint 9.39 → 10.4, typescript-eslint → 8.61** (8.61 supports eslint 10);
  zero rule fallout on the existing config.
- **`eslint-plugin-obsidianmd` (0.3.0) recommended preset**, every entry
  re-scoped to `src/**/*.ts` via AND-files: the preset's un-scoped entries
  carry type-aware rules that crash on untyped `.mjs` files, and its
  `package.json` entries are dropped (one disables type-checked linting
  wherever it applies; dependency hygiene is fallow's job).
- **Sentence-case reconciled with CONTEXT.md**: the glossary terms (Test Hub,
  Use Case, Test Suite, Test Run, Tag Expression, Demo Test, …) are configured
  as `brands` so the rule now enforces the product language in BOTH directions
  — lowercasing stray Title Case ("Run Demo Test" stays, "Create Feature" →
  "Create feature") and re-capitalizing glossary terms ("test runs" → "Test
  Runs"). ~25 UI strings fixed; two lowercase example-value placeholders
  (`staging`, `edge-cases`) carry justified inline disables.
- **Real findings fixed**: popout-window-unsafe DOM timers in
  `create-suite-modal`; glossary-inconsistent copy.
- **Justified inline disables** (each with a why-comment): Node timers in
  `node-child-process-runner` (need `Timeout.unref()`), permanent delete of
  regenerable runtime folders in `obsidian-vault-adapter` (trash-ing a 150 MB
  `.testrunner` would be hostile), the console sink in `logger.ts` (ADR-0019).
- **Deferred with a warn-level signal**: the Obsidian 1.13 settings API
  migration (`display()` → `getSettingDefinitions()`, `setWarning()` →
  `setDestructive()`) requires bumping `minAppVersion` from 1.8.0 — caught by
  `obsidianmd/no-unsupported-api` when a naive rename was attempted. Tracked
  as follow-up; `@typescript-eslint/no-deprecated` is `warn` for
  `settings-tab.ts` only.

## Addendum 2 (2026-06-11): platform floor, dependency refresh, strict lint, docs review

Same-session follow-ups: "bump plugins min version to latest avail version",
"research more useful linter rules for agentic development", "review official
obsidian developer docs to enforce plugin best practices", "upgrade all deps
to latest".

- **minAppVersion 1.8.0 → 1.13.0** (latest available; manifest + versions.json
  + release-validation agreement), unlocking `setDestructive()`. The
  `display()` → `getSettingDefinitions()` declarative settings migration was
  initially deferred warn-level, then completed in the same session (see
  Addendum 3) — lint now passes with zero warnings.
- **All devDependencies to latest**: TypeScript 6.0, vitest 4.1 (+ coverage),
  esbuild 0.28, @types/node 25, prettier, builtin-modules 5. `npm audit`: 0
  findings (was 2 critical + 4 moderate). One vitest-4 fallout fix (mock
  signature typing in `run-launcher.test.ts`).
- **Lint rules for agentic development** (selection driven by an empirical
  trial against this repo, not blog consensus): typescript-eslint
  `strictTypeChecked` + `stylisticTypeChecked` adopted with two tuned options
  and two documented opt-outs (`no-unnecessary-condition` fights the defensive
  guards while `noUncheckedIndexedAccess` is off — revisit together;
  `no-empty-function` fights the null-object idiom). `@vitest/eslint-plugin`
  adopted for tests (focused tests are errors; `valid-expect` allows vitest's
  `expect(value, message)`; `no-conditional-expect` off for Result narrowing).
  Rejected: sonarjs/unicorn (complexity + duplication are fallow's job, churn
  outweighs signal), eslint-plugin-promise (superseded by typed tseslint
  rules), niche "AI-code" plugins (immature for a stable harness). ~30
  findings fixed; 3 idioms kept with justified inline disables.
- **Obsidian developer-docs review** (docs.obsidian.md plugin guidelines, 37
  practices): the repo passes review-only items (no leaf detaching on unload,
  no `activeLeaf`, no `localStorage`, `registerInterval`, `plugin.addCommand`
  with plain `callback` for unconditional commands, `normalizePath`,
  `getAbstractFileByPath`). One improvement adopted: `Vault.process` over
  `Vault.modify` for background writes. The plugin's `validate-manifest` /
  `validate-license` rules are NOT wired: verified non-functional in v0.3.0
  flat config (they expect a TS/JS AST; even the raw preset reports
  manifest.json/LICENSE as ignored) — manifest integrity stays covered by the
  release-validation suite and `no-unsupported-api`.

## Addendum 3 (2026-06-11): declarative settings tab (zero lint warnings)

`TestHubSettingTab` migrated from the deprecated imperative `display()`
override to the Obsidian 1.13 declarative API: `getSettingDefinitions()`
returns the tab structure (groups for Folders / System under test / per
environment / Maintenance / Continuous integration), and every interactive
row uses the API's `render` escape hatch so the tested behavior is preserved
verbatim — debounced persists with blur flush (PRES-M1), the save-blocking
inline error surface, the dangling-active-environment dropdown repair,
two-click destructive confirms, and the async checklist results.
`this.display()` re-renders became `refreshTab()` (= cancel pending
debouncers + `this.update()`); render callbacks return cleanups for the DOM
they add beside their row. The per-row imperative wiring was deliberately NOT
converted to declarative `control` bindings: the framework's
validate/persist semantics differ from the repo's authoritative
SettingsService validation contract, and behavior parity wins. The
`@typescript-eslint/no-deprecated` warn override for the file is removed —
the lint gate is now 0 errors, 0 warnings.

## Acceptance

1. `npm run quality` and `npm run quality:audit` run locally; the
   `scripts/e2e-smoke-entry.ts` unused-file false positive is gone.
2. CI on this branch's PR shows the advisory `quality` job green with the
   audit verdict in the job summary.
3. `npx fallow-mcp` starts and speaks MCP on stdio (registered via `.mcp.json`).
4. Existing suite stays green: lint, format:check, typecheck, vitest.
