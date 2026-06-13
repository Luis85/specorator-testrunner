# Fallow Integration Guide

A universal, copy-paste guide for integrating fallow into any JS/TS project
as a quality harness for humans, CI, and coding agents.

---

## What fallow gives you

[fallow](https://github.com/fallow-rs/fallow) is a Rust-native static-analysis
engine for JS/TS projects. It answers the questions that linters and test
runners don't:

- **Dead code** — unused files, exports, and dependencies
- **Duplication** — clone groups across the codebase
- **Complexity hotspots** — functions with CRAP/cyclomatic/cognitive scores
- **Health scoring** — a single letter grade (A–F) and numeric score
- **Changed-code audit** — a pass/warn/fail verdict on what a PR actually
  introduced, not the full inventory

It ships three agent-facing surfaces: a stdio MCP server (`fallow-mcp`), a
version-matched Agent Skill under `node_modules/fallow/skills/fallow/`, and
machine-actionable JSON output with `auto_fixable` flags.

---

## Step 1 — Install

```bash
npm install --save-dev fallow
```

Verify the install worked:

```bash
npx fallow --version
npx fallow          # zero-config full analysis; expect health score + findings
```

Fallow auto-detects entry points from `package.json` (`main`, `exports`,
`bin`). If your project has additional entry points that are assembled at
runtime by a bundler (esbuild, rollup, webpack) and are not listed in
`package.json`, you will need Step 2's `entry` field.

---

## Step 2 — Create `.fallowrc.jsonc`

Create at the repo root. This file is JSONC (JSON with comments), so document
your decisions inline — they matter later.

### Minimal config (most projects)

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/fallow-rs/fallow/main/schema.json"
}
```

The `$schema` pointer enables editor validation and autocomplete. No other
fields are required unless you hit a specific need below.

### Adding hidden entry points

If a bundler assembles additional entry files that `package.json` doesn't
declare, fallow's auto-detection will call them unused. Add them explicitly:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/fallow-rs/fallow/main/schema.json",
  // <tool> bundles this at runtime; package.json auto-detection cannot see it.
  "entry": ["scripts/my-bundled-entry.ts"]
}
```

### Downgrading a noisy rule to warn

If a rule produces structural false positives (e.g. a framework invokes class
methods dynamically, so they appear unused to static analysis), keep the signal
visible without making it verdict-driving:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/fallow-rs/fallow/main/schema.json",
  "rules": {
    // <FrameworkName> invokes <lifecycle methods> dynamically, so static
    // "unused" detection is unreliable for class members. Keep visible, never
    // verdict-driving.
    "unused-class-members": "warn"
  }
}
```

Common cases for `warn`:
- Angular lifecycle hooks (`ngOnInit`, `ngOnDestroy`, …)
- Obsidian plugin overrides (`onChooseItem`, `getItems`, `hide`, …)
- NestJS decorators that wire methods at runtime
- Any class whose methods are called by a framework, not by your code

### What to leave out

Do **not** enable fallow's boundary/layer preset rules if your project already
enforces boundaries through another tool (e.g. ESLint `no-restricted-imports`,
import-graph custom rules). Two sources of truth for the same constraint is a
maintenance trap. Fallow's job is quality evidence; boundary enforcement is a
correctness gate and belongs with your linter.

---

## Step 3 — Add npm scripts

Add a `quality` namespace to `package.json`, mirroring your existing
`test`/`lint` convention:

```json
{
  "scripts": {
    "quality":            "fallow",
    "quality:health":     "fallow health --score",
    "quality:dead-code":  "fallow dead-code",
    "quality:dupes":      "fallow dupes",
    "quality:audit":      "fallow audit"
  }
}
```

What each command does:

| Script | When to run |
|--------|-------------|
| `npm run quality` | Full sweep: dead-code + dupes + health. Run periodically or before a big refactor. |
| `npm run quality:health` | Quick health score check. Useful for a before/after snapshot. |
| `npm run quality:dead-code` | List unused files, exports, and dependencies only. |
| `npm run quality:dupes` | List clone groups only. |
| `npm run quality:audit` | Changed-code verdict vs. `origin/main`. **Run before requesting review.** |

---

## Step 4 — Add the CI quality job

This job runs the changed-code audit on every pull request and posts the
verdict as a step summary. Copy this job into your existing CI workflow file
(e.g. `.github/workflows/ci.yml`) as a sibling to your test/lint jobs.

```yaml
quality:
  runs-on: ubuntu-latest
  timeout-minutes: 10
  steps:
    - uses: actions/checkout@v4
      with:
        # The audit diffs against the merge-base. Without full history, fallow
        # cannot find the common ancestor of the branch and base.
        fetch-depth: 0

    - name: Set up Node
      uses: actions/setup-node@v4
      with:
        node-version: 22   # pin to whatever your project uses
        cache: npm

    - name: Install dependencies
      run: npm ci

    # OPTIONAL but strongly recommended: generate coverage before the audit.
    # Fallow uses Istanbul coverage data to compute CRAP scores on changed
    # functions. Without it, CRAP is estimated and tested functions in changed
    # files can produce false over-threshold findings.
    - name: Generate coverage
      run: npm run test:coverage

    - name: Fallow audit
      continue-on-error: true   # advisory: warn/fail verdict visible but doesn't block the PR
      run: |
        set -o pipefail
        # GITHUB_BASE_REF is only set on pull_request events; on main pushes
        # fallow's own merge-base discovery applies (effectively a no-op).
        if [ -n "$GITHUB_BASE_REF" ]; then
          npx fallow audit --base "origin/$GITHUB_BASE_REF" --format markdown | tee -a "$GITHUB_STEP_SUMMARY"
        else
          npx fallow audit --format markdown | tee -a "$GITHUB_STEP_SUMMARY"
        fi
```

### Advisory vs. blocking

**Start advisory.** The template above includes `continue-on-error: true` on
the audit step so a warn/fail verdict shows as a failed step annotation but the
job (and the PR check) stays green. Use this phase to observe signal quality on
a few PRs. If the gate is noisy (lots of false positives from pre-existing
inventory), tune your `.fallowrc.jsonc` thresholds before flipping to blocking.

The audit uses new-only attribution by default: it gates on findings *your
changeset introduced*, not the entire historical inventory. This means
launch-default thresholds are usually workable without tuning. However, any
edit to a file places that file's findings in scope — pre-existing complexity
in heavily-edited files can surface as "introduced." Revisit thresholds only if
this proves noisy in practice.

**Flip to blocking** once you trust the signal — remove `continue-on-error`:

```yaml
    - name: Fallow audit
      # continue-on-error removed — this is now a required blocking check.
      run: |
        ...
```

Also set the job as a required check in your branch protection rules (GitHub:
Settings → Branches → Require status checks to pass → add `quality`).

Document the flip in a tech-debt record or changelog entry so future
contributors understand why the gate exists and what it gates on.

### Coverage note

If your project doesn't have a `test:coverage` script, either add one or
remove that step. Fallow still works without coverage; CRAP scores will be
estimated rather than exact.

---

## Step 5 — Register the MCP server

Create `.mcp.json` at the repo root. This registers fallow as a local stdio
MCP server so any coding agent (Claude Code, Continue, Cursor, etc.) can
query it directly during a session.

```json
{
  "mcpServers": {
    "fallow": {
      "command": "npx",
      "args": ["fallow-mcp"]
    }
  }
}
```

The MCP server is version-matched to whichever `fallow` version is installed
in `node_modules`. It exposes both read-only analysis tools (health, dead-code,
duplication, audit) and a write-capable `fix_apply` tool that can apply
auto-fixable findings directly to the working tree (`fallow fix --yes`).

**Agent auto-fix:** When an agent uses `fix_apply`, it writes to your files.
This is intentional — it is how agents act on `auto_fixable` findings without
manual intervention. Review the diff before committing, exactly as you would
for any agent-generated change. If your team's policy is that agents must never
write to the repo unsupervised, configure your agent's tool permissions to
block `fix_apply` (e.g. in Claude Code's `.claude/settings.json` deny list).

---

## Step 6 — Add the agent skill (Claude Code)

If your project uses Claude Code, add a thin pointer skill so agents
automatically know how to use fallow in this repo's context.

Create `.claude/skills/fallow/SKILL.md`:

```markdown
---
name: fallow
description: Codebase intelligence for this repo via fallow. Use when asked to analyze code health, audit PR/changed-code risk, find cleanup opportunities or unused code, detect duplication, check circular dependencies, audit complexity, or run fallow. Provides deterministic evidence (not guesses) for refactoring and review decisions.
---

# Fallow (pointer skill)

This is a thin pointer so the guidance can never drift from the installed CLI
version. The real, version-matched skill ships inside the npm package:

1. Read `node_modules/fallow/skills/fallow/SKILL.md` and follow it.
2. Its `references/` directory (`cli-reference.md`, `patterns.md`,
   `gotchas.md`) sits alongside it.
3. If `node_modules/fallow` is missing, run `npm install` first.

## Repo-specific notes (override the upstream skill where they conflict)

- Run via the npm scripts: `npm run quality`, `quality:audit`,
  `quality:health`, `quality:dead-code`, `quality:dupes`.
- Config is `.fallowrc.jsonc`.
- [ADD ANY PROJECT-SPECIFIC CAVEATS HERE — e.g. which rules are warn-only
  and why, which entry points are hidden from auto-detection, which
  tools own boundary enforcement instead of fallow.]
```

**Design principle:** Never copy the upstream skill body into this file.
The pointer pattern means this skill cannot drift from the installed CLI
version. Only put repo-specific overrides and caveats here.

---

## Step 7 — Update developer-facing documentation

### In `CONTRIBUTING.md` (or equivalent)

Add a "Quality evidence" section:

```markdown
## Quality evidence

[fallow](https://github.com/fallow-rs/fallow) provides deterministic quality
evidence (config: `.fallowrc.jsonc`). CI runs the changed-code audit on every
PR; locally:

\`\`\`
npm run quality:audit      # changed-code risk verdict vs. origin/main — run before requesting review
npm run quality            # full analysis: health + duplication + cleanup opportunities
npm run quality:health     # health score and grade
npm run quality:dead-code  # unused files/exports/deps
npm run quality:dupes      # clone groups
\`\`\`
```

### In `AGENTS.md` (or equivalent agent guidance file)

Add a section covering:
- Which `quality:*` scripts to use and when
- The MCP server (registered via `.mcp.json`; read-only; version-matched)
- The version-matched skill at `node_modules/fallow/skills/fallow/SKILL.md`
- Project-specific caveats (any warn-only rules, any false-positive categories)
- Machine-readable JSON: `fallow <cmd> --format json --quiet`; each issue
  carries an `actions` array with `auto_fixable` flags

Example AGENTS.md entry:

```markdown
## Quality analysis (fallow)

Run `npm run quality:audit` before requesting review — verdict gates on
findings introduced by your changeset (new-only attribution).

Full analysis: `npm run quality` (dead-code + duplication + health).

JSON output for agentic use: `fallow <cmd> --format json --quiet`.
Each issue includes an `actions` array; check `auto_fixable` before
attempting a manual fix — fallow can apply some fixes automatically.

MCP: registered in `.mcp.json`. Start with `npx fallow-mcp` (stdio).
Agent Skill: `.claude/skills/fallow/SKILL.md` (pointer to version-matched
upstream at `node_modules/fallow/skills/fallow/SKILL.md`).

Caveats:
- [PROJECT-SPECIFIC CAVEAT 1]
- [PROJECT-SPECIFIC CAVEAT 2]
```

---

## Step 8 — Handle suppressions

When you need to suppress a specific finding (not a rule-wide downgrade),
use inline directives:

```ts
// fallow-ignore-next-line complexity
function legacyMonolith() {
  // ... intentionally complex; tracked as <tech-debt-id> pending <replacement>
}
```

**Rules for suppressions:**
1. Always add a why-comment — what constraint, what's deferred, what's the plan.
2. Suppressed findings remain **visible** in audit output (counted as
   suppressed, never silently excluded). This is intentional.
3. Track intentional suppressions as tech debt (e.g. in a `docs/tech-debt/`
   file) so they get revisited rather than accumulated.

---

## Verification checklist

After completing all steps, run the following to confirm the integration works:

```bash
# 1. Full local analysis
npm run quality

# 2. Audit vs. main (should show "no changed files" or a clean verdict on main)
npm run quality:audit

# 3. MCP server starts cleanly
npx fallow-mcp &
# Expect: MCP protocol handshake on stdout, no errors
kill %1

# 4. Agent skill pointer resolves
cat node_modules/fallow/skills/fallow/SKILL.md | head -5
# Expect: SKILL.md exists and is readable
```

Confirm in CI: open a draft PR, let the `quality` job run, and check that:
- The job completes (or fails) as expected
- The audit verdict appears in the GitHub step summary

---

## Troubleshooting

### "Unused file" false positives for bundler entries

**Symptom:** fallow reports a file as unused, but it is actually an entry point
assembled by esbuild/rollup/webpack and not listed in `package.json`.

**Fix:** Add the file to `"entry"` in `.fallowrc.jsonc`:

```jsonc
{
  "entry": ["path/to/your-entry.ts"]
}
```

### "Unused class members" false positives for framework-invoked methods

**Symptom:** fallow reports class methods as unused, but they are lifecycle
overrides called by a framework (Angular, Obsidian, NestJS, etc.).

**Fix:** Downgrade the rule to `"warn"` in `.fallowrc.jsonc` and document why:

```jsonc
{
  "rules": {
    // <Framework> invokes these dynamically; static analysis cannot see it.
    "unused-class-members": "warn"
  }
}
```

### Audit fails on CI with "no merge base found"

**Symptom:** `fallow audit` exits non-zero with a message about being unable
to find the merge base.

**Fix:** Ensure `fetch-depth: 0` is set in `actions/checkout`. Without full
history, git cannot find the common ancestor:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
```

### CRAP scores are estimated / false failures on changed files

**Symptom:** Functions in changed files fail the CRAP threshold even though
they are well-tested.

**Fix:** Run your test suite with coverage generation *before* the fallow audit
step in CI. Fallow automatically picks up `./coverage` (Istanbul format):

```yaml
- name: Generate coverage
  run: npm run test:coverage
- name: Fallow audit
  run: npx fallow audit ...
```

### Pre-existing inventory floods the audit verdict

**Symptom:** The audit fails with many findings, but most are in files you
didn't touch.

**Cause:** New-only attribution is the default, but any edit to a file brings
that file's pre-existing findings into scope. Heavy edits to complex legacy
files can surface dormant findings.

**Options:**
1. Refactor the complex file (preferred — this is the signal working correctly).
2. Suppress specific findings with inline `fallow-ignore-next-line` and track
   as tech debt.
3. Tune thresholds in `.fallowrc.jsonc` (last resort — only if the gate is
   systematically noisy and the findings are not actionable).

---

## Summary of files created/modified

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | Modified | Add `fallow` devDependency + `quality:*` scripts |
| `.fallowrc.jsonc` | Created | Repo-tuned fallow config |
| `.github/workflows/ci.yml` | Modified | Add `quality` CI job |
| `.mcp.json` | Created | Register fallow MCP server for agents |
| `.claude/skills/fallow/SKILL.md` | Created | Pointer skill for Claude Code |
| `CONTRIBUTING.md` | Modified | Add "Quality evidence" section |
| `AGENTS.md` | Modified | Add fallow usage guidance for agents |
