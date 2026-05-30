# Backlog V1 — Obsidian E2E Test Hub

> Index of the V1 MVP backlog. Individual epic / feature / story notes live alongside this index as `EPIC-001..EPIC-012`, `FEAT-001..FEAT-028`, `US-001..US-050`.

- **Product:** Obsidian E2E Test Hub
- **Version:** 1.0
- **Stage:** MVP
- **Type:** Product Backlog
- **Companion documents:** [Obsidian E2E Test Hub PRD](../Obsidian%20E2E%20Test%20Hub.md), [Solution Design](../architecture/Solution%20Design.md), [Use Cases V1](../use-cases/V1.md)

---

## Release Goal

A user installs the plugin, initializes the Test Hub, executes a fully functional demo test, reviews the generated evidence, and can commit the generated test assets into a CI pipeline.

## Definition of Ready

- Description exists
- Acceptance Criteria defined
- Dependencies identified
- Scope understood

## Definition of Done

- Code implemented
- Unit tests passing
- Documentation updated
- TypeScript strict mode passing
- ESLint clean
- Acceptance Criteria satisfied

---

## Epics

| Epic | Title | Features |
| --- | --- | --- |
| [[EPIC-001]] | Foundation & Plugin Infrastructure | [[FEAT-001]], [[FEAT-002]] |
| [[EPIC-002]] | Test Hub Initialization | [[FEAT-003]], [[FEAT-004]], [[FEAT-005]] |
| [[EPIC-003]] | Test Runner | [[FEAT-006]], [[FEAT-007]], [[FEAT-008]] |
| [[EPIC-004]] | Use Case Management | [[FEAT-009]], [[FEAT-010]] |
| [[EPIC-005]] | Specification Management | [[FEAT-011]], [[FEAT-012]] |
| [[EPIC-006]] | Test Suite Management | [[FEAT-013]], [[FEAT-014]] |
| [[EPIC-007]] | Test Execution | [[FEAT-015]], [[FEAT-016]] |
| [[EPIC-008]] | Reporting & Evidence | [[FEAT-017]], [[FEAT-018]] |
| [[EPIC-009]] | Dashboard | [[FEAT-019]], [[FEAT-020]] |
| [[EPIC-010]] | CI/CD | [[FEAT-021]], [[FEAT-022]], [[FEAT-023]] |
| [[EPIC-011]] | Documentation | [[FEAT-024]], [[FEAT-025]] |
| [[EPIC-012]] | Quality Assurance | [[FEAT-026]], [[FEAT-027]], [[FEAT-028]] |

---

## Sprint plan

| Sprint | Focus | Stories |
| --- | --- | --- |
| 1 | Foundation + Initialization | [[US-001]] → [[US-009]] |
| 2 | Runner + Use Cases | [[US-010]] → [[US-017]] |
| 3 | Specifications + Suites | [[US-018]] → [[US-025]] |
| 4 | Execution | [[US-026]] → [[US-031]] |
| 5 | Reporting + Evidence | [[US-032]] → [[US-036]] |
| 6 | Dashboard + CI/CD | [[US-037]] → [[US-042]] |
| 7 | Documentation + QA | [[US-043]] → [[US-050]] |

---

## MVP prioritization (MoSCoW)

| Priority | Count | Stories |
| --- | --- | --- |
| Must Have | 23 | [[US-001]], [[US-002]], [[US-003]], [[US-004]], [[US-005]], [[US-006]], [[US-007]], [[US-008]], [[US-009]], [[US-010]], [[US-011]], [[US-012]], [[US-013]], [[US-015]], [[US-018]], [[US-022]], [[US-024]], [[US-026]], [[US-028]], [[US-030]], [[US-032]], [[US-035]], [[US-037]], [[US-040]], [[US-041]], [[US-043]], [[US-044]], [[US-045]], [[US-049]] |
| Should Have | 12 | [[US-019]], [[US-021]], [[US-023]], [[US-025]], [[US-027]], [[US-029]], [[US-033]], [[US-034]], [[US-038]], [[US-039]], [[US-046]] |
| Could Have | 4 | [[US-014]], [[US-020]], [[US-031]], [[US-042]] |
| Unprioritized | 5 | [[US-016]], [[US-017]], [[US-036]], [[US-047]], [[US-048]], [[US-050]] |

The Must Have row includes 29 stories (the user spec stated ~16 explicit Must-Haves plus the implicit `US-001 → US-015` range, which conflicts with `US-014` in Could Have; this index treats US-014 as Could Have per the explicit list and the rest of the range as Must Have).

---

## Estimated MVP size

| Epic | Stories |
| --- | --- |
| Foundation | 3 |
| Initialization | 6 |
| Runner | 5 |
| Use Cases | 3 |
| Specifications | 4 |
| Suites | 4 |
| Execution | 6 |
| Evidence | 5 |
| Dashboard | 3 |
| CI/CD | 3 |
| Documentation | 4 |
| Quality | 4 |
| **Total** | **50** |

---

## Dataview queries (Obsidian)

The frontmatter on every epic/feature/story note is Dataview-queryable. Useful starting queries:

````dataview
TABLE WITHOUT ID file.link AS Epic, title FROM "docs/issues" WHERE type = "epic" SORT id ASC
````

````dataview
TABLE WITHOUT ID file.link AS Story, priority, sprint FROM "docs/issues" WHERE type = "story" AND priority = "must-have" SORT sprint, id
````
