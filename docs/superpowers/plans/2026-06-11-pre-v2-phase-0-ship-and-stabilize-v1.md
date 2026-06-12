# Pre-V2 Phase 0 — Ship and Stabilize V1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute §9 Phase 0 of the [V2 Research and Proposal](../../proposals/2026-06-11%20V2%20Research%20and%20Proposal.md) — lock down the release path (0.3), make the `e2e-smoke` workflow a trustworthy pre-release gate (0.2), flip the advisory quality gates to blocking (0.4, TD-006), and tag/release V1 with BRAT as the official distribution channel including the ribbon-trim product call (0.1).

**Architecture:** No production-code architecture changes. This increment touches CI workflows (`.github/workflows/`), lint/quality config, two source files (ribbon registration in `src/main.ts`, one line of generated-doc copy in `src/application/content/documentation-content.ts`), docs, and the release version metadata. The spec is §9 Phase 0 of the proposal itself; no separate design spec exists.

**Tech Stack:** GitHub Actions, fallow, ESLint 10, Vitest, Obsidian plugin metadata (`manifest.json`/`versions.json`), BRAT distribution.

**Decisions locked in by this plan** (defaults chosen per the proposal; flag in review if any should change):

1. **Release version is `1.0.0`.** The proposal says "Tag and release V1"; `0.0.1` was never tagged (no git tags exist) and the CHANGELOG already carries it as "unreleased development version".
2. **Ribbon set after the trim: Dashboard (`gauge`) + Test Console (`terminal`).** The review §4 product call verbatim ("trimming to Dashboard + Console"). The wizard stays reachable via the command palette and the dashboard's uninitialized-state call to action; Use Cases / Suites / Evidence Explorer via palette and dashboard quick actions.
3. **Browser cache is keyed on `hashFiles()` of the runner-template source**, not a parsed Playwright version. The version literal lives in `runner-templates.ts`; hashing the file invalidates the cache whenever the version *could* change, with zero brittle string extraction. A `restore-keys` prefix keeps partial reuse (Playwright skips downloads for revisions already present).
4. **"Run on demand for runner-template changes" = a `changes` detection job** that auto-triggers the smoke matrix on PRs touching the template surface (templates, demo content, the smoke scripts, the workflow itself). The existing `workflow_dispatch` + `e2e-smoke` label paths stay.
5. **`.fallowrc.jsonc` thresholds stay at the launch defaults.** TD-006 asked for "repo-tuned thresholds … so the gate fails on regressions, not on the existing inventory" — verified: `fallow audit` already gates with `"gate": "new-only"` attribution (introduced findings only), and the current verdict is `pass`. The tuning *is* the attribution; the flip is removing `continue-on-error`. Revisit thresholds only if the blocking gate proves noisy.
6. **SHA-pinning scope is `release.yml` plus any action newly added by this plan.** `ci.yml`/`e2e-smoke.yml` keep tag pins (Dependabot watches them; the review reserved the stricter posture for the `contents: write` workflow).

**Conventions that apply to every task:**

- All commands run from the repo root `/home/user/specorator-testrunner` on branch `claude/specorator-v2-increment-g137m7`.
- After any task touching `src/` or `eslint.config.mjs`: `npm run lint && npm run typecheck && npm test` must pass.
- After any task touching a workflow file, validate the YAML parses:
  `node -e "require('js-yaml').load(require('fs').readFileSync(process.argv[1],'utf8'));console.log('YAML OK')" .github/workflows/<file>.yml`
- CHANGELOG entries go under `## [Unreleased]` (its `### Added` starts at line 9, `### Changed` at line 45, `### Fixed` at line 58 pre-plan); Task 7 renames that heading to `## [1.0.0]`.

---

### Task 1: Pin `release.yml` actions to commit SHAs (item 0.3)

**Files:**
- Modify: `.github/workflows/release.yml:17` and `:20`

The release workflow holds `contents: write`; a hijacked action tag could exfiltrate the token or tamper with release assets. Pin to full commit SHAs (Dependabot's `github-actions` ecosystem updates SHA pins and their version comments).

SHAs resolved from `git ls-remote` on 2026-06-11 (re-resolve at execution time if newer releases exist — `git ls-remote --tags https://github.com/actions/<name>`; for annotated tags use the `^{}` dereferenced commit):

- `actions/checkout` v6.0.3 → `df4cb1c069e1874edd31b4311f1884172cec0e10` (annotated tag, dereferenced)
- `actions/setup-node` v6.4.0 → `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e`

- [ ] **Step 1: Pin the checkout action**

In `.github/workflows/release.yml` replace:

```yaml
      - uses: actions/checkout@v6
```

with:

```yaml
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3
```

- [ ] **Step 2: Pin the setup-node action**

Replace:

```yaml
      - name: Set up Node
        uses: actions/setup-node@v6
```

with:

```yaml
      - name: Set up Node
        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
```

- [ ] **Step 3: Add the CHANGELOG entry**

In `CHANGELOG.md`, after the `### Fixed` block of `## [Unreleased]` (i.e. as a new section before the `## [0.0.1]` heading), add:

```markdown
### Security

- `release.yml` (the only workflow with `contents: write`) pins its actions to
  full commit SHAs instead of tags; Dependabot keeps the pins current.
```

- [ ] **Step 4: Verify**

Run: `node -e "require('js-yaml').load(require('fs').readFileSync(process.argv[1],'utf8'));console.log('YAML OK')" .github/workflows/release.yml`
Expected: `YAML OK`

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml CHANGELOG.md
git commit -m "ci: pin release.yml actions to commit SHAs (pre-V2 0.3)"
```

---

### Task 2: Cache Playwright browsers in `e2e-smoke.yml` (item 0.2a)

**Files:**
- Modify: `.github/workflows/e2e-smoke.yml`

Each smoke run downloads ~150 MB of Chromium per OS. Redirect Playwright's browser store into the workspace via `PLAYWRIGHT_BROWSERS_PATH` (one cacheable path on both OSes; `execSync` in `scripts/e2e-smoke.mjs` inherits the job env, so the generated `.testrunner`'s `playwright install` and test run both honor it) and cache it keyed per OS on the template source hash. Note: on ubuntu, `install:browsers:ci` uses `--with-deps`, whose apt system packages are not cached — only the browser download is.

- [ ] **Step 1: Add the job-level env and the cache step**

In `.github/workflows/e2e-smoke.yml`, inside the `smoke` job, add an `env` block after `timeout-minutes: 30` (before `strategy:`):

```yaml
    env:
      # One cacheable browser location on both OSes; the smoke script's child
      # processes (npm install / playwright install / test run) inherit it.
      PLAYWRIGHT_BROWSERS_PATH: ${{ github.workspace }}/.pw-browsers
```

Then add the cache step between `Set up Node 22` and `Install plugin dependencies`:

```yaml
      - name: Cache Playwright browsers
        uses: actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830 # v4.3.0
        with:
          path: .pw-browsers
          # The template source pins the runner's Playwright version; hashing it
          # invalidates the cache whenever that pin can change. restore-keys
          # keeps partial reuse (playwright install skips present revisions).
          key: playwright-${{ runner.os }}-${{ hashFiles('src/infrastructure/runner/templates/runner-templates.ts') }}
          restore-keys: |
            playwright-${{ runner.os }}-
```

(`actions/cache` v4.3.0 SHA resolved 2026-06-11 from `git ls-remote --tags https://github.com/actions/cache`; new action ⇒ pinned per Decision 6.)

- [ ] **Step 2: Update the workflow header comment**

Replace the first two header lines:

```yaml
# Opt-in E2E smoke: installs the generated .testrunner for real and runs the
# demo test (scripts/e2e-smoke.mjs). Heavier than CI (npm install + Chromium
# download per OS), so it only runs on demand: manual dispatch or the
# `e2e-smoke` label on a PR.
```

with:

```yaml
# E2E smoke: installs the generated .testrunner for real and runs the demo
# test (scripts/e2e-smoke.mjs). Heavier than CI (npm install per OS; Chromium
# is cached), so it runs on demand — manual dispatch or the `e2e-smoke` PR
# label — and automatically on PRs that touch the runner-template surface
# (pre-V2 plan items 0.2a/0.2b: this is the pre-release gate the
# playwright-bdd migration will be validated against).
```

- [ ] **Step 3: Verify**

Run: `node -e "require('js-yaml').load(require('fs').readFileSync(process.argv[1],'utf8'));console.log('YAML OK')" .github/workflows/e2e-smoke.yml`
Expected: `YAML OK`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/e2e-smoke.yml
git commit -m "ci: cache Playwright browsers per OS in e2e-smoke (pre-V2 0.2)"
```

---

### Task 3: Auto-run `e2e-smoke` on runner-template changes (item 0.2b)

**Files:**
- Modify: `.github/workflows/e2e-smoke.yml`

A workflow-level `paths` filter would also constrain the label flow, so detection is a cheap first job: diff the PR against its base and expose a boolean output. The watched surface is exactly what `scripts/e2e-smoke-entry.ts` bundles plus the smoke machinery itself: `src/infrastructure/runner/templates/`, `src/application/content/demo-content.ts`, `scripts/e2e-smoke*`, and the workflow file. (`DEFAULT_SETTINGS` is also bundled but changes far too often to gate on.)

This PR touches the workflow file, so merging this very increment exercises the auto-trigger end to end.

- [ ] **Step 1: Add the `changes` job**

In `.github/workflows/e2e-smoke.yml`, add as the first job under `jobs:` (before `smoke:`):

```yaml
  # Detects PR changes to the runner-template surface so the smoke gate runs
  # automatically on exactly the changes it exists to protect.
  changes:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    outputs:
      runner-templates: ${{ steps.diff.outputs.changed }}
    steps:
      - uses: actions/checkout@v6
        if: github.event_name == 'pull_request'
        with:
          fetch-depth: 0
      - name: Diff the runner-template surface against the PR base
        id: diff
        shell: bash
        env:
          BASE_REF: ${{ github.base_ref }}
        run: |
          if [ -z "$BASE_REF" ]; then
            echo "changed=false" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          if git diff --name-only "origin/$BASE_REF...HEAD" | grep -qE '^(src/infrastructure/runner/templates/|src/application/content/demo-content\.ts|scripts/e2e-smoke|\.github/workflows/e2e-smoke\.yml)'; then
            echo "changed=true" >> "$GITHUB_OUTPUT"
          else
            echo "changed=false" >> "$GITHUB_OUTPUT"
          fi
```

- [ ] **Step 2: Extend the `smoke` job's trigger condition**

Add `needs: changes` to the `smoke` job and replace its `if:` block:

```yaml
  smoke:
    needs: changes
    # Runs on: manual dispatch; adding the `e2e-smoke` label itself (not any
    # other label landing while it happens to be present); pushes/reopens on a
    # PR that already carries the label; or any PR event whose diff touches
    # the runner-template surface (see the `changes` job).
    if: >-
      ${{
        github.event_name == 'workflow_dispatch' ||
        (github.event.action == 'labeled' && github.event.label.name == 'e2e-smoke') ||
        (github.event.action != 'labeled' && contains(github.event.pull_request.labels.*.name, 'e2e-smoke')) ||
        needs.changes.outputs.runner-templates == 'true'
      }}
```

(Delete the old comment block + `if:` that this replaces. The `changes` job always runs and succeeds, so `needs:` introduces no skip-propagation problem.)

- [ ] **Step 3: Add the CHANGELOG entry**

In `CHANGELOG.md` under `## [Unreleased]` → `### Changed`, add as the first bullet:

```markdown
- The E2E smoke workflow is now a dependable pre-release gate: Playwright
  browsers are cached per OS, and the suite triggers automatically on PRs
  that change the runner-template surface (in addition to manual dispatch
  and the `e2e-smoke` label).
```

- [ ] **Step 4: Verify**

Run: `node -e "require('js-yaml').load(require('fs').readFileSync(process.argv[1],'utf8'));console.log('YAML OK')" .github/workflows/e2e-smoke.yml`
Expected: `YAML OK`

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/e2e-smoke.yml CHANGELOG.md
git commit -m "ci: auto-run e2e-smoke on runner-template changes (pre-V2 0.2)"
```

---

### Task 4: Flip the advisory quality gates to blocking (item 0.4, closes TD-006)

**Files:**
- Modify: `eslint.config.mjs:326-344` (vitest hygiene block)
- Modify: `.github/workflows/ci.yml:58-90` (quality job)
- Modify: `.fallowrc.jsonc`
- Modify: `docs/tech-debt/TD-006.md`, `docs/tech-debt/README.md`
- Modify: `CHANGELOG.md`

Verified baseline (2026-06-11): `npm run lint` exits 0 with **zero** `vitest/no-disabled-tests` findings (promotion is a free flip), and `npx fallow audit --format json` returns `"verdict": "pass"` with `"gate": "new-only"` attribution — the blocking gate fails only on findings a changeset introduces. `vitest/no-disabled-tests` is the only remaining warn-level rule (the `@typescript-eslint/no-deprecated` settings-tab warn from the ESLint-10 addendum was resolved by the settings-tab migration).

- [ ] **Step 1: Promote `vitest/no-disabled-tests` to error**

In `eslint.config.mjs`, replace the vitest hygiene block's comment and rule:

```js
    // Vitest test hygiene: catches the test anti-patterns agents introduce
    // most often (focused/disabled tests, assertion-free tests, misused
    // matchers). no-focused-tests is an error — a stray `.only` silently
    // shrinks CI coverage to one test.
```

with:

```js
    // Vitest test hygiene: catches the test anti-patterns agents introduce
    // most often (focused/disabled tests, assertion-free tests, misused
    // matchers). no-focused-tests and no-disabled-tests are errors (TD-006
    // flip) — a stray `.only`/`.skip` silently shrinks CI coverage.
```

and:

```js
      "vitest/no-disabled-tests": "warn",
```

with:

```js
      "vitest/no-disabled-tests": "error",
```

Note: `tests/integration/release-validation.test.ts` uses `it.skipIf(...)` — that is conditional, not disabled; the rule does not flag `skipIf`.

- [ ] **Step 2: Verify lint stays green**

Run: `npm run lint`
Expected: exits 0, no output. (If a finding appears, fix the disabled test or add an explicit `// eslint-disable-next-line vitest/no-disabled-tests -- <reason>` — never re-demote the rule.)

- [ ] **Step 3: Make the fallow audit job blocking**

In `.github/workflows/ci.yml`, replace the quality job's header comment:

```yaml
  # Advisory changed-code quality evidence (fallow audit). The verdict lands in
  # the job summary; a warn/fail verdict marks the step failed for visibility
  # but never blocks the PR (see docs/superpowers/specs/
  # 2026-06-11-fallow-integration-design.md — gating is a possible follow-up).
```

with:

```yaml
  # Blocking changed-code quality gate (fallow audit, TD-006 flip). The
  # verdict gates on findings INTRODUCED by the changeset (new-only
  # attribution), so it fails on regressions, not on pre-existing inventory;
  # the verdict also lands in the job summary.
```

Then in the audit step, delete the line `continue-on-error: true` and rename the step from `Fallow audit (advisory)` to `Fallow audit`.

- [ ] **Step 4: Record the gating decision in `.fallowrc.jsonc`**

Add inside the top-level object, after the `"entry"` line:

```jsonc
  // CI gate (TD-006): the audit job in ci.yml is blocking. The verdict uses
  // new-only attribution (fails only on findings a changeset introduces), so
  // the launch-default thresholds need no inventory-wide tuning. Revisit the
  // thresholds only if the blocking gate proves noisy in practice.
```

- [ ] **Step 5: Close TD-006**

In `docs/tech-debt/TD-006.md`: change frontmatter `status: open` to `status: resolved`, and append:

```markdown
## Resolution (2026-06-11)

Resolved in the pre-V2 Phase 0 increment (plan:
`docs/superpowers/plans/2026-06-11-pre-v2-phase-0-ship-and-stabilize-v1.md`):

1. Thresholds: verified the audit gates with new-only attribution
   (`"gate": "new-only"`, current verdict `pass`) — it already fails on
   regressions, not inventory, so the launch defaults stand (decision
   recorded in `.fallowrc.jsonc`).
2. `continue-on-error` removed from the audit step; the quality job is a
   blocking check.
3. `vitest/no-disabled-tests` promoted to error (zero findings at flip time;
   no other warn-level rules remained).
4. Recorded in CHANGELOG under the V1 release.
```

In `docs/tech-debt/README.md`: remove the TD-006 row from the **Open items** table and add after that table:

```markdown
## Resolved items

| Id | Title | Area | Resolved |
| --- | --- | --- | --- |
| [[TD-006]] | Flip the advisory quality gates to blocking and tighten them | quality | pre-V2 Phase 0 increment (2026-06-11) |
```

- [ ] **Step 6: Add the CHANGELOG entry**

In `CHANGELOG.md` under `## [Unreleased]` → `### Changed`, add:

```markdown
- The quality gates are now blocking (TD-006): the fallow changed-code audit
  fails CI on findings a changeset introduces (new-only attribution), and
  `vitest/no-disabled-tests` is an error.
```

- [ ] **Step 7: Verify**

Run: `npm run lint && npm run typecheck && npm test && node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/ci.yml','utf8'));console.log('YAML OK')" && npx fallow audit --base origin/main || true`
Expected: lint/typecheck/tests green, `YAML OK`, audit verdict `pass` (this increment introduces no dead code/complexity/duplication).

- [ ] **Step 8: Commit**

```bash
git add eslint.config.mjs .github/workflows/ci.yml .fallowrc.jsonc docs/tech-debt/TD-006.md docs/tech-debt/README.md CHANGELOG.md
git commit -m "ci: flip the advisory quality gates to blocking (TD-006, pre-V2 0.4)"
```

---

### Task 5: Trim default ribbon icons to Dashboard + Test Console (item 0.1, review §4 product call)

**Files:**
- Modify: `src/main.ts:581-608`
- Modify: `src/application/content/documentation-content.ts:73`
- Modify: `CHANGELOG.md`

Six default ribbon icons are heavy chrome. Keep Dashboard (the hub — its uninitialized state shows the **Initialize Test Hub** call to action, so the wizard ribbon is redundant) and Test Console (the only surface needed mid-run). Everything else stays reachable via the command palette and dashboard quick actions. No tests reference the ribbons; `USE_CASE_VIEW_TYPE`, `SUITE_VIEW_TYPE`, and `EVIDENCE_EXPLORER_VIEW_TYPE` remain used by the view registrations in `main.ts`, so no imports change.

- [ ] **Step 1: Replace the ribbon block in `src/main.ts`**

Replace the entire block from the comment at line 581 through the Evidence Explorer ribbon (line 608):

```ts
    // Ribbon icons stay in the composition root (they are plugin chrome, not
    // command bodies).
    this.addRibbonIcon("flask-conical", "Initialize Test Hub", () => this.openWizard());
    this.addRibbonIcon(
      "list-checks",
      "Open Use Cases",
      () => void this.workspaceAdapter.openView(USE_CASE_VIEW_TYPE),
    );
    this.addRibbonIcon(
      "layers",
      "Open Test Suites",
      () => void this.workspaceAdapter.openView(SUITE_VIEW_TYPE),
    );
    this.addRibbonIcon(
      "terminal",
      "Open Test Console",
      () => void this.workspaceAdapter.openView(TEST_CONSOLE_VIEW_TYPE, "sidebar"),
    );
    this.addRibbonIcon(
      "gauge",
      "Open Test Hub dashboard",
      () => void this.workspaceAdapter.openView(DASHBOARD_VIEW_TYPE),
    );
    this.addRibbonIcon(
      "history",
      "Open Evidence Explorer",
      () => void this.workspaceAdapter.openView(EVIDENCE_EXPLORER_VIEW_TYPE),
    );
```

with:

```ts
    // Ribbon icons stay in the composition root (they are plugin chrome, not
    // command bodies). Default chrome is deliberately minimal (2026-06-11
    // review §4 product call): Dashboard + Test Console only — the dashboard
    // is the hub (incl. the Initialize call to action when uninitialized);
    // every other surface stays reachable via the command palette and the
    // dashboard's quick actions.
    this.addRibbonIcon(
      "gauge",
      "Open Test Hub dashboard",
      () => void this.workspaceAdapter.openView(DASHBOARD_VIEW_TYPE),
    );
    this.addRibbonIcon(
      "terminal",
      "Open Test Console",
      () => void this.workspaceAdapter.openView(TEST_CONSOLE_VIEW_TYPE, "sidebar"),
    );
```

- [ ] **Step 2: Fix the generated-doc copy**

In `src/application/content/documentation-content.ts`, replace:

```ts
1. **Initialize** the Test Hub (ribbon flask icon or **Initialize Test Hub**).
```

with:

```ts
1. **Initialize** the Test Hub (the **Initialize Test Hub** command, or the dashboard's call to action).
```

- [ ] **Step 3: Add the CHANGELOG entry**

In `CHANGELOG.md` under `## [Unreleased]` → `### Changed`, add:

```markdown
- Default ribbon chrome trimmed from six icons to two — Dashboard and Test
  Console (2026-06-11 review §4 product call). All other views remain
  reachable via the command palette and the dashboard's quick actions.
```

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all green (in particular no unused-import lint errors in `main.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/application/content/documentation-content.ts CHANGELOG.md
git commit -m "feat: trim default ribbon icons to Dashboard + Test Console (pre-V2 0.1)"
```

---

### Task 6: Document BRAT as the official distribution channel (item 0.1)

**Files:**
- Modify: `README.md` (after the Status blockquote, line 24)
- Modify: `CHANGELOG.md`

GitHub releases installed via the BRAT plugin are the official channel; community-marketplace submission is deferred indefinitely (proposal §5.3 non-goal). `release.yml` already publishes the three assets BRAT needs (`manifest.json`, `main.js`, `styles.css`).

- [ ] **Step 1: Add the Installation section to `README.md`**

Insert after the Status blockquote (after line 24, before `## Working from the UI`):

```markdown
## Installation

The plugin is distributed via **GitHub releases** and installed with
[BRAT](https://github.com/TfTHacker/obsidian42-brat) (Beta Reviewer's
Auto-update Tool). Submission to the Obsidian community marketplace is
deliberately deferred — this repository is the source of truth.

1. Install **BRAT** from the Obsidian community plugin store and enable it.
2. In BRAT: **Add beta plugin** → enter `Luis85/specorator-testrunner` →
   pick the latest release.
3. Enable **E2E Test Hub** under *Settings → Community plugins*.

BRAT auto-updates the plugin on new releases. The plugin is desktop-only
(it spawns Node child processes to run tests; see
[What this plugin does on your machine](#what-this-plugin-does-on-your-machine)).
Requires Node.js and npm available on your `PATH` for the test runner.
```

- [ ] **Step 2: Add the CHANGELOG entry**

In `CHANGELOG.md` under `## [Unreleased]` → `### Added`, add as the first bullet:

```markdown
- Installation documentation: GitHub releases + BRAT are the official
  distribution channel (community-marketplace submission deferred
  indefinitely, per the V2 proposal §5.3).
```

- [ ] **Step 3: Verify**

Run: `npm run format:check`
Expected: exits 0 (prettier checks Markdown; run `npm run format` first if it flags the new section).

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document BRAT installation as the official distribution channel (pre-V2 0.1)"
```

---

### Task 7: Cut version 1.0.0 (item 0.1)

**Files:**
- Modify: `manifest.json`, `versions.json`, `package.json`, `package-lock.json`
- Modify: `CHANGELOG.md`, `README.md:8`

`release.yml` verifies tag == `manifest.json` version, and `tests/integration/release-validation.test.ts` asserts `manifest.version === package.version` and `versions.json[manifest.version] === minAppVersion` — all three must move together. The `0.0.1` entry in `versions.json` stays (harmless; the CHANGELOG keeps its section as historical record).

- [ ] **Step 1: Bump package.json + lockfile**

Run: `npm version 1.0.0 --no-git-tag-version`
Expected: prints `v1.0.0`; `package.json` and `package-lock.json` now read `1.0.0`.

- [ ] **Step 2: Bump the plugin manifest**

In `manifest.json`, change `"version": "0.0.1"` to `"version": "1.0.0"`.

In `versions.json`, add the new mapping (keep the existing line):

```json
{
  "0.0.1": "1.13.0",
  "1.0.0": "1.13.0"
}
```

- [ ] **Step 3: Cut the CHANGELOG**

In `CHANGELOG.md`, rename the `## [Unreleased]` heading to `## [1.0.0] — <today's date, run: date +%F>` and add a fresh empty `## [Unreleased]` heading above it.

- [ ] **Step 4: Update the README status note**

Replace line 8's opening:

```markdown
> **Status:** In development; the V1 feature set is implemented end to end.
```

with:

```markdown
> **Status:** V1 released (1.0.0) — distributed via GitHub releases + BRAT
> (see [Installation](#installation)).
```

(keep the rest of the blockquote unchanged).

- [ ] **Step 5: Verify with the full PR gate**

Run: `npm run lint && npm run format:check && npm run typecheck && npm run build && npm run test:coverage`
Expected: all green — `release validation: manifest contract` proves the three version files agree.

- [ ] **Step 6: Commit and push**

```bash
git add manifest.json versions.json package.json package-lock.json CHANGELOG.md README.md
git commit -m "release: cut 1.0.0 (pre-V2 0.1)"
git push -u origin claude/specorator-v2-increment-g137m7
```

---

### Task 8: Release runbook (manual, after the PR merges)

These steps run on `main` after review/merge — they are the human gates, not PR work.

- [ ] **Step 1: Confirm the smoke gate ran green on the PR.** Because Task 3 puts `.github/workflows/e2e-smoke.yml` in the watched surface, this PR auto-triggers the smoke matrix (ubuntu + windows) — both legs must be green before merge. This validates items 0.2a/0.2b end to end.
- [ ] **Step 2: Merge the PR** (CI quality job is now blocking — a green merge also validates item 0.4).
- [ ] **Step 3: Tag the release:**

```bash
git checkout main && git pull origin main
git tag 1.0.0
git push origin 1.0.0
```

- [ ] **Step 4: Verify `release.yml`:** the tag-triggered run must pass the tag/manifest check, lint, typecheck, coverage, build, and publish a `1.0.0` GitHub release with exactly `manifest.json`, `main.js`, `styles.css` attached.
- [ ] **Step 5: Validate the BRAT path in a scratch vault:** install BRAT → Add beta plugin → `Luis85/specorator-testrunner` → enable E2E Test Hub → run the Initialization Wizard → run the demo test green. This is the baseline V2's `.testrunner` migration will upgrade *from*.

---

## Phase 0 exit criteria (from the proposal §9)

- [ ] V1 is tagged and released from this repository; BRAT install documented and validated (0.1)
- [ ] Ribbon trim shipped with the V1 release (0.1)
- [ ] `e2e-smoke` caches browsers per OS and auto-runs on runner-template changes; green on ubuntu + windows (0.2)
- [ ] `release.yml` actions SHA-pinned (0.3)
- [ ] Quality gates blocking: fallow audit fails the build on introduced findings; no warn-level lint rules remain; TD-006 resolved (0.4)

**Next increment after this gate:** §9 Phase 1 ("Clear recorded debt V2 builds on", items 1.1–1.12), then Phase 2 foundations, then the Phase 3 playwright-bdd migration — only after which V2.0 feature work begins.
