# TD-008 Fallow Refactor Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task ends by re-running the gate: `npm test` + `npx fallow audit --base origin/main` (coverage at `./coverage`, regenerate with `npm run test:coverage` if stale).

**Goal:** Clear the pre-existing fallow findings in the 10 files TD-008 lists so their stale `cucumber-js` comments can be re-applied without tripping the blocking `quality` gate.

**Architecture:** Decompose the two genuinely-complex functions, extract the (small) duplicated helpers, and `fallow-ignore` the irreducible view-method CRAP with a why-comment + TD cross-ref. Behaviour is preserved — the 1051-test suite + `fallow audit` are the gates. Then re-apply the deferred `cucumber-js → playwright-bdd` comment edits.

**Tech Stack:** TypeScript, vitest, fallow (audit gate), prettier/eslint/tsc.

---

## Ground truth (fallow, 2026-06-14, coverage-backed)

Verdict-driving findings (complexity incl. CRAP, duplication). `unused-class-members` is `warn` in `.fallowrc.jsonc` → the 8 dead-code items are NOT verdict-driving (verify, don't pre-suppress).

| Finding | Location | Fix |
| --- | --- | --- |
| `assertSafe` cyclo 25 / cog 33 | `domain/policies/command-safety-policy.ts:42` | decompose into per-program validators |
| `tokenizeCommand` cog 23 | `application/services/test-execution-service.ts:137` | extract the quote-state step |
| clone (blank-trim helper, ~5 lines) | `content/gherkin.ts` ↔ `views/feature-editor-format.ts` | extract shared util |
| clone (~14 lines) | `services/runner-installation-service.ts:99` ↔ `services/test-execution-service.ts:367` | extract shared helper |
| clone (~6 lines) | `services/suite-service.ts:129` ↔ `services/use-case-service.ts:165` | extract shared helper |
| clones (internal + w/ specification-service) | `services/feature-insight-service.ts:178/199` | extract shared helper(s) |
| clones (~12 lines ×2) | `views/create-suite-modal.ts` ↔ `views/create-use-case-modal.ts` | extract shared modal helper |
| clone (~20 lines, internal) | `domain/onboarding/tour-steps.ts:257/480` | extract shared helper |
| clones (internal ×2) | `views/feature-editor-view.ts:592/601` | extract shared helper |
| CRAP ≥30: `refreshValidation` 56, `populateDatalists` 30, `renderScenarioCard` 30 | `views/feature-editor-view.ts` | `fallow-ignore-next-line complexity` (DOM render, integration-tested) + TD cross-ref |
| CRAP 30: `submit` | `views/create-suite-modal.ts:128` | decompose or `fallow-ignore` |

Deferred stale comments to re-apply (from TD-008): the `npm→node→Cucumber` process-tree wording (`node-child-process-runner`), suite `--tags`→`BDD_TAGS` (`suite-service`), the `cucumber.mjs`/`--format` example (`test-execution-service`), `Cucumber/tsx`→`Playwright/bddgen` (`command-safety-policy`), the tag-expression qualifier + Gherkin-parser actor swaps (`feature-insight-service`, `feature-editor-view`, `feature-editor-format`, `gherkin`, `create-suite-modal`, `tour-steps`). Exact strings: see PR #48 reverted diff (commit 7cb0d73).

---

## Task 1: Decompose `assertSafe` (command-safety-policy.ts)

**Files:** Modify `src/domain/policies/command-safety-policy.ts`; Test `tests/command-safety-policy.test.ts` (existing, must stay green).

- [ ] Extract three private module helpers — `validateNode(rest, disallow)`, `validateNpm(rest, display, disallow)`, `validateNpx(rest, display, disallow)` — each returning `Result<void>`, lifting the matching `case` body verbatim. `assertSafe` keeps the empty/control-char/basename/path guards then dispatches on `basename`.
- [ ] Re-apply the comment fix: `Cucumber/tsx run *inside* an npm script.` → `Playwright/bddgen run *inside* an npm script.`
- [ ] Gate: `npm test` (command-safety tests pass) + `npx fallow audit --base origin/main` shows no complexity finding for this file.
- [ ] Commit: `refactor: decompose assertSafe into per-program validators (TD-008)`

## Task 2: Decompose `tokenizeCommand` (test-execution-service.ts)

**Files:** Modify `src/application/services/test-execution-service.ts`; Test `tests/test-execution-service.test.ts`.

- [ ] Extract the per-character quote/escape handling into a small pure helper so `tokenizeCommand` drops below cognitive 15.
- [ ] Re-apply the comment fix: replace the `--format "json:reports/cucumber report.json"` JSDoc example with the playwright-bdd `--grep "Open Example Page"` example (see commit 7cb0d73).
- [ ] Gate: `npm test` + audit clean for this file.
- [ ] Commit: `refactor: simplify tokenizeCommand quote handling (TD-008)`

## Task 3: Extract shared clones (one commit per group)

**For each clone group:** create/reuse a shared helper in the nearest appropriate module (prefer `src/shared/utils/` for cross-context helpers; a local non-exported helper for same-module clones), import at both sites, delete the duplicates.

- [ ] 3a. Blank-trim helper → `src/shared/utils/` (e.g. `trimBlankEdges(lines)`); import in `gherkin.ts` + `feature-editor-format.ts`.
- [ ] 3b. `runner-installation-service` ↔ `test-execution-service` (14-line block).
- [ ] 3c. `suite-service` ↔ `use-case-service` (6-line block).
- [ ] 3d. `feature-insight-service` internal + `↔ specification-service`.
- [ ] 3e. `create-suite-modal` ↔ `create-use-case-modal` (modal field helper).
- [ ] 3f. `tour-steps` internal (20-line block).
- [ ] 3g. `feature-editor-view` internal (two small blocks).
- [ ] After each: `npm test` + `npx fallow find_dupes` confirms the group is gone; commit `refactor: extract shared <name> (TD-008)`.

## Task 4: Suppress irreducible CRAP + re-apply remaining comments

**Files:** `views/feature-editor-view.ts`, `views/create-suite-modal.ts`, plus the comment-only files (`node-child-process-runner.ts`, `suite-service.ts`, `feature-insight-service.ts`, `gherkin.ts`, `feature-editor-format.ts`, `tour-steps.ts`).

- [ ] For each view method still flagged CRAP after Task 3 (`refreshValidation`, `populateDatalists`, `renderScenarioCard`, `submit`): add `// fallow-ignore-next-line complexity` with a why-comment (DOM-render method, integration-tested via the view; tracked in TD-008).
- [ ] Re-apply the remaining deferred `cucumber-js → playwright-bdd` comment edits in every still-stale file (exact strings from commit 7cb0d73), keeping the cucumber-JSON *report format* references.
- [ ] Gate: `npm test` + `npx fallow audit --base origin/main` → **✓ No issues**; `npm run typecheck`, `npm run lint`, `npm run format:check` all clean.
- [ ] Commit: `chore: re-apply cucumber-js comment sweep in the (now gate-clean) files (TD-008)`

## Task 5: Close out TD-008

- [ ] Update `docs/tech-debt/TD-008.md` front-matter `status: open → resolved` and move it to the README's Resolved table, noting the resolving PR. Note any `fallow-ignore` suppressions added (Task 4) as the residual (cross-ref TD-007's "suppress, not solve" caveat).
- [ ] Push `claude/td-008-fallow-refactor`, open a ready-for-review PR to main.

---

## Self-review notes
- **Behaviour-preserving:** every task is guarded by the existing suite (1051 tests) + audit; no logic changes, only structure + comments.
- **Scope honesty:** Task 4 trades a small amount of `fallow-ignore` debt (view CRAP) for re-applying the comments; recorded in TD-008 so it is visible, not silent.
- **Security:** Task 1 touches `assertSafe` (P0-1) — pure extraction, identical branches, full test coverage; no allowlist change.
