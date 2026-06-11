# Obsidian E2E Test Hub

An Obsidian plugin that lets users **define, manage, execute, and document
end-to-end tests** directly inside their vault — combining Use Cases, Gherkin
specifications, test suites, Playwright execution, evidence, and CI/CD into a
single Markdown-native, local-first workflow.

> **Status:** In development; the V1 feature set is implemented end to end.
> The product direction is captured in the
> [PRD](./docs/Obsidian%20E2E%20Test%20Hub.md). Implemented:
> **EPIC-001/002 (Foundation & Initialization)** — the layered plugin skeleton,
> settings service + UI, and the Initialization Wizard; **EPIC-003 (Test
> Runner)** — generating, installing, validating, and repairing the
> self-contained `.testrunner` project; **EPIC-004 (Use Case Management)** —
> Use Case creation, indexing, explorer, and detail view; **EPIC-005
> (Specification Management)** — Gherkin Feature generation, validation,
> missing-step detection, and step-definition generation; **EPIC-006 (Test
> Suite Management)** — tag-expression suites with a live suite explorer;
> **EPIC-007 (Test Execution)** — streaming runs with cancel/re-run in the
> Test Console; **EPIC-008 (Reporting & Evidence)** — report import, Evidence
> notes, and the Evidence Explorer over the partitioned run history;
> **EPIC-009 (Dashboard)** — KPI roll-up, quick actions, and recent runs; and
> **EPIC-010 (CI/CD)** — GitHub Actions workflow generation and CI-readiness
> checks.

## Working from the UI

The Test Hub is designed so a non-technical user can run the whole
requirements-to-evidence loop without the command palette. Power users keep
every command, but each one is also reachable through a view:

- **Dashboard (home/hub).** Lands on a quick-action bar (New Use Case / New Test
  Suite, Run all / Run demo, Generate documentation, and Open the explorers),
  an active-environment badge with a one-click switcher, KPI tiles, and recent
  runs that link straight to their Evidence note. Before the vault is
  initialized it shows a single prominent **Initialize Test Hub** call to
  action.
- **Use Case detail.** Opening a Use Case shows its Feature Specifications with
  per-Feature **Open / Run / Validate / Detect missing steps / Generate step
  definitions** actions (results render inline), a **Generate Feature** button,
  and **Run Use Case** — the full spec-to-run authoring workflow in one place.
- **Test Console.** A toolbar with **Cancel run** (enabled only while a run is
  active), **Re-run**, and **Clear**, plus a live elapsed timer and the run's
  scope, over the streaming output.
- **Guided Tour.** A right-sidebar checklist that teaches the full loop by
  doing: each step explains why it matters, offers the real action button and
  copy-paste snippets, and completes by itself (via domain events) when the
  user performs the action — ending with a self-authored greeting test run
  green. Reachable via **Open Guided Tour**, the wizard's success screen, and
  a dashboard call to action.
- **Settings.** A **System under test** section to add/remove environments and
  edit their base URL and credential variables (validation errors shown
  inline), plus **Validate environment**, **Repair installation**, **Generate CI
  workflow**, and **Check CI readiness** with inline result checklists.

## Vision

Enable teams to transform requirements into executable specifications and
continuously verify software quality without leaving Obsidian:

Requirements → Specification → Automation → Execution → Evidence → CI

The plugin acts as a Business-Driven Development (BDD) workbench where product
owners, business analysts, QA engineers, developers, and delivery managers
collaborate on Markdown artifacts that are git-friendly and CI-ready.

## Product principles

| ID  | Principle          | Description                                |
| --- | ------------------ | ------------------------------------------ |
| P1  | Markdown First     | All business artifacts are Markdown.       |
| P2  | Local First        | Everything runs locally.                   |
| P3  | Git Friendly       | All artifacts are version controllable.    |
| P4  | CI Ready           | Generated assets execute without Obsidian. |
| P5  | Zero Configuration | Users can get started immediately.         |

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

## What this plugin does on your machine

To run end-to-end tests locally, this plugin does a few things beyond editing
Markdown. They are disclosed here in line with Obsidian's Developer Policies:

- **Spawns external processes.** The plugin invokes `npm`, `npx`, and `node`
  (with `shell: false`, never through a shell) to install dependencies, install
  the browser, validate the environment, and run your tests. These executables
  must already be available on your system.
- **Downloads software over the network.** Installing the runner downloads npm
  packages (Playwright, Cucumber-JS, and their dependencies) and a Chromium
  browser via `playwright install`. This is the only network activity and it
  happens only when you trigger an install/repair; the plugin itself does not
  phone home.
- **Writes files outside the Obsidian vault index.** It creates and maintains a
  `.testrunner/` project folder (the self-contained Node test project) and, when
  you generate CI, a `.github/workflows/` file. These live inside your vault
  directory but are dot-folders that Obsidian does not index. Everything written
  is local and version-controllable; nothing leaves your machine except the
  package/browser downloads above.

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
├── versions.json          # Plugin version → minAppVersion map
├── package.json           # Plugin build + typecheck scripts
├── tsconfig.json          # TypeScript config (strict)
├── vitest.config.ts       # Vitest config (coverage gates per NFR-002)
├── eslint.config.mjs      # ESLint flat config (incl. layer-boundary rules)
├── esbuild.config.mjs     # esbuild bundler config
├── styles.css             # Plugin styles
├── src/
│   ├── main.ts            # Plugin entry point / composition root
│   ├── domain/            # Entities, value objects, policies, events, settings
│   ├── application/       # Services, ports, generated-content templates
│   ├── infrastructure/    # Obsidian, Node fs, child-process, runner adapters
│   ├── presentation/      # Views, modals, settings tab, commands
│   └── shared/            # Result, errors, EventBus, logging, utils
├── tests/                 # Vitest unit + integration suite (incl. __stubs__)
├── scripts/               # test-build.mjs, e2e-smoke.mjs (+ entry)
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
│   ├── issues/
│   │   ├── EPIC-001.md … EPIC-012.md   # Epics (12)
│   │   ├── FEAT-001.md … FEAT-028.md   # Features (28)
│   │   └── US-001.md … US-050.md       # User stories (50)
│   ├── reviews/                        # Consolidated review & improvement plans
│   └── superpowers/                    # Plans + specs from skill-driven sessions
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
    ├── ci.yml                     # Lint, format, typecheck, build, coverage
    ├── e2e-smoke.yml              # Opt-in E2E smoke over the real runner
    └── release.yml                # Tag-triggered release with plugin assets
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
npm install            # install dependencies
npm run dev            # esbuild watch mode
npm run build          # production bundle (main.js)
npm run typecheck      # tsc --noEmit (src, tests, and scripts)
npm run lint           # eslint (incl. layer-boundary import rules)
npm run format         # prettier --write
npm run format:check   # prettier --check
npm run test           # vitest unit + integration suite
npm run test:watch     # vitest watch mode
npm run test:coverage  # vitest with v8 coverage (NFR-002: ≥ 80%)
npm run test-build     # install the built plugin into a scratch vault
```

CI (`.github/workflows/ci.yml`) runs lint, format check, typecheck, build,
and the coverage-gated test suite on every push and pull request.

## License

MIT
