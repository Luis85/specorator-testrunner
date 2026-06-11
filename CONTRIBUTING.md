# Contributing

Thanks for your interest in the Obsidian E2E Test Hub.

## Getting started

Requires Node 20+.

```bash
npm install            # install dependencies
npm run dev            # esbuild watch mode
npm run test:watch     # vitest watch mode
```

Before opening a pull request, make sure the full gate passes locally — CI
runs exactly these:

```bash
npm run lint           # eslint, incl. layer-boundary import rules
npm run format:check   # prettier
npm run typecheck      # tsc over src, tests, and scripts
npm run build          # production bundle
npm run test:coverage  # vitest with enforced coverage thresholds (NFR-002)
```

## Quality evidence

[fallow](https://github.com/fallow-rs/fallow) provides deterministic quality
evidence on top of the gate (config: `.fallowrc.jsonc`). CI runs the
changed-code audit advisorily on every PR; locally:

```bash
npm run quality:audit      # changed-code risk verdict vs. origin/main — run before requesting review
npm run quality            # full analysis: health + duplication + cleanup opportunities
npm run quality:health     # health score and grade
npm run quality:dead-code  # unused files/exports/deps (NB: Obsidian lifecycle
                           # overrides are warn-only false-positive candidates)
npm run quality:dupes      # clone groups
```

Coding agents get the same evidence through the fallow MCP server
(`.mcp.json`) and skill — see `AGENTS.md`.

## Project conventions

- **Read `CONTEXT.md` first.** The glossary terms (Use Case, Test Suite,
  `.testrunner`, Test Run, Evidence, …) are the product language; user-facing
  copy and code identifiers must use them, and each entry lists terms to
  avoid.
- **Layered architecture.** `domain` → `application` → `infrastructure` /
  `presentation`, with `shared` as the kernel. The boundaries are enforced by
  ESLint `no-restricted-imports` rules; I/O goes through ports in
  `src/application/ports/` implemented under `src/infrastructure/`.
- **Errors are `Result`s.** Services return the `Result` type from
  `src/shared/result/result.ts` with typed `AppError` codes; don't throw
  across service boundaries.
- **Events are facts.** Past-tense domain events on the in-process EventBus,
  catalogued in `docs/architecture/Event Catalog.md`. Payload shapes are
  compiler-enforced via the `EventPayloads` map.
- **Tests live in `tests/`**, built on the hand-written fakes in
  `tests/fakes.ts` and the Obsidian stub in `tests/__stubs__/`. New service
  logic needs unit tests; pure presentation logic is extracted into testable
  `*-rows.ts` / `*-format.ts` projections.
- **Documentation is part of the change.** Architecture-shaping decisions get
  an ADR in `docs/adr/`; smaller reconciliations update the relevant
  `docs/architecture/` section. Keep `CONTEXT.md` in sync when terminology
  shifts.

## Releases

Releases are tag-driven (`.github/workflows/release.yml`): bump
`manifest.json`, `package.json`, and `versions.json` together — the release
workflow refuses a tag that doesn't match `manifest.json`, and the
release-validation tests assert the three files agree.
