# AGENTS.md

Project-specific context for coding agents. Keep it short and update it when
workflows change. Conventions live in `CONTRIBUTING.md`; the product language
lives in `CONTEXT.md` — read both before changing code.

## Project Overview

- Obsidian plugin (TypeScript, esbuild-bundled): a Markdown-native BDD
  workbench that generates and drives a self-contained Playwright +
  Cucumber-JS runner (`.testrunner`) inside a vault.
- Main entry point: `src/main.ts` (composition root). Standalone script entry:
  `scripts/e2e-smoke-entry.ts` (esbuild-bundled by `scripts/e2e-smoke.mjs`).
- Layers: `src/domain` → `src/application` → `src/infrastructure` /
  `src/presentation`, with `src/shared` as the kernel. Boundaries are enforced
  by ESLint `no-restricted-imports` — fallow's boundary rules are deliberately
  off; ESLint is the single authority.

## Commands

- Install: `npm install` · Build: `npm run build` · Test: `npm test`
- Full PR gate: `npm run lint && npm run format:check && npm run typecheck && npm run build && npm run test:coverage`
- Quality evidence (fallow): `npm run quality` (full), `npm run quality:audit`
  (changed-code verdict), `npm run quality:health`, `npm run quality:dead-code`,
  `npm run quality:dupes`

## Fallow

Use fallow for structured codebase evidence instead of inferring from grep.
The MCP server is registered in `.mcp.json` (`fallow-mcp`, stdio); the
version-matched skill is at `node_modules/fallow/skills/fallow/SKILL.md`.

- Run `npm run quality:audit` before requesting review of generated changes;
  the verdict gates on findings _introduced by_ the changeset.
- `fallow <cmd> --format json --quiet` for machine-readable output; issues
  carry an `actions` array with `auto_fixable` flags.

Local caveats (configured in `.fallowrc.jsonc`):

- `unused-class-members` is warn-only: Obsidian itself invokes lifecycle and
  `SuggestModal` overrides (`onChooseItem`, `getItems`, `hide`, `getState`, …),
  so treat such findings as suspect before deleting anything.
- esbuild script entries are invisible to auto-detection; if a script bundles
  a new entry file, add it to `entry` in `.fallowrc.jsonc`.

## Agent Rules

- Fallible operations return `Result<T>` (`src/shared/result/result.ts`) with
  typed `AppError` codes — never throw across service boundaries.
- Views stay thin: testable logic goes in `*-rows.ts` / `*-format.ts`
  projections; services and projections get unit tests in `tests/`, views do
  not.
- Comments explain constraints and why, not what; match existing density.
- Architecture-shaping decisions need an ADR in `docs/adr/`; keep `CONTEXT.md`
  in sync when terminology shifts.
