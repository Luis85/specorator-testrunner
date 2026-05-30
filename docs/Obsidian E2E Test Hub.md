# Obsidian E2E Test Hub

> Product Requirements Document — V1 MVP.

- **Version:** 1.0
- **Status:** Draft
- **Stage:** Discovery
- **Target Platform:** Obsidian Desktop
- **Technology Stack:** TypeScript, Obsidian Plugin API, Playwright, Cucumber-JS, Node.js
- **Companion documents:** [[Solution Design]], [[Building Block View]], [[Runtime View]], [[Technical Interface Specification]], [[Event Catalog]]

---

## 1. Executive Summary

The Obsidian E2E Test Hub enables users to define, manage, execute, and document end-to-end tests directly from within Obsidian.

The plugin combines:

- Use Cases
- Gherkin Specifications
- Test Suites
- Playwright Execution
- Test Evidence
- CI/CD Integration

into a single integrated workflow.

The plugin serves as a Business-Driven Development (BDD) workbench where product owners, business analysts, testers, and developers collaborate using Markdown-native artifacts.

The plugin must provide a complete out-of-the-box experience and allow a user to execute a working E2E test immediately after installation and initialization.

---

## 2. Product Vision

Enable users to transform requirements into executable specifications and continuously verify software quality without leaving Obsidian.

The plugin shall act as the bridge between:

Requirements Engineering → Specification → Automation → Execution → Evidence → Continuous Integration

---

## 3. Goals

| ID | Goal |
| --- | --- |
| G1 | Provide a complete E2E testing workbench inside Obsidian. |
| G2 | Provide executable Gherkin specifications. |
| G3 | Provide Playwright-based automation. |
| G4 | Provide CI-ready test assets. |
| G5 | Provide complete traceability: Use Case → Feature → Test Run → Evidence. |
| G6 | Work out-of-the-box after installation. |

---

## 4. Non Goals

| ID | Non Goal |
| --- | --- |
| NG1 | Not a test framework. Playwright remains the execution engine. |
| NG2 | Not a CI server. |
| NG3 | Not a browser automation recorder. |
| NG4 | Not a replacement for Playwright UI. |

---

## 5. Personas

| Persona | Responsibility |
| --- | --- |
| Product Owner | Creates and maintains Use Cases. |
| Business Analyst | Defines specifications. |
| QA Engineer | Creates automated tests. |
| Developer | Implements step definitions. |
| Delivery Manager | Tracks test coverage and quality. |

---

## 6. Product Principles

| ID | Principle | Description |
| --- | --- | --- |
| P1 | Markdown First | All business artifacts must be Markdown. |
| P2 | Local First | Everything runs locally. |
| P3 | Git Friendly | All artifacts are version controllable. |
| P4 | CI Ready | Generated assets must execute without Obsidian. |
| P5 | Zero Configuration | Users can get started immediately. |

---

## 7. High-Level Architecture

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

---

## 8. Folder Structure

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

---

## 9. Functional Requirements

### FR-001 Dashboard

The system shall provide a dedicated Test Hub dashboard.

Features:

- KPIs
- Test status overview
- Recent runs
- Use Case statistics
- Suite statistics

### FR-002 Initialization Wizard

The system shall provide a setup wizard.

The wizard shall:

- create folders
- generate documentation
- generate demo content
- create default suites (Smoke, Regression)
- install runner
- install dependencies
- install browsers
- verify installation

### FR-003 Use Case Management

The system shall allow creation and management of Use Cases.

Each Use Case shall contain:

- identifier
- title
- description
- linked feature
- linked evidence
- automation status

### FR-004 Gherkin Management

The system shall allow creation and management of feature files.

Supported:

- Feature
- Scenario
- Scenario Outline
- Examples
- Tags

### FR-005 Test Suite Management

The system shall allow grouping scenarios into suites via Cucumber tag expressions (see SDD AD-4).

Default suites — created automatically by the init wizard:

- **Smoke** (`@smoke`) — contains the demo scenario.
- **Regression** (`@regression`) — empty until the user tags scenarios.

### FR-006 Runner Installation

The system shall create a self-contained runner inside `.testrunner`.

### FR-007 Runner Validation

The system shall verify:

- NodeJS
- npm
- Playwright
- Browser installation — Chromium (per SDD AD-5)
- `package.json`
- feature discovery

### FR-008 Test Execution

The system shall support:

- Run Use Case
- Run Feature
- Run Suite
- Run All

### FR-009 Live Execution View

The system shall display:

- execution status
- console output
- pass/fail count
- duration

### FR-010 Test Reports

The system shall import and display:

- screenshots
- traces
- logs
- summary reports

### FR-011 Evidence Generation

The system shall generate Markdown evidence.

Example:

```markdown
# Test Evidence
Result: Passed
Date: 2026-06-01
Scenario:
Open Example Page
Screenshots:
...
Trace:
...
```

### FR-012 Demo Project

The system shall generate:

- demo use case
- demo feature
- demo suite
- demo report

### FR-013 Documentation Generator

The system shall generate:

- Getting Started
- User Manual
- Troubleshooting

### FR-014 Settings

The system shall allow configuration of:

- Use Case folder
- Specification folder
- Evidence folder
- Runner folder
- Package manager *(V2 — V1 is fixed to `npm`, see SDD AD-2)*

### FR-015 CI Pipeline Generation

The system shall generate:

- GitHub Actions Workflow

Optional:

- Azure DevOps Pipeline

### FR-016 CI Validation

The system shall verify CI readiness.

Checks:

- `package.json`
- lock file
- test scripts
- reports folder

### FR-017 Traceability

The system shall maintain links:

Use Case → Feature → Suite → Test Run → Evidence

---

## 10. User Experience

### First Run

1. Install Plugin
2. Open Test Hub
3. Initialize Test Hub
4. Wait for installation
5. Run Demo Test
6. Review Evidence

Total time target: **< 5 minutes**

---

## 11. Settings

Default values:

```yaml
testHubPath: Test Hub
useCasesPath: Use Cases
specificationsPath: Specifications
featureFilesPath: Specifications/features
testSuitesPath: Test Suites
evidencePath: Test Evidence
testRunnerPath: .testrunner
```

---

## 12. Acceptance Criteria

Each AC is mapped to the mandatory MVP Use Case(s) it satisfies. Use Case notes live under `docs/use-cases/UC-NNN.md`.

| ID | Criterion | Covers |
| --- | --- | --- |
| AC-001 | User can initialize the Test Hub from the dashboard. | UC-001 |
| AC-002 | Default suites (Smoke, Regression) exist after init. | UC-001 |
| AC-003 | Documentation (Getting Started, User Manual, Troubleshooting) is generated during init. | UC-001 |
| AC-004 | Environment validation reports Node, npm, Playwright, and Chromium status. | UC-002 |
| AC-005 | User can create a Use Case. | UC-004 |
| AC-006 | User can generate a Feature Specification from a Use Case. | UC-006 |
| AC-007 | User can create a Test Suite with a tag expression. | UC-008 |
| AC-008 | User can generate step definition stubs for undefined Gherkin steps. | UC-010 |
| AC-009 | User can execute a Use Case and see results. | UC-011 |
| AC-010 | User can execute a Test Suite. | UC-013 |
| AC-011 | Live execution view streams runner output during a test run. | UC-015 |
| AC-012 | Evidence is generated after each run and linked to the originating Use Case. | UC-016 |
| AC-013 | Dashboard reflects execution results (KPIs, latest runs). | UC-018 |
| AC-014 | User can generate a GitHub Actions workflow at the repo root. | UC-019 |
| AC-015 | CI readiness check reports `package.json`, test scripts, and reports folder status. | UC-020 |
| AC-016 | User can open the Getting Started guide and the User Manual from the dashboard. | UC-021, UC-022 |
| AC-017 | Runner executes independently from Obsidian (local and CI). | AG-002, AG-004 |
| AC-018 | Demo test executes successfully on first run. | UC-001 + UC-011 |

---

## 13. Non Functional Requirements

| ID | Requirement |
| --- | --- |
| NFR-001 | TypeScript Strict Mode. |
| NFR-002 | Vitest coverage >= 80%. |
| NFR-003 | ESLint clean. |
| NFR-004 | Prettier compliant. |
| NFR-005 | Full Typedoc coverage. |
| NFR-006 | No cloud dependency. |
| NFR-007 | Works offline. |
| NFR-008 | Git compatible. |

---

## 14. Future Roadmap

### V2

- Visual Scenario Editor
- Step Definition Generator
- AI-assisted Step Suggestions
- Coverage Dashboard
- Azure DevOps Integration
- Jira Integration

### V3

- Multi-project support
- Test Recorder
- Visual Test Builder
- Browser Matrix
- Distributed Execution

---

## 15. Definition of Done

The increment is complete when:

- Demo environment works
- Demo test passes
- CI execution passes
- Documentation generated
- User manual generated
- Dashboard operational
- Traceability operational
- Automated tests passing
- Code review completed
- Release package generated
