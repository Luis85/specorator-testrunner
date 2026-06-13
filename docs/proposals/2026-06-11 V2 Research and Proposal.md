# Specorator Testrunner — V2 Research & Proposal

_Date: 2026-06-11. Synthesized from a five-track research effort: (1) technical
capability & limitations review of the V1 codebase, (2) product-docs review
(PRD, ADRs, UC-001..024, EPIC/FEAT/US backlog, both review plans), (3)
competitive landscape (test management, BDD frameworks, Playwright ecosystem,
AI-assisted testing, docs-as-code), (4) persona-level user-needs research
(QA/SDET, PO/BA, developers, delivery managers, Obsidian users, solo
devs/agencies), and (5) practitioner-evidence research (surveys, forums,
review sites). Builds on — and assumes — the completed
"[V1 Review and Improvement Plan](../reviews/V1%20Review%20and%20Improvement%20Plan.md)"
and "[2026-06-11 Product Review and Improvement Plan](../reviews/2026-06-11%20Product%20Review%20and%20Improvement%20Plan.md)"._

---

## 1. Executive summary

V1 is a disciplined, complete MVP: ten epics shipped, 24 use cases working,
strong layering, security posture, and test coverage. The research says the
**product thesis is validated by the market's direction, not against it**:

- **The category whitespace is real and verified.** A programmatic grep of the
  official Obsidian plugin registry (4,658 plugins, June 2026) found **zero**
  plugins for test management, BDD/Gherkin, test execution, or requirements
  traceability. QA practitioners already hand-roll vaults for test evidence
  with Git + Kanban + screenshots — with no tooling support. Obsidian is free
  for commercial use since Feb 2025, removing the enterprise blocker.
- **Markdown specs became mainstream in 2025/26.** Playwright's official Test
  Agents (Planner → Generator → Healer, v1.56) use **Markdown test plans** as
  a first-class artifact; GitHub Spec Kit and the spec-driven-development wave
  made "specs as the source of truth for AI agents" the dominant developer
  narrative. Our vault of Use Cases + Gherkin **is** that spec layer.
- **The single biggest technical liability is the cucumber-js runner.**
  Practitioners don't hate readable specs — they hate the Cucumber *runner*
  and its glue layer. Running cucumber-js forfeits Playwright's UI mode,
  trace viewer, fixtures, parallelism, sharding, retries, and visual
  assertions. Playwright closed Cucumber support as "not planned"; the
  community standard is **playwright-bdd** (Gherkin compiled to native
  Playwright tests; v9, ~350k weekly downloads, June 2026). Migrating the
  `.testrunner` to playwright-bdd unlocks half of this proposal for free.
- **Evidence is our killer feature — make it audit-grade and client-grade.**
  Compliance regimes (FDA CSA, IEC 62304, SOC 2, ISO 29119) want
  requirement→test→result traceability with timestamps, commit hashes,
  environments, and named approvers; auditors accept git/Markdown evidence
  when it carries that metadata. Agencies and solo devs pay (up to $399/mo at
  competitors) for client-facing test reports and UAT sign-off documents. No
  local-first tool serves either job.
- **AI table stakes are set, and our position is privileged.** By 2026 users
  expect natural-language test generation, repair-time self-healing, AI
  failure triage, and **MCP integration**. Every commercial AI-testing
  competitor is cloud-dependent and quote-priced. The winning V2 move is to
  be the **spec layer + MCP surface that the user's own agents (Claude Code,
  Copilot) plug into** — not to embed a cloud AI runtime. V2 ships this as a
  single **opt-in local MCP server**, deliberately scheduled as the final
  roadmap item once the V2 feature set it exposes is stable.
- **The platform moved under us, favorably.** Obsidian Bases shipped as a
  core plugin (plus a `registerBasesView()` API, Oct 2025); the community has
  migrated Dataview→Bases. Bases creates database-like views of notes from
  YAML-configured `.base` files whose filters, formulas, and views operate on
  **note properties** (frontmatter). We deliberately do **not** build our
  dashboards on Bases — its view environment is too restrictive for what the
  Test Hub needs — and custom Bases views are out of scope for now (revisit
  later). What V2 does take from this: every run/spec/use-case fact lives in
  typed, documented frontmatter properties — exactly the surface Bases
  filters and formulas read — so users can define their own `.base` views
  over Test Hub data without any plugin support.

The proposal below defines **eight V2 epics (EPIC-013…020), 39 user stories
(US-051…089), and 13 use cases (UC-025…037)**, with a recommended priority
order, explicit non-goals, and a **pre-V2 implementation plan (§9)** that
clears recorded debt and lays the required foundations — ending with the
playwright-bdd migration as the bridge into V2 feature work.

---

## 2. V1 capability review

### 2.1 What V1 does well

| Area | State |
| --- | --- |
| Workflow completeness | Full loop works: Use Case → Feature → Suite → Run → Report import → Evidence → Dashboard → CI generation |
| Architecture | Hexagonal layering lint-enforced; ports/adapters give clean extension seams (`VaultFileSystem`, `AbsoluteFileSystem`, `ChildProcessRunner`, `TemplateWriter`, `DataStore`, `WorkspacePort`) |
| Event model | ~80 domain events, compiler-checked payload map, correlation/causation IDs, `PostRunCoordinator` serialization |
| Security | argv-shape command allowlist (`shell:false`), path-safety policy + `JSON.stringify` sink escaping, credential redaction, TOCTOU-free maintenance lock |
| Quality | 673+ tests, ≥80% coverage gate, release workflow verifies tag/manifest and runs the suite; quality harness (2026-06-11): ESLint 10 `strictTypeChecked` + Obsidian plugin-guideline rules, vitest test-hygiene rules, and a fallow codebase-intelligence audit on every PR — currently **advisory/non-blocking** (flip + tighten scheduled as §9 item 0.4) |
| Non-technical UX | Whole loop reachable without the command palette (Dashboard quick actions, Use Case detail, inline results) |
| Spec authoring | Structured **Feature Editor** view (PR #29, post-review): Gherkin round-trip parse/serialize with raw-mode fallback, live validation strip, and authoring aids — non-technical users edit scenarios without touching Gherkin syntax |
| Onboarding | **Guided Tour** (ADR-0020, PR #31): event-observed sidebar checklist over the full loop — the user performs each step in the real UI, `GuidedTourService` observes domain events and auto-advances, progress persists across reloads; the demo fixture gained a greeting form so the self-authored `@tour` scenario exercises genuinely new behavior, including a real missing-steps → generate → implement cycle |

### 2.2 Hard V1 constraints (with their decision records)

| Constraint | Source | V2 disposition |
| --- | --- | --- |
| cucumber-js is the runner; Playwright used as a library | ADR-0004/AD-7 | **Replace** (→ EPIC-013) |
| Chromium only | AD-5 | **Lift** via Playwright projects (→ EPIC-013) |
| Serial execution (`parallel: 0`) | AD-6 | **Lift** (→ EPIC-013) |
| Feature-level identity; no scenario history; ADR-0017 "floor" workaround | AD-10, CONTEXT.md "Scenario Reference" | **Implement scenario identity** (→ EPIC-014) |
| Evidence = links + counts; `evidenceRetentionDays` field exists but is dead | ADR-0005/0016 | **Upgrade to audit-grade + implement sweep** (→ EPIC-015) |
| Report import = cucumber JSON only | ReportImportService | **Port-based parser chain** (→ EPIC-019) |
| Credentials plaintext in `data.json`; env-var transport | ADR-0014, AD-9 | **Keychain/encrypted at rest** (→ EPIC-020) |
| GitHub Actions only; single env; no sharding | ADR-0011, EPIC-010 | **Matrix/sharding + provider abstraction** (→ EPIC-020) |
| One vault = one project | ADR-0015 | **Keep** (revisit only on demand) |
| Single active run | ADR-0018 | **Keep** (sound; parallelism happens inside the run) |
| npm only | AD-2 | **Keep default, allow pnpm** (low priority) |
| Step matching = regex heuristics (no custom parameter types, tables, doc-strings) | step-definitions.ts | **Subsumed by playwright-bdd diagnostics; agent-assisted via MCP** (→ EPIC-013/016) |
| Desktop only | manifest | **Keep execution desktop-only; add mobile read-only degradation** (→ EPIC-018) |

### 2.3 Already-recorded debt (deferred in the 2026-06-11 review §4)

Per-note write serialization, output-event ordering, settings scalar repair,
`LiveRefresh` extraction, action SHA-pinning, browser caching in CI, vault-base
normalization, `joinVaultPath` hardening, shared serial queue, ribbon-icon trim
— plus the formal [tech-debt register](../tech-debt/README.md) (TD-001…005)
deferred from the Feature Editor review (PR #29): escaped pipes in table
cells, the one-argument-per-step invariant, duplicated structural validation,
the editor's `commit(structureChanged)` flag, and the Outline predicate.
All of these are sequenced in the pre-V2 implementation plan (§9); EPIC-018
additionally picks up the product-facing ones (ribbon trim, vault pollution).

---

## 3. Competitive landscape (condensed)

### 3.1 Category map

| Category | Representatives | What they teach us |
| --- | --- | --- |
| Test management SaaS | TestRail (~$38–71/user/mo), Xray/Zephyr (Jira-coupled, pay for every Jira seat), Qase, Testmo, Testiny | Most-hated traits: per-seat pricing (read-only viewers cost full price), slow step editing, locked-down reporting, painful export/lock-in. Users literally "write tests in ticket descriptions to avoid the tool." Our wedge: plain files, free readers, leave anytime. |
| BDD frameworks | cucumber-js (community-owned since Dec 2024, volunteer-scale ~$18.6k/yr funding), Reqnroll (SpecFlow fork), Gauge (sponsor exited), Robot Framework (healthiest: 80+ paying foundation members), Serenity/JS (closest living-doc competitor), Karate | The category's defining trauma is **sponsor abandonment** (SmartBear→Cucumber, Tricentis→SpecFlow, ThoughtWorks→Gauge, Pickles dead). "Local-first, plain files, no lock-in" directly answers that anxiety. Standards to adopt: **Cucumber Messages** (v33, active) and **Allure** export. |
| Playwright ecosystem | playwright-bdd (v9, 2026-06), Playwright UI mode/trace viewer/codegen, Playwright Test Agents, Checkly ($24+/mo), Currents ($49+/mo), Argos/Percy (visual), Allure 3 (real-time, quality gates), ReportPortal | One runner rules: everything plugs into `@playwright/test` as reporter or codegen, never as a replacement runner. Trace.zip is the universal artifact. cucumber-js-as-runner is documented as the legacy path. |
| AI-assisted testing | QA Wolf (~$90k/yr service), mabl ($499+/mo), testRigor, Octomind (MCP server, exportable Playwright), Momentic ($250+/mo, runtime AI), Stagehand (OSS, dropped Playwright in v3) | Table stakes 2026: NL test generation, repair-time healing, AI failure triage, MCP server. All competitors are cloud-bound; none serves local-first/privacy-sensitive users (finance: 54.9% blocked by compliance concerns on cloud AI). |
| Docs-as-code / traceability | Sphinx-Needs, StrictDoc, OpenFastTrace, testomat.io (~$27–30/user/mo), Testspace, Doc Detective | Borrow: typed directional links (`covers:`) with requirement revisions, CI-failable coverage-chain linting, interchange export, scenario-ID write-back into generated code. **Markdown with Gherkin (`.feature.md`)** is an official Cucumber spec. |
| Obsidian ecosystem | 4,658 plugins, zero QA/testing/traceability plugins; Bases (core plugin: YAML-configured `.base` views querying note properties) shipped; Dataview effectively unmaintained | First-in-category position. Keep all metadata in frontmatter properties — the surface Bases filters/formulas query (custom Bases views judged too restrictive for our dashboards — parked for later), avoid vault pollution, degrade gracefully on mobile. |

### 3.2 Differentiators we uniquely have

1. **Local-first + files-over-apps**: no per-seat pricing, no export problem, no sponsor-abandonment risk for user data — the artifacts outlive the tool.
2. **The knowledge graph**: requirements ↔ specs ↔ runs ↔ evidence as linked, backlinked, queryable notes. Every competitor's living doc is a **read-only generated site**; ours is an **editable workspace**.
3. **Evidence notes**: no competitor produces Markdown, git-versioned, audit-stampable test evidence.
4. **One surface for all five personas** — competitors split this across Jira plugins, CI dashboards, and report sites.

### 3.3 Table stakes we currently lack

Scenario-level run history & flakiness analytics; trace-viewer deep links;
parallel execution & CI sharding; single-scenario runs / watch mode; AI
generation/triage/healing hooks; MCP surface; step autocomplete from a step
library; visual regression; manual/exploratory test capture; Allure/JUnit
interop; release-readiness reporting.

---

## 4. User needs by persona (evidence-backed)

| Persona | Top jobs-to-be-done | Strongest evidence | V2 answer |
| --- | --- | --- | --- |
| QA / SDET | Triage CI failures in minutes; detect/quarantine flaky tests with owner + deadline; debug from artifacts (trace/screenshot/video) without re-running; keep feedback <10 min via parallelism/sharding | ~40% of QA time goes to maintenance/flakiness; Google: 84% of pass↔fail transitions are flaky; trace viewer is the de-facto triage tool | EPIC-013 (native runner), EPIC-014 (flakiness, history) |
| PO / BA | Facilitate Example Mapping; **review, not write**, Gherkin; plain-language "ready to ship?"; defensible sign-off; prove testing to auditors | POs resist authoring Gherkin ("too technical"); stakeholders never read feature files; SOC 2 audits demand 150+ evidence artifacts; UAT sign-off needs named approver + timestamp | EPIC-017 (discovery), EPIC-015 (readiness, sign-off, audit export) |
| Developer | Run one scenario fast; typed steps with IDE support; no regex glue; debug via Playwright traces; feed specs to AI coding agents | "Regex-based spaghetti" is the canonical complaint; playwright-bdd exists precisely to escape cucumber-js; Spec Kit/Playwright Agents made Markdown specs an AI artifact | EPIC-013 (typed steps, traces), EPIC-016 (opt-in MCP — last roadmap item) |
| Delivery manager | Defensible GO/NO-GO per release; separate signal from flakiness noise; prove requirement coverage; report upward in non-technical language; survive audits without the screenshot scramble | Manual report assembly goes stale immediately; pass rate alone is a vanity metric; dashboards need ≤5–7 metrics with targets and trends, each drillable | EPIC-015 (readiness, one-pager, audit export), EPIC-014 (flakiness metric) |
| Obsidian power user | Queryable dashboards over notes; data ownership; no vault pollution; mobile read access | Bases-first migration; vault-pollution complaints; ~30% of plugins desktop-only is tolerated but penalized | EPIC-018 (Bases-friendly metadata, mobile read-only, pollution control) |
| Solo dev / agency | "Evidence I tested this for my client"; UAT sign-off to unblock invoices; monthly retainer report; checklist-first on-ramp | Client disputes hinge on documentation; white-label QA reports are a $49–399/mo competitor product; solo devs live in Markdown checklists, fear brittle suites | EPIC-015 (client report export, sign-off), EPIC-017 (checklist on-ramp) |

Cross-cutting 2026 anxiety (SmartBear, n=273 decision-makers): **70% say
quality is suffering as AI accelerates development; 68% fear the QA bottleneck
worsens; 92% still depend on manual testing.** V2's elevator pitch: *the
verification system of record for AI-built software.*

---

## 5. V2 strategy

### 5.1 Positioning statement

> **The local-first verification workbench.** Your requirements, executable
> specifications, and audit-grade test evidence live as plain Markdown in your
> vault — runnable by you, by CI, and by your AI agents, owned by no vendor.

### 5.2 The three bets

1. **Bet on the Playwright-native runner** (playwright-bdd). It removes our
   biggest technical liability and unlocks traces, parallelism, browsers,
   visual testing, and single-scenario runs in one move.
2. **Bet on evidence & traceability as the monetizable job.** Audit-grade
   evidence, release readiness, sign-off, and client reports are jobs people
   demonstrably pay for, that no local-first tool serves, and that our
   Markdown/git substrate is uniquely suited to.
3. **Bet on being the spec layer for user-owned AI agents.** The plugin's
   only AI surface is one opt-in local MCP server the user can activate —
   no chat, no bundled model calls — and it ships **last**, once the V2
   feature set it exposes is stable.

### 5.3 Non-goals for V2 (explicit)

- **No multi-project / multi-vault support in V2.0** (ADR-0015 stands; the
  research did find that single-vault-for-everything is the dominant Obsidian
  usage pattern, so folder-scoped projects are flagged as a V2.x
  *investigation*, not a commitment).
- **No queued/concurrent runs** (ADR-0018 stands; parallelism lives inside a run).
- **No test recorder / visual test builder** (PRD V3; Playwright codegen exists — NG3/NG4 stand).
- **No cloud service, no telemetry, no hosted dashboard** (P2 Local First is the moat).
- **No in-plugin AI features** — no chat UI, no bundled or BYO-API-key model calls, no AI-generated content produced by the plugin itself. All AI work happens through the user's own agents via the opt-in local MCP server (EPIC-016, the last roadmap item). Runtime-AI test steps (Momentic-style runtime interpretation) stay out of scope too: they trade away determinism, our strength.
- **No custom Bases views** — the Test Hub's dashboards stay custom plugin views; the Bases view environment is too restrictive for our dashboard needs. We keep metadata Bases-queryable (US-076) and may revisit `registerBasesView` integration later.
- **No Obsidian community marketplace submission** — deferred indefinitely. The plugin stays in this repository; distribution is GitHub releases installed via the BRAT plugin (see §9 Phase 0.1). We keep the codebase marketplace-clean so the option remains open.
- **No mobile-device (Appium) or API-first testing epics** (Playwright's `request` fixture becomes available for API-setup steps via EPIC-013 — evidence says API data setup makes suites 3–4x faster — but device labs and standalone API testing are out of scope).
- **No Jira/Azure-DevOps two-way sync in V2.0** (importers only, → EPIC-019; full sync is V2.x+ pending demand).

---

## 6. V2 proposal — epics, user stories, use cases

Numbering continues V1: epics from EPIC-013, features indicated per epic,
stories from US-051, use cases from UC-025. Stories follow the house format
(persona, want, so-that, acceptance criteria); they were originally embedded
here for review and have since been **carved out into dedicated notes** —
epics, features, and stories under `docs/issues/`, use cases under
`docs/use-cases/`. The notes are the canonical text; this section is the
index.

> **Priority key** — P1: core of V2.0; P2: fast follow (V2.1); P3: V2.x
> opportunistic.

> **Cross-cutting expectation (ADR-0020):** every V2 epic that adds a
> user-facing workflow also extends the **Guided Tour** with matching steps
> (or a per-feature mini-tour) — the tour observes domain events, so new
> workflows that publish events are teachable by construction, and onboarding
> must not drift from the product.

### [[EPIC-013]] — Playwright-Native Runner *(P1, foundation)*

> Replace cucumber-js-as-runner with playwright-bdd: Gherkin compiles to
> native `@playwright/test` specs. Revisits ADR-0004/AD-5/AD-6/AD-7; requires
> a new ADR ("Adopt playwright-bdd as execution engine") and a migration path
> for existing `.testrunner` projects (repair regenerates managed files; user
> steps are preserved and adapted with guidance).

- Stories: [[US-051]] Migrate the runner to playwright-bdd · [[US-052]] Typed
  step definitions · [[US-053]] Run a single scenario · [[US-054]] Parallel
  execution & retries · [[US-055]] Browser matrix · [[US-080]] Open Playwright
  UI mode & trace viewer
- Features: [[FEAT-029]] Optional Check Libraries *(P3, V2.x, stories on
  acceptance — visual regression, accessibility checks, API-setup steps)*

### [[EPIC-014]] — Scenario Identity, History & Flakiness *(P1)*

> Implements the deferred Scenario Reference (CONTEXT.md), replaces the
> ADR-0017 status "floor" with real per-scenario history, and makes
> flakiness a first-class concept. New ADR: scenario identity & history
> store (append-only NDJSON run log under `Test Evidence/` — also resolves
> the Event Catalog §16 V2 candidate).

- Stories: [[US-056]] Scenario Reference · [[US-057]] Per-scenario run
  history · [[US-058]] Flakiness score & quarantine · [[US-059]] Failure
  triage view

### [[EPIC-015]] — Audit-Grade Evidence & Release Readiness *(P1)*

> Evidence grows from "links + counts" into the compliance and client-report
> backbone. Auditors accept git/Markdown evidence **iff** it carries
> timestamps, commit SHA, environment, and approver identity (FDA CSA, IEC
> 62304, SOC 2 evidence research).

- Stories: [[US-060]] Audit-grade evidence stamps · [[US-061]] Traceability
  matrix note · [[US-062]] Release readiness (GO/NO-GO) · [[US-063]] Release
  sign-off note · [[US-064]] Client/stakeholder report export · [[US-065]]
  Audit export bundle · [[US-066]] Evidence retention sweep

### [[EPIC-016]] — Agent Integration via Local MCP *(opt-in, last on the roadmap)*

> The plugin's **only** AI surface: one opt-in, local MCP server the user can
> activate. No AI chat, no bundled or BYO-API-key model calls, no AI-generated
> content produced by the plugin itself — all AI work is performed by the
> user's own agents (Claude Code, Copilot, …) *through* the MCP. Alongside
> it: optionally installable, **provider-selectable agent skills** (US-089) —
> static instruction files rendered per provider format, never model calls —
> so each agent learns the hub's workflows natively. Deterministic
> tests remain the output. Deliberately scheduled **last**, so the MCP and
> skills expose a stabilized V2 feature set instead of chasing a moving API.
> New ADR: "Opt-in local MCP exposure; no in-plugin AI runtime."

- Stories: [[US-067]] Local MCP server for the Test Hub · [[US-068]] Agent
  context generation · [[US-069]] Step implementation through the MCP ·
  [[US-070]] Failure triage through the MCP · [[US-071]] Repair-time healing
  through the MCP · [[US-089]] Installable agent skills with provider
  selection

### [[EPIC-017]] — Discovery & Non-Technical Collaboration *(P2)*

> Meet POs/BAs where they are: they review, not write, Gherkin. Bridge
> discovery (Example Mapping) → formulation (features) → checklists →
> automation. No competitor connects an example map to executable scenarios.

- Stories: [[US-072]] Example Map notes · [[US-073]] Generate scenarios from
  an Example Map · [[US-074]] Scenario quality lint · [[US-075]] Checklist
  on-ramp · [[US-081]] Step Library with autocomplete · [[US-082]] Use Case
  Editor · [[US-083]] Linked entity notes (Actors and shared concepts)
- Features: [[FEAT-030]] Exploratory Session Notes *(P3, V2.x, stories on
  acceptance)*

### [[EPIC-018]] — Obsidian-Native Experience *(P2)*

> Ride the platform — mobile read access, graph hygiene, queryable metadata —
> while the Test Hub's dashboards remain our **own custom views**. Building
> them on Obsidian Bases was evaluated and rejected for now: the Bases view
> environment is too restrictive for what the dashboards need to do. Custom
> Bases views (`registerBasesView`) are explicitly out of scope and may be
> revisited later.

- Stories: [[US-076]] Bases-friendly metadata · [[US-077]] Mobile read-only
  degradation · [[US-078]] Vault & chrome hygiene

### [[EPIC-019]] — Interop & Open Formats *(P2–P3)*

> Be a good citizen of the 2026 toolchain; make leaving (and arriving) easy.

- Stories: [[US-079]] Cucumber Messages + Allure/JUnit export *(P2)*
- Features: [[FEAT-031]] Report-Parser Port & Importers *(P3, V2.x, stories
  on acceptance)* · [[FEAT-032]] Headless Traceability CLI *(P3, V2.x)*

### [[EPIC-020]] — Trust, Security & CI Depth *(P2–P3)*

> Deepen the security posture and CI generation: credentials out of
> plaintext, session reuse, sharded and multi-environment pipelines, and a
> second pipeline provider.

- Stories: [[US-084]] Credential storage upgrade *(P2)* · [[US-085]]
  Session/auth reuse (storageState) *(P2)* · [[US-086]] Sharded CI generation
  *(P2)* · [[US-087]] Multi-environment CI matrix *(P3)* · [[US-088]] GitLab
  CI provider *(P3)*

---

## 7. New use cases (UC-025…037)

One line each; carved out as stub notes in `docs/use-cases/` — full notes to
be elaborated on acceptance, in the UC-001 format.

| ID | Title | Primary actor | Epic |
| --- | --- | --- | --- |
| [[UC-025]] | Run a single Scenario from a Use Case | Developer | [[EPIC-013]] |
| [[UC-026]] | Debug a failed Scenario via Playwright trace | Developer | [[EPIC-013]] |
| [[UC-027]] | Run a Suite across multiple browsers | QA Engineer | [[EPIC-013]] |
| [[UC-028]] | Review and quarantine a flaky Scenario | QA Engineer | [[EPIC-014]] |
| [[UC-029]] | Triage a failed run by error group | QA Engineer | [[EPIC-014]] |
| [[UC-030]] | Generate the traceability matrix | Delivery Manager | [[EPIC-015]] |
| [[UC-031]] | Evaluate release readiness and record sign-off | Product Owner | [[EPIC-015]] |
| [[UC-032]] | Export a client-facing test report | Freelancer | [[EPIC-015]] |
| [[UC-033]] | Assemble an audit evidence bundle | Business Analyst | [[EPIC-015]] |
| [[UC-034]] | Drive the Test Hub from a coding agent via MCP | Developer | [[EPIC-016]] |
| [[UC-035]] | Facilitate discovery with an Example Map | Product Owner | [[EPIC-017]] |
| [[UC-036]] | Promote a checklist item to an automated Scenario | Solo Developer | [[EPIC-017]] |
| [[UC-037]] | Author a Use Case with the guided editor (incl. linked Actor notes) | Product Owner | [[EPIC-017]] |

---

## 8. Sequencing & first release cut

**Pre-V2 (see §9):** V1 release & stabilization, recorded-debt cleanup,
versioning/migration foundations — ending with the playwright-bdd migration
itself (US-051/052 land here, as the last pre-V2 item).

**V2.0 (the headline release):** the rest of EPIC-013 (US-053…055, US-080) +
US-056/057 (identity & history, since the runner migration touches the same
report pipeline) + US-060 (evidence stamps). Rationale: the `.testrunner`
and report pipeline were just migrated once (§9 Phase 3); everything else
layers on top without breaking changes.

**V2.1:** flakiness & triage (US-058/059), readiness/sign-off/exports
(US-061…065), retention sweep (US-066), Step Library (US-081), Use Case
Editor + linked entity notes (US-082/083), Bases-friendly metadata (US-076),
chrome hygiene (US-078), credential keychain (US-084), storageState
(US-085), sharded CI (US-086), Messages/Allure.

**V2.x:** the remaining EPIC-017 discovery stories (US-072…075: Example
Maps, scenario generation, lint, checklist on-ramp — US-081/082/083 land in
V2.1 above), mobile read-only, importers, headless CLI, multi-env matrix
(US-087), GitLab CI (US-088).

**V2 final (last roadmap item):** EPIC-016 — the opt-in local MCP server,
agent workflows, and installable provider-selectable agent skills
(US-067…071, US-089). Deliberately last so the MCP and the skills expose a
stabilized feature set covering the plugin's most important use cases,
rather than chasing a moving internal API.

**Required new ADRs:** playwright-bdd adoption (supersedes parts of
ADR-0004/AD-6/AD-7); scenario identity & history store; opt-in local MCP
exposure with no in-plugin AI runtime; credential storage (supersedes AD-9);
browser matrix default (supersedes AD-5).

**Migration risks to carry into planning:**
playwright-bdd is a single-maintainer (very active) community project —
mitigation: Gherkin files and step logic stay portable, and the runner is
regenerable, so the blast radius of a forced second migration is contained;
generated-spec files must be git-ignored and never hand-edited; report
import moves from cucumber JSON to Messages with a fallback window;
existing V1 `.testrunner` users need a guided, non-destructive repair path
(test with the e2e-smoke workflow before release).

---

## 9. Pre-V2 implementation plan

What must be done **before any V2 scope starts**. Phases 0–2 harden the V1
codebase and put the migration machinery in place; the **last item is the
playwright-bdd migration itself** — once it is green, V2.0 feature work
begins. The Phase 0–1 items come from two registers: the "deliberately
deferred" list in the
[2026-06-11 review §4](../reviews/2026-06-11%20Product%20Review%20and%20Improvement%20Plan.md)
and the [tech-debt register](../tech-debt/README.md) (TD-001…005, deferred
from the Feature Editor review, PR #29). They are sequenced here because V2
builds directly on top of them.

### Phase 0 — Ship and stabilize V1

| # | Item | Why before V2 |
| --- | --- | --- |
| 0.1 | Tag and release V1 from this GitHub repository and document installation via the **BRAT** plugin (beta auto-update) as the official distribution channel; includes the ribbon-trim product call from review §4. **Obsidian community marketplace submission is deferred indefinitely** — the plugin stays where it is. | Establishes the baseline users will migrate *from*; V2's `.testrunner` migration path needs a defined V1 to upgrade; BRAT gives early adopters auto-updating installs without a marketplace review cycle |
| 0.2 | Make the opt-in `e2e-smoke` workflow a reliable pre-release gate: add the per-OS Playwright browser caching (review §4) and run it on demand for runner-template changes | This workflow is the safety net the runner swap will be validated against — it must be trustworthy first |
| 0.3 | Pin `release.yml` actions to SHAs (review §4; `contents: write`) | Lock down the release path before V2 increases release cadence |
| 0.4 | [[TD-006]] Flip the advisory quality gates to **blocking** and tighten them: make the fallow audit job fail the build (drop `continue-on-error`) with repo-tuned thresholds once signal quality is observed on a few PRs (the recorded follow-up in the [fallow integration design spec](../superpowers/specs/2026-06-11-fallow-integration-design.md)), and promote remaining warn-level lint rules (e.g. `vitest/no-disabled-tests`) to errors | V2 work should land against the strict gates from day one — flipping later means retrofitting V2 code and renegotiating thresholds under feature pressure |

### Phase 1 — Clear recorded debt V2 builds on

| # | Item | Why before V2 |
| --- | --- | --- |
| 1.1 | Per-note write serialization: per-path promise-chain mutex in `DefaultUseCaseService` (review §4) | V2 adds more concurrent writers to UC notes (scenario history rollups, evidence stamps, sign-off links) — the existing interleaving risk multiplies |
| 1.2 | Extract the shared serial queue (`src/shared/async/serial-queue.ts`) from `SettingsService.serialize()` / `PostRunCoordinator.enqueue()` (review §4) | The V2 history writer (US-057) is the "third user" the review said to wait for |
| 1.3 | Output-event ordering: chain `testrun.output.received` per run, await the tail before the terminal publish (review §4) | Scenario-level attribution (EPIC-014) depends on deterministic output ordering |
| 1.4 | Settings scalar repair extended to `ci.*` / `automation.*` (review §4) | V2 adds settings (workers, browsers, retention, MCP toggle); the repair posture must be in place before the surface grows |
| 1.5 | Path plumbing hardening: normalize the vault-base trailing separator once in `NodeAbsoluteFileSystem.getVaultBasePath()`; assert no `..` / leading `/` inside `joinVaultPath` (review §4) | The migration and MCP server (later) both mint paths; close the gaps before new callers appear |
| 1.6 | Extract `LiveRefresh` from the five views (review §4) | V2 adds new views (triage, readiness, step library); copy six instead of refactoring eight |
| 1.7 | `register-commands` smoke test + migrate `vault.adapter.exists` to the Vault API (review §4; community-review bots flag adapter usage) | V2's new commands touch this surface, and staying marketplace-clean keeps the (indefinitely deferred) submission option open at zero extra cost |
| 1.8 | [[TD-001]] Escaped pipes (`\|`) in Gherkin table cells: implement the official escape at the parse/serialize boundary; drop the `/` substitution and the guard's backslash special case | The playwright-bdd migration hands our features to the **official** Gherkin parser — files using the standard `\|` escape must round-trip, and the editor must stop silently rewriting user data |
| 1.9 | [[TD-002]] One-argument-per-step enforced in the domain model (sum-type `argument` on `GherkinStep`) | Today `serialiseFeature` can emit Gherkin Cucumber refuses to parse (table + doc string); after the runner migration that invalid output fails the suite — make the invalid state unrepresentable first |
| 1.10 | [[TD-003]] Single source of structural Feature validation (`structuralIssues()` in the application layer, consumed by service + editor) | V2's scenario quality lint (US-074) layers new rules on validation; building it on two already-drifting copies doubles every rule |
| 1.11 | [[TD-005]] One `isScenarioOutline` predicate exported from the domain entity, with deliberately chosen semantics | Scenario Reference (US-056) keys Outline examples as `::row-N` — identity and suite-match counts must agree on what an Outline *is* before history lands |
| 1.12 | [[TD-004]] Replace the Feature Editor's `commit(structureChanged)` flag with focus-preserving re-render (the one *large* item; can run parallel to Phase 2) | V2 grows the editor (lint strip US-074, step autocomplete US-081) and adds a sibling Use Case Editor (US-082) built on the same pattern; every new control re-rolls the stale-DOM/focus dice until re-render is safe by construction |

### Phase 2 — Foundations the V2 epics assume

| # | Item | Why before V2 |
| --- | --- | --- |
| 2.1 | Settings/data versioning: add a `schemaVersion` to `data.json` with an explicit, tested migration-step framework (tech review flagged "no versioning scheme") | Every V2 epic changes the settings shape; without versioned migrations each change is a fresh ad-hoc repair hack |
| 2.2 | Versioned `.testrunner` manifest + repair-driven upgrade framework: runner templates carry a version; `Repair installation` can apply guided, non-destructive upgrades and report what changed | This is the exact mechanism the playwright-bdd migration (3.x) rides on — build the rails before the train |
| 2.3 | Extract a `ReportParser` port with the current cucumber-JSON parser as its first implementation | Lets the migration add Cucumber Messages alongside JSON without touching the evidence pipeline twice (and opens EPIC-019 later) |
| 2.4 | Write and accept the V2 ADRs: playwright-bdd adoption, scenario identity & history store, opt-in local MCP / no in-plugin AI runtime, credential storage, browser-matrix default **— delivered 2026-06-13 as ADR-0021…0025 (design spec: `docs/superpowers/specs/2026-06-13-v2-foundational-adrs-design.md`).** | These are hard-to-reverse decisions; per the project's own ADR discipline they precede implementation |

### Phase 3 — The playwright-bdd migration (last item)

| # | Item | Gate |
| --- | --- | --- |
| 3.1 | Spike: generate a playwright-bdd `.testrunner` beside the demo content; validate existing `.feature` compatibility, Cucumber JSON/Messages output through the (now port-based) import pipeline, evidence generation, and cancel/single-run semantics on POSIX **and** Windows | Spike findings recorded; ADR from 2.4 confirmed or amended |
| 3.2 | Execute US-051/US-052: swap the generated runner to playwright-bdd with typed step stubs; repair migrates V1 `.testrunner` projects non-destructively (via 2.2) with a clear report; keep cucumber-JSON import as a fallback during the transition window | Demo test green; migrated sample vault green |
| 3.3 | Validation: full unit/integration suite, `e2e-smoke` green on all OSes (via 0.2), the **Guided Tour completes end-to-end against the migrated runner** (its step predicates key on run scopes, spec events, and the demo/`@tour` content — ADR-0020), docs updated (README disclosure, Getting Started, CONTEXT.md terms) | **Only after this gate does V2.0 feature work (§8) begin** |

## 10. Key sources

Practitioner/survey: PractiTest State of Testing 2025/26 · SmartBear State of
Software Quality 2026 · Ask HN: BDD and Gherkin tests (36234603) · Automation
Panda "Is BDD Dying?" (2025) · Gartner Market Guide / first MQ for
AI-Augmented Software Testing (2025).
Ecosystem: playwright-bdd (github.com/vitalets/playwright-bdd, v9 2026-06) ·
Playwright Test Agents (playwright.dev/docs/test-agents) · microsoft/playwright
#22521 (Cucumber: "not planned") · Cucumber community ownership announcement
(cucumber.io, Dec 2024) · Reqnroll v3 reporting · Cucumber Messages
(github.com/cucumber/messages) · Markdown with Gherkin spec
(cucumber/gherkin/MARKDOWN_WITH_GHERKIN.md) · Obsidian Bases view API
(docs.obsidian.md/plugins/guides/bases-view) · Obsidian free-for-work
announcement (obsidian.md/blog/free-for-work) · Obsidian community-plugins
registry grep (4,658 plugins, June 2026).
Compliance/evidence: FDA CSA final guidance · OpenRegulatory on IEC 62304
system testing and on Markdown-QMS limits · SOC 2 evidence guides · UAT
sign-off templates (bugzy.io, getbestest.com).
Competitor pricing/positioning: TestRail/Xray/Zephyr/Qase comparisons & G2
reviews · QA Wolf/mabl/Momentic/Octomind pricing pages · Checkly/Currents/
Argos/Allure 3/ReportPortal docs · testomat.io · TestPulse QA.
(Each persona/landscape research track retained full per-claim URLs; they are
available in the session research notes and can be committed as appendices on
request.)
