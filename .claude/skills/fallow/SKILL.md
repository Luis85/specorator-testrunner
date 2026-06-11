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
- Config is `.fallowrc.jsonc`. `unused-class-members` is warn-only here —
  Obsidian invokes lifecycle/`SuggestModal` overrides itself, so verify before
  deleting any "unused" class member.
- Do NOT enable fallow boundary rules; ESLint `no-restricted-imports` is the
  single authority for the layer boundaries (see `AGENTS.md`).
