# Obsidian E2E Test Hub

An Obsidian plugin that lets users **define, manage, execute, and document
end-to-end tests** directly inside their vault — combining Use Cases, Gherkin
specifications, test suites, Playwright execution, evidence, and CI/CD into a
single Markdown-native, local-first workflow.

> **Status:** Draft / Discovery. The product direction is captured in the
> [PRD](./docs/issues/PRD.md). The codebase is early scaffolding — see
> [Current state](#current-state) below.

## Vision

Enable teams to transform requirements into executable specifications and
continuously verify software quality without leaving Obsidian:

Requirements → Specification → Automation → Execution → Evidence → CI

The plugin acts as a Business-Driven Development (BDD) workbench where product
owners, business analysts, QA engineers, developers, and delivery managers
collaborate on Markdown artifacts that are git-friendly and CI-ready.

## Product principles

| ID | Principle | Description |
| --- | --- | --- |
| P1 | Markdown First | All business artifacts are Markdown. |
| P2 | Local First | Everything runs locally. |
| P3 | Git Friendly | All artifacts are version controllable. |
| P4 | CI Ready | Generated assets execute without Obsidian. |
| P5 | Zero Configuration | Users can get started immediately. |

## High-level architecture

```
Obsidian Plugin
│
├── Dashboard
├── Use Case Management
├── Specification Management
├── Test Suite Management
├── Runner Management
├── Report Viewer
└── Documentation
            │
            ▼
.testrunner
├── Playwright
├── Cucumber
├── TypeScript
├── Reports
├── Screenshots
└── Traces
```

The Obsidian plugin authors and orchestrates. The `.testrunner` folder in the
vault holds a self-contained Node project that runs Playwright + Cucumber-JS
and can also be executed standalone from CI.

## Vault layout

```
Vault
├── Test Hub
│   ├── Dashboard.md
│   ├── Getting Started.md
│   ├── User Manual.md
│   └── Troubleshooting.md
├── Use Cases
├── Specifications
│   └── features
├── Test Suites
├── Test Evidence
└── .testrunner
```

## Current state

The repository currently contains an earlier engine-first scaffold (see
[`DESIGN.md`](./DESIGN.md) for the design of record from that pass). It is
being re-aligned to the PRD direction described above.

Existing workspace packages:

```
packages/
  engine/   gherkin parse, vocabulary, driver, runner, reporting (Vitest tests)
  plugin/   Obsidian plugin shell
  cli/      headless runner entry point
  mcp/      local MCP server entry point
```

The PRD calls for a single Obsidian plugin plus a `.testrunner` runner folder
generated into the user's vault. Mapping the existing packages onto that
target — and what gets kept, renamed, or removed — is the next item to iterate
on.

## Documents

- [PRD](./docs/issues/PRD.md) — product requirements (this is the source of truth for scope).
- [DESIGN.md](./DESIGN.md) — prior design exploration, retained for context.

## Development

Requires Node 20+.

```bash
npm install        # install workspace deps
npm run build      # build all packages
npm run typecheck  # type-check all packages
```

## License

MIT
