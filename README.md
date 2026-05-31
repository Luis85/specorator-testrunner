# Obsidian E2E Test Hub

An Obsidian plugin that lets users **define, manage, execute, and document
end-to-end tests** directly inside their vault — combining Use Cases, Gherkin
specifications, test suites, Playwright execution, evidence, and CI/CD into a
single Markdown-native, local-first workflow.

> **Status:** In development. The product direction is captured in the
> [PRD](./docs/Obsidian%20E2E%20Test%20Hub.md). Implemented so far:
> **EPIC-001/EPIC-002 (Foundation & Initialization)** — the layered plugin
> skeleton, settings service + UI, and the Initialization Wizard that scaffolds
> the vault, generates documentation and demo content, and creates the default
> Smoke/Regression suites; and **EPIC-003 (Test Runner)** — generating the
> self-contained `.testrunner` project, installing npm dependencies and the
> Chromium browser, validating the environment, and repairing the installation;
> and **EPIC-004 (Use Case Management)** — creating Use Cases with generated
> frontmatter, indexing them from the vault, and a live "Use Cases" panel
> listing ID/Title/Status/Automation Status. Specification management
> (EPIC-005) is next.

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

## Repository layout

```
.
├── manifest.json          # Obsidian plugin manifest
├── package.json           # Plugin build + typecheck scripts
├── tsconfig.json          # TypeScript config (strict)
├── esbuild.config.mjs     # esbuild bundler config
├── styles.css             # Plugin styles
├── src/
│   └── main.ts            # Plugin entry point
├── CONTEXT.md                     # Glossary (per grill-with-docs skill)
├── docs/
│   ├── Obsidian E2E Test Hub.md   # Product Requirements (source of truth)
│   ├── architecture/
│   │   ├── Solution Design.md                     # Architecture of record
│   │   ├── Building Block View.md                 # Arc42 §5 building blocks
│   │   ├── Runtime View.md                        # Arc42 §6 runtime scenarios
│   │   ├── Technical Interface Specification.md   # TypeScript contracts
│   │   └── Event Catalog.md                       # V1 domain event catalog
│   ├── adr/
│   │   └── 0001-*.md … 0019-*.md       # Architectural decision records
│   ├── use-cases/
│   │   └── UC-001.md … UC-024.md       # One note per use case
│   └── issues/
│       ├── EPIC-001.md … EPIC-012.md   # Epics (12)
│       ├── FEAT-001.md … FEAT-028.md   # Features (28)
│       └── US-001.md … US-050.md       # User stories (50)
├── .claude/skills/
│   ├── grill-with-docs/                  # Stress-test plans against docs / glossary (mattpocock/skills)
│   ├── improve-codebase-architecture/    # Find deepening opportunities (mattpocock/skills)
│   ├── brainstorming/                    # Superpowers methodology (14 skills)
│   ├── test-driven-development/
│   ├── systematic-debugging/
│   ├── writing-plans/
│   ├── executing-plans/
│   ├── subagent-driven-development/
│   ├── dispatching-parallel-agents/
│   ├── verification-before-completion/
│   ├── using-superpowers/
│   ├── writing-skills/
│   ├── requesting-code-review/
│   ├── receiving-code-review/
│   ├── finishing-a-development-branch/
│   ├── using-git-worktrees/
│   └── NOTICE-superpowers.txt            # Upstream attribution + MIT license
└── .github/workflows/
    └── ci.yml                     # Typecheck + build on push / PR
```

## Documents

- [Obsidian E2E Test Hub](./docs/Obsidian%20E2E%20Test%20Hub.md) — Product Requirements (source of truth for scope).
- [CONTEXT.md](./CONTEXT.md) — Project glossary (used by the `grill-with-docs` skill).
- [Solution Design](./docs/architecture/Solution%20Design.md) — architecture, domain model, V1 architectural decisions.
- [Building Block View](./docs/architecture/Building%20Block%20View.md) — Arc42 §5 building blocks (views, services, adapters, runner internals).
- [Runtime View](./docs/architecture/Runtime%20View.md) — Arc42 §6 runtime scenarios with Mermaid sequence diagrams.
- [Technical Interface Specification](./docs/architecture/Technical%20Interface%20Specification.md) — TypeScript contracts: shared types, domain, repositories, services, ports, frontmatter schemas, runner + CI templates.
- [Event Catalog](./docs/architecture/Event%20Catalog.md) — V1 domain events, envelope, EventBus contract.

Use cases live as individual notes under `docs/use-cases/UC-NNN.md`. Backlog items live under `docs/issues/{EPIC,FEAT,US}-NNN.md`. Architectural decision records live under `docs/adr/NNNN-*.md`. Per-domain indexes will return via Obsidian Bases once the plugin lands.

## Development

Requires Node 20+.

```bash
npm install        # install dependencies
npm run dev        # esbuild watch mode
npm run build      # production bundle (main.js)
npm run typecheck  # tsc --noEmit
npm run test       # vitest unit + integration suite
npm run test:coverage  # vitest with v8 coverage (NFR-002: ≥ 80%)
```

## License

MIT
