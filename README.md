# Obsidian E2E Test Hub

An Obsidian plugin that lets users **define, manage, execute, and document
end-to-end tests** directly inside their vault — combining Use Cases, Gherkin
specifications, test suites, Playwright execution, evidence, and CI/CD into a
single Markdown-native, local-first workflow.

> **Status:** Draft / Discovery. The product direction is captured in the
> [PRD](./docs/issues/PRD.md). The codebase is an empty plugin shell ready to
> be built out against the PRD.

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
├── docs/
│   ├── issues/
│   │   └── PRD.md         # Product requirements (source of truth)
│   └── architecture/
│       └── SDD.md         # Solution design
└── .github/workflows/
    └── ci.yml             # Typecheck + build on push / PR
```

## Documents

- [PRD](./docs/issues/PRD.md) — product requirements (source of truth for scope).
- [SDD](./docs/architecture/SDD.md) — solution design (architecture, domain model, events).

## Development

Requires Node 20+.

```bash
npm install        # install dependencies
npm run dev        # esbuild watch mode
npm run build      # production bundle (main.js)
npm run typecheck  # tsc --noEmit
```

## License

MIT
