# Specorator Test Runner — Design

> An Obsidian plugin that turns a vault into a local-first, markdown-native,
> AI-assisted BDD test environment. Test cases are written in Gherkin inside
> Markdown code fences; the surrounding Markdown is living documentation.

This document is the design of record. It captures the product framing, the
architecture, the data model, and the per-layer specifications that came out of
a multi-perspective research and review pass (Obsidian platform, the
Playwright/Cucumber stack, MCP + Claude Code artifacts, the BDD product
landscape, plus an adversarial technical-risk review and a BDD-practitioner
product review).

---

## 1. Vision

The user installs the plugin, configures the website under test, and then
authors **test suites** containing **test cases** written in Gherkin. Each test
case is an ordinary Obsidian note: YAML frontmatter for metadata, human prose
for documentation, and a fenced ` ```gherkin ` block for the executable
scenario. The plugin runs those scenarios against a real browser, writes
results back into the vault as Dataview-friendly report notes, and can chain
cases into end-to-end **flows** on the Obsidian Canvas.

The plugin ships (all opt-in) with a local MCP server plus Claude Code skills,
subagents, and slash commands that an AI agent can use to help the user author
and triage tests.

### Product wedge

No incumbent test-management tool owns **local-first + markdown-native +
AI-assisted BDD**. Cucumber Studio, TestRail, Xray, Zephyr, Qase, etc. are all
cloud-hosted SaaS. Specorator's edge is specs-as-living-documentation in plain
Markdown, version-controllable, with zero lock-in, targeted at indie developers
and small teams who already live in Obsidian.

### The failure mode we design against

The #1 reason teams abandon Cucumber is the **step-definition maintenance tax**
and brittle, UI-coupled scenarios. Specorator's answer:

1. A **built-in natural-language step vocabulary** so most scenarios need zero
   custom code.
2. A **code-free state-setup primitive** (the `(api)` step family) — because the
   real wall in real suites is arranging the `Given` (seeding data,
   programmatic login), not clicking buttons.
3. **Accessibility-first locators** to reduce brittleness.
4. AI assistance for authoring and locator self-healing (opt-in, diff-gated).

---

## 2. Architecture: one engine, three frontends

The core insight after review: a reusable **engine core** with three entry
points. This decouples testing from Obsidian, which is what makes CI possible.

```
                     +-------------------------------------------+
                     |  specorator-engine  (standalone Node)      |
                     |  gherkin parse . step vocabulary .         |
                     |  (api) data/auth setup . Driver iface ->   |
                     |  PlaywrightDriver (default) . reporting/    |
                     |  history . flakiness/regression            |
                     +-------------------------------------------+
                        ^                ^                  ^
        spawns sidecar  |                | direct           | stdio
        +---------------+--+   +---------+--------+  +-------+----------+
        | Obsidian plugin  |   | specorator CLI   |  | MCP server       |
        | (renderer/UI)    |   | `specorator run` |  | (Claude Code)    |
        | authoring.explorer|  | headless -> CI   |  | spec_* tools     |
        | canvas.dashboards|   +------------------+  +------------------+
        | + optional       |
        |   WebviewDriver  |   <- "watch live" preview, gated on a spike
        |   preview mode   |
        +------------------+
```

- **Engine** (`@specorator/engine`) is pure-Node, no Obsidian dependency.
  Playwright (system Chrome via `channel`, on-demand browser download as
  fallback) is the default `Driver`.
- **Obsidian plugin** spawns the engine as a stdio sidecar for interactive runs.
- **CLI** (`specorator run`) runs the engine headless for CI — no Obsidian
  required. This is the merge gate.
- **MCP server** is a third entry point for Claude Code; it talks to the live
  plugin over a localhost loopback channel (file-queue fallback).
- **WebviewDriver** is an *optional* in-Obsidian "watch it run live" mode, lit up
  only if the gate-0 webview spike passes locally. The architecture does not
  depend on it.

### Why Playwright is primary (a reversed decision)

The original plan defaulted to driving Obsidian's built-in Web Viewer
("WebviewDriver") with Playwright as an opt-in upgrade. The technical-risk
review rated this **existential**: Obsidian states Web Viewer uses "the same
Chromium feature that embeds pages in Canvas" and was Cure53-audited — signals
it is not a grabbable `<webview>` element. Either implementation loses:

- A `<webview>`/OOPIF is cross-origin (no `contentDocument` access);
  `sendInputEvent` has documented failures reaching guest contents
  (electron#20333) and requires the host window to be focused — fatal for
  background runs.
- A `WebContentsView` exposes no DOM handle at all, forcing CDP, where it is
  unverified whether `dev:cdp` can target the viewer vs. the main window, and
  per-call process-spawn latency makes a 100 ms actionability poll a non-starter.

Combined with the product review ("a suite that doesn't run in CI is a
documentation project, not a test suite"), the decision was reversed:
**Playwright is the first-class engine; the WebviewDriver is optional.**

### The Driver abstraction

Everything above the driver (Gherkin parsing, vocabulary, variables, reports,
Canvas flows, AI) is driver-agnostic. The `Driver` interface:

```ts
interface Driver {
  open(url: string): Promise<void>;
  click(t: Target): Promise<void>;
  fill(t: Target, value: string): Promise<void>;
  select(t: Target, option: string): Promise<void>;
  check(t: Target): Promise<void>;
  press(key: string): Promise<void>;
  hover(t: Target): Promise<void>;
  getText(t: Target): Promise<string>;
  isVisible(t: Target): Promise<boolean>;
  waitFor(t: Target, state: "visible" | "hidden"): Promise<void>;
  url(): Promise<string>;
  title(): Promise<string>;
  screenshot(opts: ScreenshotOpts): Promise<ArtifactRef>;
  apiRequest(req: ApiRequest): Promise<ApiResponse>; // (api) setup family
}
```

- `PlaywrightDriver` — default, in the sidecar/CLI. Auto-wait, tracing,
  cross-browser, native screenshot masking come free.
- `WebviewDriver` — optional, Obsidian-plugin-only. Split into a driver + a
  `WebviewTransport` (renderer `<webview>` tag vs. CLI `dev:cdp`) so the deferred
  spike swaps only the transport.

---

## 3. Vault layout & data model

Obsidian-compatible frontmatter + Markdown is the foundation. Gherkin is parsed
with `@cucumber/gherkin` + `GherkinInMarkdownTokenMatcher` (pure JS) and steps
match via Cucumber Expressions.

```
MyVault/
  Specorator/
    Suites/
      auth/
        _suite.md          # suite index + config
        TC-login-001.md    # one note = one Gherkin Feature
        composites.md      # YAML composite/custom steps (no code)
    Flows/
      auth-e2e.canvas      # chained cases
      auth-e2e._flow.md    # flow config (companion to the .canvas)
    Reports/
      2026-05-25-auth-r3f9.md
      attachments/<runId>/...png
    Environments.md        # non-secret env config
  .specorator/             # NON-SYNCED: secrets, history, engine, browser cache,
                           #   bridge.json, run queue, raw NDJSON, HTML reports
  .claude/                 # opt-in AI artifacts (skills/agents/commands)
  .mcp.json                # opt-in MCP registration
```

`.specorator/` must be excluded from Obsidian Sync and git. It holds secrets,
the engine install, append-only history, the loopback `bridge.json`, and raw
artifacts.

### Frontmatter schemas

**Test case** (`TC-*.md`):

```yaml
specorator: testcase
id: TC-login-001          # stable; anchors history across renames/edits
title: Login with valid credentials
suite: auth
tags: [smoke, auth]
status: ready             # draft | ready | quarantined
# --- managed by Specorator (do not edit) ---
last_status: passed       # passed | failed | flaky | skipped
last_run: 2026-05-25T10:00Z
runs_total: 18
flaky_score: 0.0
flaky_status: stable      # stable | suspect | flaky | insufficient-data
regression: false
last_results: "PPPPPPPPPP" # last 10 newest->oldest; P/F/S
```

The body holds documentation plus the fenced `gherkin` block. Stable `id`
anchors run history.

**Suite** (`_suite.md`):

```yaml
specorator: suite
id: auth
title: Authentication
base_url_ref: staging     # resolves against Environments.md
order: [TC-login-001, TC-login-002]
tags_include: [smoke]
retries: 1
```

**Environments** (`Environments.md`, non-secret only):

```yaml
specorator: environments
default: staging
environments:
  staging: { base_url: "https://staging.example.com", viewport: "1280x800" }
  prod:    { base_url: "https://example.com",          viewport: "iphone-14" }
```

### Variables, environments & secrets

`{{...}}` interpolation resolves at run time with layered precedence:

```
run > flow > suite > environment > personas > {{env.*}} (OS) > {{secret.*}}
```

- Secrets live only in non-synced `.specorator/secrets.json` or OS env.
- **Taint tracking**: any value sourced from a secret/persona scope is marked
  tainted as it flows through interpolation, and is redacted in all logs,
  reports, NDJSON, and MCP outputs — not by post-hoc string match (a base64'd or
  concatenated token would evade that), but by provenance.
- **Screenshot masking**: secret-bound input elements are masked *before*
  capture using Playwright's native `screenshot({ mask })`, because a filled
  password field is visible pixels that string redaction cannot touch.

---

## 4. Step vocabulary

Steps are registered with Cucumber Expressions (pure JS, bundles into the
plugin). The pickle steps from parsed Gherkin match against the registry; first
match wins; unmatched steps surface as an authoring error with an AI "suggest a
step" hook.

### Target grammar (locators)

A `{target}` is a quoted string. Explicit prefix wins; otherwise smart
resolution. Accessibility-first to reduce brittleness.

| Form          | Example                       | Meaning                              |
|---------------|-------------------------------|--------------------------------------|
| bare          | `"Sign in"`                   | smart resolution                     |
| `role=`       | `"role=button[Sign in]"`      | ARIA role + optional accessible name |
| `label=`      | `"label=Email"`               | form control by label                |
| `placeholder=`| `"placeholder=you@co"`        | by placeholder                       |
| `text=`       | `"text=Welcome"`              | visible text                         |
| `testid=`     | `"testid=submit"`             | `data-testid` (attr configurable)    |
| `css=`/`xpath=`| `"css=.btn-primary"`         | raw selector escape hatch            |
| scoped        | `"Save" within "role=dialog"` | resolve inside a container           |
| ordinal       | `"the 2nd \"Delete\""`        | disambiguate by index                |

Bare resolution order, stopping at first unique match: exact role+name -> label
-> placeholder -> exact text -> substring text -> testid -> css. Zero/multiple
matches throw a structured `LocatorError { target, stage, candidates[] }` — the
candidate list is what the `locator-healer` skill consumes.

With Playwright primary, auto-wait/actionability comes from Playwright; the
fragile injected-JS reimplementation is only needed for the optional
WebviewDriver.

### Catalog (v1)

**State setup — `(api)` family (the key pillar).** Built on Playwright's
`APIRequestContext`, which can seed the browser `storageState`:

- `(api) {method} {string}` (with `json:` / `form:` doc-strings)
- `store response {string} as {string}` — capture & bind a response field
- `the user is logged in with token {string}` — inject into storageState (no UI login)
- `the user is logged in as {string}` — persona composite

**Navigation** — `the user opens {target}` (relative -> base_url) · `reloads` ·
`goes back`/`forward` · `opens {string} in a new tab`

**Interaction** — `clicks` · `double-clicks` · `right-clicks` ·
`fills {target} with {string}` · `types {string} into {target}` · `clears` ·
`selects {string} from {target}` · `checks`/`unchecks` ·
`uploads {string} to {target}` · `presses {string}` · `hovers` ·
`drags {target} to {target}`

**Waiting** — `waits for {target} to appear`/`to disappear` ·
`waits for the network to be idle` · `waits {int} seconds` *(linted as flaky)*

**Assertions** — `the page should show {string}`/`should not show` ·
`{target} should be visible`/`hidden`/`enabled`/`disabled`/`checked` ·
`{target} should have value {string}` · `{target} should contain text {string}` ·
`the url should be`/`should contain {string}` · `the title should be {string}` ·
`there should be {int} {target}` · `the page should match screenshot {string}`
(visual baseline)

**Data/context** — `stores {target} text as {string}` ·
`the user sets viewport to {string}` · `accepts`/`dismisses the dialog`

### Full Gherkin support (table-stakes)

`@cucumber/gherkin` emits these as pickles, so most is parse/report work:

- **Scenario Outline + Examples** — one pickle per row; reported per row.
- **Tags + tag-expression filtering** (`@smoke and not @wip`) across plugin, CLI, MCP.
- **Background** — applied to each scenario.
- **Hooks** — YAML-defined, tag-scoped before/after (code-free).
- **Rerun-failed-only** — `--rerun-failed` selects the prior run's failures from NDJSON history.

### Custom steps — YAML composites (no code)

Named sequences of existing steps, safe to sync, with `$name` params and
nesting. Trusted TypeScript step files come later, behind an explicit per-vault
trust toggle.

```yaml
specorator: composites
steps:
  - phrase: the user logs in as {string}
    args: [persona]
    do:
      - the user opens "/login"
      - the user fills "label=Email" with "{{personas.$persona.email}}"
      - the user fills "label=Password" with "{{personas.$persona.password}}"
      - the user clicks "role=button[Sign in]"
      - the user waits for "text=Dashboard" to appear
```

---

## 5. Reports & regression

The engine emits `@cucumber/messages` NDJSON as the canonical machine-readable
run output. Because Dataview **cannot** read external NDJSON/JSON (only Markdown
frontmatter + inline fields), the engine maintains two write targets:

1. **Canonical history** — append-only `.specorator/history/<caseId>.ndjson`
   (non-synced, one line per case-run).
2. **Managed frontmatter rollup** — written back into each case note (the
   managed block above) so Dataview dashboards work.

### History record

```json
{"v":1,"caseId":"TC-checkout-007","runId":"...","suite":"checkout","ts":"...",
 "status":"failed","attempts":1,"flakyInRun":false,"durationMs":3210,
 "env":"chromium-127","failedStep":{"text":"...","line":14,"status":"FAILED",
 "message":"timed out after 5000ms"},"reportNote":"Specorator/Reports/...md",
 "gitRef":"main@e4f9a1"}
```

Map cucumber's 7-status enum down to 3 (`passed`/`failed`/`skipped`) for
history/frontmatter; keep raw step status only in the report body/HTML.

### Flakiness scoring

Over the last `N=20` runs (configurable), with outcomes newest->oldest
`s1..sn` (`pass=1`,`fail=0`, skips excluded) and transition `ti=1` if
`si != si+1`:

```
flaky_score = ( sum(wi * ti) ) / ( sum(wi) ),  wi = 0.9^(i-1)
```

If any of the last N runs had `flakyInRun=true`, take
`flaky_score = max(flaky_score, 0.5)`. Thresholds: `<0.10` stable,
`0.10-0.34` suspect, `>=0.35` flaky. Require `N>=4` before scoring. Also surface
Allure's exact boolean (`allure_flaky`: failed within last 5, passed since,
failed latest) as a second high-confidence flag.

### Regression detection

Baseline = the most recent run on the configured baseline branch where the case
had a non-flaky verdict.

- **regression** — current `failed` AND baseline `passed` AND not flaky this run.
- **flaky-failure** — current `failed` but flaky; surfaced separately, not a regression.
- **new-test** — fewer than 2 prior runs; never a regression.
- **fixed** — current `passed`, baseline `failed`.

### Dataview dashboards (examples)

```dataview
TABLE flaky_score AS "Flaky", last_results AS "Last 10", runs_total AS "Runs"
FROM "Specorator/Suites"
WHERE specorator = "testcase" AND flaky_score != null
SORT flaky_score DESC
LIMIT 15
```

```dataview
TABLE file.link AS Case, suite, last_run, last_report
FROM "Specorator/Suites"
WHERE regression = true AND flaky_status != "flaky"
SORT last_run DESC
```

---

## 6. Canvas flows

A `.canvas` file (JSON Canvas 1.0) chains cases into an end-to-end journey.
JSON Canvas has no per-node metadata, so semantics encode in node type, color,
label, and text.

- **file node** -> a test case (`file` path; `subpath` `#heading` selects one
  scenario); the only node type that executes.
- **text node** -> annotation, unless its first line is a directive:
  `@start`, `@teardown`, `@config`, `@step: ...`.
- **group node** -> a stage; geometrically-contained file nodes with no
  intra-group edges run in parallel; the group joins before downstream edges.
- **link node** -> external reference, never executed.

**Edge semantics**: default/no-color = unconditional next; green (`"4"`) =
on-pass; red (`"1"`) = on-fail (the cleanup/error-path mechanism); `label` =
optional guard expression over flow vars. Fan-out of same-condition edges = run
concurrently with forked context; fan-in = AND-join by default (`join:any` for OR).

**Execution**: parse -> build directed graph -> find entry (`@start` or
indegree-0) -> Kahn's algorithm for ordering + cycle detection (DFS gray-node
for precise reporting; cycles are fatal) -> event-driven dispatch so branches
overlap -> on fail, suppress green edges / fire red edges; nodes reachable only
via suppressed edges are SKIPPED. Flow result = FAIL if any non-teardown case
failed; teardown nodes always run.

**FlowContext** threads one Playwright `BrowserContext` by reference on linear
chains (true session persistence); forks (storageState + var copy) on fan-out;
shallow-merges vars on fan-in. A case opts into a fresh context via
`flow.context: fresh`. Flow config lives in a companion `_flow.md`.

> Note: shared-state flows cut against the Gherkin "independent scenarios"
> guidance. Frame Canvas flows as deliberate E2E journeys (login -> create ->
> verify -> cleanup), not the default test shape.

---

## 7. MCP server & AI layer (opt-in, Claude Code)

A vault is a folder, so "installing" = writing files into `<vault>/.claude/`
and `.mcp.json`. The MCP server uses `@modelcontextprotocol/sdk` (import subpaths
end in `.js`: `@modelcontextprotocol/sdk/server/mcp.js`,
`.../server/stdio.js`).

### Tools (namespaced `spec_*`)

Read-only: `spec_list_suites`, `spec_get_suite`, `spec_list_cases`,
`spec_get_case`, `spec_validate_case`, `spec_get_report`, `spec_list_reports`,
`spec_get_screenshot`, `spec_get_flakiness`.
Mutating (`dryRun` default true, return a diff, `expectedRev` optimistic
concurrency): `spec_create_test_case`, `spec_update_test_case`.
Execution: `spec_run_case`, `spec_run_suite`, `spec_run_flow`.

All list_* paginate (`cursor`/`limit` -> `nextCursor`); large bodies returned as
`resource_link`s; structured errors with stable codes (`CASE_NOT_FOUND`,
`GHERKIN_PARSE_ERROR`, `VOCAB_UNMATCHED`, `OBSIDIAN_NOT_RUNNING`, `RUN_TIMEOUT`,
`REV_CONFLICT`, `SECRET_ACCESS_DENIED`).

### Execution-trigger channel

The MCP server is a stdio child of Claude Code, but running tests needs the live
app. **Primary**: the plugin hosts a `127.0.0.1` loopback server; on load it
writes non-synced `bridge.json` (`{port, token, pid, startedAt}`); the MCP server
discovers it (it runs with the vault as cwd), `POST /runs` with a bearer token,
and streams SSE step events mapped to MCP `notifications/progress`. The server
binds localhost-only and validates `Host`/`Origin`. **Fallback**: a file queue
(`.specorator/runqueue/<runId>.json` + result file) when the loopback is
unreachable; fail loudly (`OBSIDIAN_NOT_RUNNING`) rather than cold-launching the
wrong vault. `eval` is only an optional "nudge," never the result channel.

### Resources & prompts

Resources (custom scheme `specorator://`): `suite/{id}`, `case/{id}`,
`report/{id}`, `vocabulary`, `index`. Prompts: `spec_author_scenario`,
`spec_triage_failure`, `spec_repair_steps`, `spec_suite_summary`.

**Secret hard rules**: no tool/resource ever reads or returns
`.specorator/secrets.json`, `bridge.json`, the run queue, or raw history; a
redaction pass replaces resolved secret values / `${secret.*}` with `redacted`;
path-traversal guard rejects ids resolving outside the vault or into
`.specorator/`.

### Skills / subagents / commands

- **Skills** (`.claude/skills/*/SKILL.md`): `authoring-gherkin`,
  `flakiness-triage`, `locator-healer`.
- **Subagents** (`.claude/agents/*.md`): `spec-author`, `report-analyst`.
- **Commands** (`.claude/commands/*.md`, or merged skills): `/new-test-case`,
  `/run-suite`, `/triage-failures`.

**Self-healing locators** are opt-in and **diff-gated, never silent** (propose
"locator drifted X->Y, accept?") so they cannot mask a real regression.

---

## 8. Roadmap

### Gate-0 spikes (first)

1. The Obsidian renderer can spawn and stdio-talk to the Node sidecar (engine).
   Well-trodden by existing plugins; far lower risk than the demoted webview path.
2. System Chrome via Playwright `channel`, with on-demand browser download as
   fallback (browser binaries cannot ship in the community store).
3. *(Optional, only if pursuing the live-preview mode)* the WebView DOM/input
   spike: inspect the Web Viewer pane via `obsidian eval`, attempt a JS read and
   one synthetic click; if cross-origin opaque / input doesn't land, the
   WebviewDriver stays off.

### Phase 1 — Real MVP

Engine core · vocabulary + `(api)` setup family · PlaywrightDriver · single
scenario + suite run · `specorator run` CLI (CI) · reports/history · gherkin
code-block renderer with a Run button.

### Phase 2

Test Explorer view · tags / Scenario Outlines / Background / hooks /
rerun-failed · flakiness + regression · Dataview dashboards · YAML composites.

### Phase 3

Canvas flows · visual regression · WebView "watch live" mode (if the spike
passed) · `dev:screenshot` report capture.

### Phase 4

MCP server + opt-in Claude Code skills / subagents / commands.

---

## 9. Risk register (top 5)

| # | Risk | Mitigation / spike |
|---|------|--------------------|
| 1 | Renderer cannot spawn the Node sidecar | Gate-0 spike #1; CLI path is unaffected regardless |
| 2 | Browser binaries can't ship in the store | System Chrome via `channel` + on-demand download |
| 3 | Secret leakage (screenshots, MCP, NDJSON) | Taint-tracking + pre-capture masking; default-deny in MCP |
| 4 | WebView preview can't drive the page | Demoted off the critical path; gated on optional spike |
| 5 | Self-healing hides real regressions | Opt-in, diff-gated, never silent |

---

## 10. Key decisions log

1. **Foundation** = Obsidian frontmatter + Gherkin in a code fence, parsed via
   `@cucumber/gherkin` + `GherkinInMarkdownTokenMatcher`.
2. **Execution** = Playwright-primary (sidecar/CLI); WebviewDriver optional.
   *(Reversed from an initial WebviewDriver-default decision after risk review.)*
3. **Browser** = system Chrome via Playwright `channel`, on-demand fallback.
4. **AI target** = Claude Code (`.claude/` artifacts + `.mcp.json`).
5. **Custom steps** = vocabulary + YAML composites first; trusted TS later.
6. **Suite model** = folder + `_suite.md` index, one case per note.
7. **History** = non-synced NDJSON sidecar + managed frontmatter rollup for Dataview.
8. **MVP scope** = includes the `(api)` state-setup primitive and the
   `specorator run` CI CLI (the pillars that separate a tool from a toy).

---

## 11. Sources

- Obsidian CLI — https://obsidian.md/help/cli
- Obsidian Web Viewer — https://help.obsidian.md/plugins/web-viewer
- JSON Canvas 1.0 — https://jsoncanvas.org/spec/1.0/
- Obsidian Plugin API / Manifest — https://docs.obsidian.md/
- Electron `<webview>` / WebContentsView — https://www.electronjs.org/docs/latest/api/webview-tag/ , https://www.electronjs.org/docs/latest/api/web-contents-view
- electron#20333 (sendInputEvent to guest) — https://github.com/electron/electron/issues/20333
- cucumber/gherkin (GherkinInMarkdownTokenMatcher) — https://github.com/cucumber/gherkin
- Cucumber.js JavaScript API — https://github.com/cucumber/cucumber-js/blob/main/docs/javascript_api.md
- @cucumber/messages — https://github.com/cucumber/messages
- Playwright library / auth / API testing — https://playwright.dev/docs/library , https://playwright.dev/docs/auth
- Allure history & flakiness — https://allurereport.org/docs/history-and-retries/
- Dataview — https://blacksmithgu.github.io/obsidian-dataview/
- MCP TypeScript SDK — https://github.com/modelcontextprotocol/typescript-sdk
- MCP transports / resources — https://modelcontextprotocol.io/docs/concepts/transports , https://modelcontextprotocol.io/docs/concepts/resources
- Anthropic — writing tools for agents — https://www.anthropic.com/engineering/writing-tools-for-agents
- Claude Code skills / sub-agents — https://code.claude.com/docs/en/skills , https://code.claude.com/docs/en/sub-agents
