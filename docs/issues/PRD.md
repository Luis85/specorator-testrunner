# Product Requirements Document (PRD)

## Obsidian E2E Test Hub

- **Version:** 1.0
- **Status:** Draft
- **Stage:** Discovery
- **Target Platform:** Obsidian Desktop
- **Technology Stack:** TypeScript, Obsidian Plugin API, Playwright, Cucumber-JS, Node.js

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
- install runner
- install dependencies
- install browsers
- generate demo content
- verify installation

### FR-003 Use Case Management

The system shall allow creation and management of Use Cases.

Each Use Case shall contain:

- identifier
- title
- objective
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

The system shall allow grouping scenarios into suites.

Default suites:

- Smoke
- Regression

### FR-006 Runner Installation

The system shall create a self-contained runner inside `.testrunner`.

### FR-007 Runner Validation

The system shall verify:

- NodeJS
- npm
- Playwright
- Browser installation
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
Create Note
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
- Package manager

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

| ID | Criterion |
| --- | --- |
| AC-001 | User can initialize Test Hub. |
| AC-002 | Demo test executes successfully. |
| AC-003 | Evidence is generated. |
| AC-004 | Runner executes independently from Obsidian. |
| AC-005 | Runner executes inside GitHub Actions. |
| AC-006 | User can create a Use Case. |
| AC-007 | User can create a Feature. |
| AC-008 | User can execute a Suite. |
| AC-009 | Dashboard reflects execution results. |
| AC-010 | Documentation is generated automatically. |

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
