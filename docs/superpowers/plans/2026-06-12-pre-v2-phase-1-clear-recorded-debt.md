# Pre-V2 Phase 1 — Clear Recorded Debt V2 Builds On — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute §9 Phase 1 of the [V2 Research and Proposal](../../proposals/2026-06-11%20V2%20Research%20and%20Proposal.md) — items 1.1–1.12 ("Clear recorded debt V2 builds on": write serialization, the shared serial queue, output-event ordering, settings scalar repair, path hardening, `LiveRefresh` extraction, `register-commands` smoke test, and tech-debt items TD-001, TD-002, TD-003, TD-005, TD-004) — plus the `runInitialization` cognitive-complexity refactor recorded in TD-006's resolution (the known hot file that trips the now-blocking fallow gate on any edit).

**Architecture:** No new layers. One new shared utility (`src/shared/async/serial-queue.ts`) replaces two hand-rolled promise chains and gains two new users; one new presentation helper (`LiveRefresh`) collapses six copies of the view subscribe/teardown boilerplate; one new application-content module (`feature-validation.ts`) becomes the single source of structural Feature validation; the `GherkinStep` argument becomes a sum type in the domain; the Feature Editor's `commit()` loses its `structureChanged` flag in favour of always-re-render + focus restore. Everything else is in-place hardening.

**Tech Stack:** TypeScript (strict), Vitest, Obsidian plugin API, fallow (blocking CI quality gate), ESLint 10.

**Decisions locked in by this plan** (flag in review if any should change):

1. **Task order puts the `runInitialization` refactor first.** `.fallowrc.jsonc` documents the gate-scope caveat: any edit to a file brings that file's pre-existing findings into the blocking audit's scope. `initialization-service.ts` (`runInitialization`, cognitive 23) is the one *known* hot file — clearing it first removes the landmine for the rest of the increment and for V2.
2. **`SerialQueue` API is `run<T>(task)` + `whenSettled()`; `KeyedSerialQueue` adds a `key` dimension.** The two existing chains differ only cosmetically (`SettingsService.serialize()` rethreads via `catch`, `PostRunCoordinator.enqueue()` tracks completion-only); the canonical implementation keeps both behaviours: tasks run strictly in order, a failure reaches its own caller, and the chain survives. The review's deadlock constraint (a bus subscriber awaiting a queued operation from inside a handler the queued operation's publisher awaits) is carried over as a doc comment.
3. **Per-note serialization (1.1) wraps the read-modify-write sections of `DefaultUseCaseService`** keyed by note path. All three writers the review names (post-run linking, edit modal, feature linking) flow through `update()` / `updateMetadata()` (verified: `DefaultEvidenceGenerationService` calls `useCaseService.update()`), so the mutex inside the service covers them all.
4. **Output ordering (1.3) chains `testrun.output.received` per run** via `KeyedSerialQueue` and drains the run's chain inside `terminal()` before the terminal publish. The per-run queue is deleted after the terminal event.
5. **Settings repair (1.4) covers `ci.*` and `automation.*` scalars** with the existing log-and-fallback posture: invalid `ci.provider` → default, non-string `ci.workflowPath`/`ci.nodeVersion` → default, non-boolean automation flags → default, invalid `evidenceRetentionDays` → `undefined` (= keep forever). `logging.level` is already repaired.
6. **`joinVaultPath` treats `..` and absolute segments as programmer errors and throws** (ADR-0019: exceptions for programmer errors; its inputs are branded paths and trusted literals by contract — `vaultPath()`/PathSafetyPolicy screen user input upstream). `getVaultBasePath()` strips trailing separators once at the source.
7. **`LiveRefresh` is applied to all six `ItemView`s that use `RenderScheduler`** (the proposal says five; `SuiteDashboardView` has the byte-identical pattern and is included). `InitializationWizardModal` keeps its own `RenderScheduler` (different lifecycle, no event subscriptions of this shape).
8. **`vault.adapter.exists` migration (1.7) is Vault-API-first, not adapter-free.** `getAbstractFileByPath()` resolves indexed paths; the adapter stays as the documented fallback for paths Obsidian does not index (`.testrunner/`, evidence partitions before indexing). Full removal is impossible — the adapter *is* the API for unindexed files. `register-commands.ts` stays in the coverage `exclude` list (runtime-bound by convention); the new smoke test still runs.
9. **TD-001 implements all three official Gherkin table-cell escapes** (`\|`, `\\`, `\n`) — the playwright-bdd migration hands these files to the official parser, so partial compliance would re-create the debt.
10. **TD-002 takes option 1 (sum type).** Parser conflict rule: *first argument wins*; a later conflicting table row / doc string is dropped, the round-trip guard then fails the file into raw mode — correct, because Cucumber rejects such files too. `flagDoubleArguments` is deleted (the state is unrepresentable).
11. **TD-003 semantics:** empty-name uses `trim()` (the TD's stated better rule; service tests updated), and an orphan filename is an **error on both surfaces** (ADR-0012 calls it a validation error; the editor previously soft-pedalled it to a warning). One canonical message per rule.
12. **TD-005 chooses the lenient predicate** (`keyword === "Scenario Outline" || examples !== undefined`), matching `effectiveScenarioTagSets` today. Parse-time keyword normalisation is rejected for now: it changes round-trip behaviour for malformed files, and the lenient rule is what suite/tag matching already ships. The editor and validation move *to* the lenient rule (a plain scenario with attached Examples now shows its Examples grid instead of hiding round-tripped blocks).
13. **TD-004 uses positional `data-focus-key` capture/restore** (the TD's first proposed shape), not keyed DOM reconciliation. Field edits commit on `change` events (verified — not per keystroke), so a full re-render per commit is cheap enough; focus capture at commit time naturally picks up the *next* focused field when `change` fired because focus moved.

**Conventions that apply to every task:**

- All commands run from the repo root `/home/user/specorator-testrunner` on branch `claude/specorator-v2-increment-g137m7` (currently even with `origin/main`; baseline `npx fallow audit --base origin/main` verdict is `pass`).
- After every task: `npm run lint && npm run typecheck && npm test` must pass, then run `npx fallow audit --base origin/main` — the verdict must stay `pass`. **Gate-scope caveat (.fallowrc.jsonc):** if the audit flags a *pre-existing* finding in a file the task touched, fix it inside the task (preferred) or surface it in the task report — never suppress silently and never re-demote a rule.
- CHANGELOG entries go under `## [Unreleased]` (line 7; currently empty after the 1.0.0 cut). Create the `### Added` / `### Changed` / `### Fixed` subheadings on first use, in that order.
- Tech-debt closures: set frontmatter `status: resolved`, append a `## Resolution (2026-06-12)` section naming this plan, and move the item's row from **Open items** to **Resolved items** in `docs/tech-debt/README.md` with `pre-V2 Phase 1 increment (2026-06-12)` in the Resolved column.
- Line numbers cited below are pre-plan positions; earlier tasks shift later files. Anchor edits on the quoted code, not the number.

---

### Task 1: Refactor `runInitialization` below the complexity gate (TD-006 resolution follow-up)

**Files:**
- Modify: `src/application/services/initialization-service.ts:133-279`
- Test: `tests/initialization-service.test.ts` (no changes expected — behavioural refactor)

`runInitialization` (cognitive 23) is a 147-line method: 9 sequential phases, each with its own `onProgress` bracketing and `if (!x.ok) return fail(...)`, plus nested optionals (documentation, demo, dependencies→browsers). Extract each phase into a private step method over a shared context; the orchestrator becomes a loop. Public API, events, progress reports, and error semantics are unchanged — the existing test suite is the safety net and must pass untouched.

- [x] **Step 1: Add the context type and the failure helper**

In `initialization-service.ts`, above the service class (module scope, not exported), add:

```ts
/** Shared state threaded through the initialization step methods. */
interface InitializationContext {
  request: InitializeTestHubRequest;
  correlationId: string;
  onProgress: ProgressReporter;
  result: InitializeTestHubResult;
}
```

Inside the class, add the failure helper (replaces the `fail` closure):

```ts
/** Reports + publishes a step failure (UC-001 failure shape) and returns it. */
private async failStep(
  ctx: InitializationContext,
  step: InitializationStep,
  error: AppError,
): Promise<Result<never>> {
  ctx.onProgress({ step, label: step, status: "failed", detail: error.message });
  this.logger.error("Initialization failed", error, {
    correlationId: ctx.correlationId,
    step,
  });
  await this.eventBus.publish(
    createEvent(
      "testhub.initialization.failed",
      { reason: error.message, step },
      { correlationId: ctx.correlationId },
    ),
  );
  return err(error);
}
```

(Import `AppError` if not already imported in this file.)

- [x] **Step 2: Extract the eight step methods**

Each is a verbatim transplant of one numbered phase from the current body, rewritten against `ctx`. Add as private methods:

```ts
/** 1. Persist settings (defaults loaded + validated). */
private async persistSettingsStep(ctx: InitializationContext): Promise<Result<void>> {
  ctx.onProgress({ step: "settings", label: "Saving settings", status: "running" });
  const saved = await this.settingsService.save(ctx.request.settings);
  if (!saved.ok) return this.failStep(ctx, "settings", saved.error);
  ctx.onProgress({ step: "settings", label: "Saving settings", status: "done" });
  return ok(undefined);
}

/** 2. Create the vault folder structure (US-005). */
private async createFoldersStep(ctx: InitializationContext): Promise<Result<void>> {
  ctx.onProgress({ step: "folders", label: "Creating folders", status: "running" });
  const folders = await this.createFolders(ctx.request.settings);
  if (!folders.ok) return this.failStep(ctx, "folders", folders.error);
  ctx.result.createdFolders = folders.value;
  ctx.onProgress({
    step: "folders",
    label: "Creating folders",
    status: "done",
    detail: `${folders.value.length} folders`,
  });
  return ok(undefined);
}

/** 3. Documentation (US-009) — optional. */
private async documentationStep(ctx: InitializationContext): Promise<Result<void>> {
  if (!ctx.request.generateDocumentation) {
    ctx.onProgress({ step: "documentation", label: "Generating documentation", status: "skipped" });
    return ok(undefined);
  }
  ctx.onProgress({ step: "documentation", label: "Generating documentation", status: "running" });
  const docs = await this.documentation.generate(ctx.correlationId);
  if (!docs.ok) return this.failStep(ctx, "documentation", docs.error);
  ctx.result.createdFiles.push(...docs.value.documents);
  ctx.result.documentationGenerated = true;
  ctx.onProgress({ step: "documentation", label: "Generating documentation", status: "done" });
  return ok(undefined);
}

/** 4. Default suites (US-008): Smoke + Regression. */
private async defaultSuitesStep(ctx: InitializationContext): Promise<Result<void>> {
  ctx.onProgress({ step: "suites", label: "Creating default suites", status: "running" });
  const suites = await this.suites.createDefaults(ctx.correlationId);
  if (!suites.ok) return this.failStep(ctx, "suites", suites.error);
  ctx.result.defaultSuitesCreated = suites.value.map((suite) => suite.id);
  ctx.result.createdFiles.push(...suites.value.map((suite) => suite.path));
  ctx.onProgress({ step: "suites", label: "Creating default suites", status: "done" });
  return ok(undefined);
}

/** 5. Demo content (US-006/US-007) — optional. */
private async demoContentStep(ctx: InitializationContext): Promise<Result<void>> {
  if (!ctx.request.generateDemoContent) {
    ctx.onProgress({ step: "demo", label: "Generating demo content", status: "skipped" });
    return ok(undefined);
  }
  ctx.onProgress({ step: "demo", label: "Generating demo content", status: "running" });
  const demo = await this.demo.generate();
  if (!demo.ok) return this.failStep(ctx, "demo", demo.error);
  ctx.result.createdFiles.push(demo.value.useCasePath, demo.value.featurePath);
  ctx.result.demoGenerated = true;
  ctx.onProgress({ step: "demo", label: "Generating demo content", status: "done" });
  return ok(undefined);
}

/** 6. Materialise the .testrunner project (US-010, RV-1). */
private async createRunnerStep(ctx: InitializationContext): Promise<Result<void>> {
  ctx.onProgress({ step: "runner", label: "Creating runner project", status: "running" });
  const runner = await this.runnerInstall.createRunner(ctx.request.settings, ctx.correlationId);
  if (!runner.ok) return this.failStep(ctx, "runner", runner.error);
  ctx.result.runnerInstalled = true;
  ctx.result.createdFiles.push(...runner.value.createdFiles);
  ctx.onProgress({ step: "runner", label: "Creating runner project", status: "done" });
  return ok(undefined);
}

/**
 * 7.+8. Install dependencies (US-011), then browsers (US-012) only after
 * deps succeed. A non-zero exit fails init (RV-1).
 */
private async installDependenciesStep(ctx: InitializationContext): Promise<Result<void>> {
  if (!ctx.request.installDependencies) {
    ctx.onProgress({ step: "dependencies", label: "Installing dependencies", status: "skipped" });
    return ok(undefined);
  }
  ctx.onProgress({ step: "dependencies", label: "Installing dependencies", status: "running" });
  const deps = await this.runnerInstall.installDependencies(ctx.request.settings);
  if (!deps.ok) return this.failStep(ctx, "dependencies", deps.error);
  ctx.onProgress({ step: "dependencies", label: "Installing dependencies", status: "done" });

  if (ctx.request.installBrowsers) {
    ctx.onProgress({ step: "browsers", label: "Installing browsers", status: "running" });
    const browsers = await this.runnerInstall.installBrowsers(ctx.request.settings);
    if (!browsers.ok) return this.failStep(ctx, "browsers", browsers.error);
    ctx.onProgress({ step: "browsers", label: "Installing browsers", status: "done" });
  }
  return ok(undefined);
}

/**
 * 9. Validate the environment (US-013, UC-002). Diagnostic only — an
 * incomplete environment (e.g. skipped install) does not fail init.
 */
private async validateEnvironmentStep(ctx: InitializationContext): Promise<Result<void>> {
  ctx.onProgress({ step: "validate", label: "Validating environment", status: "running" });
  const validation = await this.validation.validateEnvironment(ctx.correlationId);
  ctx.onProgress({
    step: "validate",
    label: "Validating environment",
    status: "done",
    detail: validation.valid ? "ready" : `${validation.issues.length} issue(s)`,
  });
  return ok(undefined);
}
```

- [x] **Step 3: Collapse `runInitialization` to the pipeline**

Replace the entire current body (keep the existing leading doc comments about `vaultPath` and the correlation id — move them onto the matching lines):

```ts
private async runInitialization(
  request: InitializeTestHubRequest,
  onProgress: ProgressReporter = () => {},
  suppliedCorrelationId?: string,
): Promise<Result<InitializeTestHubResult>> {
  // The Test Hub folder is the in-vault root the wizard initializes; the
  // catalog's `vaultPath` is reported as that configured path (the service
  // has no handle to the absolute vault root, and only writes vault-relative).
  const vaultPath = request.settings.paths.testHubPath;
  const started = createEvent("testhub.initialization.started", { vaultPath }, { source: "user" });
  // A reset threads in its own invocation id so `settings.reset` and this
  // chain group under one correlationId (UC-024, Event Catalog §19); the
  // wizard path falls back to the started event's id (UC-001).
  const correlationId = suppliedCorrelationId ?? started.id;
  await this.eventBus.publish({ ...started, correlationId });
  this.logger.info("Initializing Test Hub", { correlationId });

  const ctx: InitializationContext = {
    request,
    correlationId,
    onProgress,
    result: {
      createdFolders: [],
      createdFiles: [],
      defaultSuitesCreated: [],
      runnerInstalled: false,
      documentationGenerated: false,
      demoGenerated: false,
    },
  };

  const steps: ((ctx: InitializationContext) => Promise<Result<void>>)[] = [
    (c) => this.persistSettingsStep(c),
    (c) => this.createFoldersStep(c),
    (c) => this.documentationStep(c),
    (c) => this.defaultSuitesStep(c),
    (c) => this.demoContentStep(c),
    (c) => this.createRunnerStep(c),
    (c) => this.installDependenciesStep(c),
    (c) => this.validateEnvironmentStep(c),
  ];
  for (const step of steps) {
    const outcome = await step(ctx);
    if (!outcome.ok) return outcome;
  }

  await this.eventBus.publish(
    createEvent(
      "testhub.initialization.completed",
      {
        testHubPath: request.settings.paths.testHubPath,
        runnerPath: request.settings.paths.testRunnerPath,
      },
      { correlationId },
    ),
  );
  this.logger.info("Test Hub initialized", {
    correlationId,
    folders: ctx.result.createdFolders.length,
    files: ctx.result.createdFiles.length,
  });
  return ok(ctx.result);
}
```

- [x] **Step 4: Verify behaviour is unchanged and the hot spot is gone**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all green, `tests/initialization-service.test.ts` untouched and passing.

Run: `npx fallow audit --base origin/main`
Expected: verdict `pass` with **no complexity finding** on `initialization-service.ts` — this proves the recorded TD-006 caveat ("edits to `initialization-service.ts` will trip the gate until refactored") is retired.

- [x] **Step 5: Update the TD-006 caveat record + CHANGELOG**

In `.fallowrc.jsonc`, replace the caveat sentence inside the CI-gate comment:

```jsonc
  // launch-default thresholds need no inventory-wide tuning. Caveat: any edit
  // to a file places that file's findings in scope, where pre-existing
  // complexity can surface (observed on PR #33 — a comment-only edit to
  // initialization-service.ts tripped the gate on runInitialization). Revisit
  // the thresholds only if the blocking gate proves noisy in practice.
```

with:

```jsonc
  // launch-default thresholds need no inventory-wide tuning. Caveat: any edit
  // to a file places that file's findings in scope, where pre-existing
  // complexity can surface (observed on PR #33; the runInitialization hot
  // spot it flagged was refactored in the pre-V2 Phase 1 increment). Revisit
  // the thresholds only if the blocking gate proves noisy in practice.
```

In `CHANGELOG.md` under `## [Unreleased]` add (creating the heading):

```markdown
### Changed

- `runInitialization` is decomposed into per-phase step methods (behaviour
  unchanged), retiring the known complexity hot spot that tripped the
  blocking quality gate on any edit to `initialization-service.ts`.
```

- [x] **Step 6: Commit**

```bash
git add src/application/services/initialization-service.ts .fallowrc.jsonc CHANGELOG.md
git commit -m "refactor: decompose runInitialization into step methods (pre-V2 1.x gate caveat)"
```

---

### Task 2: Extract `SerialQueue` / `KeyedSerialQueue` and migrate the two existing chains (item 1.2)

**Files:**
- Create: `src/shared/async/serial-queue.ts`
- Create: `tests/serial-queue.test.ts`
- Modify: `src/application/services/settings-service.ts:95-112` (the `persistChain` + `serialize` block) and its `save()`/`reset()` callers
- Modify: `src/application/services/post-run-coordinator.ts:82-85,197-205` (the `evidenceChain` + `enqueue` block) and its callers

- [x] **Step 1: Write the failing tests**

Create `tests/serial-queue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { KeyedSerialQueue, SerialQueue } from "../src/shared/async/serial-queue";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("SerialQueue", () => {
  it("runs tasks strictly in order — a queued task cannot start before the previous settles", async () => {
    const queue = new SerialQueue();
    const order: string[] = [];
    const gate = deferred<void>();
    const first = queue.run(async () => {
      order.push("first:start");
      await gate.promise;
      order.push("first:end");
    });
    const second = queue.run(async () => {
      order.push("second");
    });
    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("survives a failing task: the failure reaches its caller, the next task still runs", async () => {
    const queue = new SerialQueue();
    const failing = queue.run(async () => {
      throw new Error("boom");
    });
    const next = queue.run(async () => "ran");
    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ran");
  });

  it("whenSettled resolves only after the queued tail settles (including failures)", async () => {
    const queue = new SerialQueue();
    let done = false;
    const gate = deferred<void>();
    void queue.run(async () => {
      await gate.promise;
      throw new Error("still counts as settled");
    });
    void queue.run(async () => {
      done = true;
    });
    const settled = queue.whenSettled().then(() => done);
    gate.resolve();
    await expect(settled).resolves.toBe(true);
  });
});

describe("KeyedSerialQueue", () => {
  it("serializes per key while other keys proceed independently", async () => {
    const queues = new KeyedSerialQueue();
    const order: string[] = [];
    const gate = deferred<void>();
    const a1 = queues.run("a", async () => {
      await gate.promise;
      order.push("a1");
    });
    const a2 = queues.run("a", async () => {
      order.push("a2");
    });
    const b1 = queues.run("b", async () => {
      order.push("b1");
    });
    await b1;
    expect(order).toEqual(["b1"]);
    gate.resolve();
    await Promise.all([a1, a2]);
    expect(order).toEqual(["b1", "a1", "a2"]);
  });

  it("whenSettled on an unknown key resolves immediately; delete drops a key's queue", async () => {
    const queues = new KeyedSerialQueue();
    await expect(queues.whenSettled("none")).resolves.toBeUndefined();
    await queues.run("k", async () => undefined);
    queues.delete("k");
    await expect(queues.whenSettled("k")).resolves.toBeUndefined();
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/serial-queue.test.ts`
Expected: FAIL — cannot resolve `../src/shared/async/serial-queue`.

- [x] **Step 3: Implement the module**

Create `src/shared/async/serial-queue.ts`:

```ts
/**
 * Serializes async tasks into one promise chain: each task starts only after
 * every previously queued task has settled; the chain survives failures (a
 * failure still reaches that task's own caller).
 *
 * Extracted (2026-06-11 review §4) from `SettingsService.serialize()` and
 * `PostRunCoordinator.enqueue()` when the per-path Use Case note mutex became
 * the third user. Documented constraint carried over from both originals: a
 * bus subscriber that AWAITS a queued operation from inside a handler whose
 * publish the queued operation itself awaits would deadlock the chain — keep
 * queued tasks free of such re-entrant awaits (none exists today).
 */
export class SerialQueue {
  private chain: Promise<unknown> = Promise.resolve();

  /** Queues `task` behind every previously queued task. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task);
    // Track only settlement (never the value, never the rejection) so the
    // chain survives a failed task; the failure still reaches `result`'s
    // caller.
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Resolves once every task queued SO FAR has settled (success or failure). */
  whenSettled(): Promise<void> {
    return this.chain.then(() => undefined);
  }
}

/** One lazily created SerialQueue per key (per-path / per-run serialization). */
export class KeyedSerialQueue {
  private readonly queues = new Map<string, SerialQueue>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    let queue = this.queues.get(key);
    if (!queue) {
      queue = new SerialQueue();
      this.queues.set(key, queue);
    }
    return queue.run(task);
  }

  /** Resolves once every task queued so far under `key` has settled. */
  whenSettled(key: string): Promise<void> {
    return this.queues.get(key)?.whenSettled() ?? Promise.resolve();
  }

  /** Drops the queue for `key` (call when the keyed lifecycle ends). */
  delete(key: string): void {
    this.queues.delete(key);
  }
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/serial-queue.test.ts`
Expected: PASS (5 tests).

- [x] **Step 5: Migrate `SettingsService`**

In `settings-service.ts`, delete the `persistChain` field and the `serialize()` method (lines 95–112 including their doc comments) and replace with:

```ts
/**
 * Serializes save()/reset() persistence. The settings tab debounces saves
 * PER FIELD (P4-9), so two quick edits to different fields produce two
 * overlapping save() calls; without serialization both would read the same
 * "previous", interleave their load→save→diff sections, and the last
 * whole-object write would win — silently dropping the first change (F2).
 */
private readonly persistQueue = new SerialQueue();
```

In `save()` and `reset()`, change `return this.serialize(async () => {` to `return this.persistQueue.run(async () => {` (bodies unchanged). Add the import:

```ts
import { SerialQueue } from "../../shared/async/serial-queue";
```

- [x] **Step 6: Migrate `PostRunCoordinator`**

In `post-run-coordinator.ts`, delete the `evidenceChain` field and the `enqueue()` method (with their doc comments) and replace the field with:

```ts
// Post-run import+evidence reads then writes Use Case frontmatter, so back-to-
// back runs could interleave and clobber each other's evidence/last_run fields
// — serialize them through a single queue (shared SerialQueue, review §4).
private readonly postRunQueue = new SerialQueue();
```

Change both call sites from `this.enqueue(() => this.runImportAndGenerate(run))` to `this.postRunQueue.run(() => this.runImportAndGenerate(run))`, and the unload-drain member (the one awaiting `evidenceChain`; the coordinator test calls it `whenSettled()` around `tests/post-run-coordinator.test.ts:135`) to delegate:

```ts
return this.postRunQueue.whenSettled();
```

Add the same `SerialQueue` import.

- [x] **Step 7: Verify**

Run: `npm run lint && npm run typecheck && npm test && npx fallow audit --base origin/main`
Expected: all green (in particular `settings-service.test.ts`'s F2 interleaving test and `post-run-coordinator.test.ts` unchanged and passing); audit `pass`.

- [x] **Step 8: CHANGELOG + commit**

Under `## [Unreleased]` → `### Changed` add:

```markdown
- The hand-rolled persistence chains in `SettingsService` and
  `PostRunCoordinator` now share one `SerialQueue` utility
  (`src/shared/async/serial-queue.ts`), extracted now that per-note Use Case
  write serialization is its third user.
```

```bash
git add src/shared/async/serial-queue.ts tests/serial-queue.test.ts src/application/services/settings-service.ts src/application/services/post-run-coordinator.ts CHANGELOG.md
git commit -m "refactor: extract shared SerialQueue from settings/post-run chains (pre-V2 1.2)"
```

---

### Task 3: Per-note write serialization in `DefaultUseCaseService` (item 1.1)

**Files:**
- Modify: `src/application/services/use-case-service.ts` (`create` ~72, `update` ~146, `updateMetadata` ~207)
- Test: `tests/use-case-service.test.ts`

UC notes have three read-modify-write writers (post-run linking via `EvidenceGenerationService → update()`, the edit modal via `updateMetadata()`, feature linking via `update()`) that can interleave across awaits. Key a `KeyedSerialQueue` by note path and wrap each method's read→transform→write(→publish) section.

- [x] **Step 1: Write the failing interleaving test**

Add to `tests/use-case-service.test.ts` (reuse the existing `build()` helper; adapt the create-request shape and `UseCaseMetadataChanges` fields to the ones used by the neighbouring tests in that file):

```ts
it("serializes overlapping writes to the same note so read-modify-write can't interleave", async () => {
  const { service, fs } = build();
  const created = await service.create({ title: "Order checkout" /* match the file's create-request shape */ });
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  const { id, path } = created.value;

  // Record the note's read/write order, gating the FIRST read so the second
  // call can overtake it if the service does not serialize.
  const order: string[] = [];
  let releaseFirstRead: () => void = () => {};
  const firstReadGate = new Promise<void>((resolve) => (releaseFirstRead = resolve));
  let reads = 0;
  const realRead = fs.readFile.bind(fs);
  const realWrite = fs.writeFile.bind(fs);
  fs.readFile = async (p) => {
    if (p === path) {
      order.push("read");
      reads += 1;
      if (reads === 1) await firstReadGate;
    }
    return realRead(p);
  };
  fs.writeFile = async (p, content) => {
    if (p === path) order.push("write");
    return realWrite(p, content);
  };

  const first = service.updateMetadata(id, { title: "Renamed by writer one" });
  const second = service.updateMetadata(id, { title: "Renamed by writer two" });
  releaseFirstRead();
  expect((await first).ok).toBe(true);
  expect((await second).ok).toBe(true);

  // Each writer must complete its read→write before the next one reads.
  // (findById reads before the lock, so assert on the trailing RMW window.)
  expect(order.slice(-4)).toEqual(["read", "write", "read", "write"]);
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/use-case-service.test.ts -t "serializes overlapping writes"`
Expected: FAIL — the gated first read lets the second call's read+write land first, so the tail is not `read,write,read,write` (typically `read,read,write,write` or the gated read finishing last).

If it unexpectedly passes, the gate placement needs tightening (e.g. gate inside the *second* RMW read) — make it fail before implementing; a test that can't fail proves nothing.

- [x] **Step 3: Add the keyed queue and wrap the writers**

In `use-case-service.ts`:

```ts
import { KeyedSerialQueue } from "../../shared/async/serial-queue";
```

Add the field to `DefaultUseCaseService`:

```ts
// UC notes have three read-modify-write writers (post-run linking, edit
// modal, feature linking) that can interleave across awaits (review §4);
// serialize all note I/O per path. V2 adds more writers (history rollups,
// evidence stamps, sign-off links) on top of this same mutex.
private readonly noteWrites = new KeyedSerialQueue();
```

- In `create()`: wrap the note write, keyed by the computed path:

```ts
const created = await this.noteWrites.run(path, () =>
  this.fs.createFile(path, buildUseCaseNote(useCase)),
);
```

- In `update()`: wrap the whole existing read→build→write(→publish) body from the `this.fs.readFile(useCase.path)` line through the event publish in `return this.noteWrites.run(useCase.path, async () => { ... existing code ... });` so the publish stays ordered with the write it reports.
- In `updateMetadata()`: keep the lookup (`findById`/validation) outside, then wrap from the `this.fs.readFile(existing.path)` line through write + publish + return in `return this.noteWrites.run(existing.path, async () => { ... existing code ... });`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/use-case-service.test.ts`
Expected: PASS, including the new interleaving test and all pre-existing tests.

- [x] **Step 5: Verify, CHANGELOG, commit**

Run: `npm run lint && npm run typecheck && npm test && npx fallow audit --base origin/main`
Expected: all green; audit `pass`.

Under `### Fixed` (create the heading) add:

```markdown
- Concurrent writers to the same Use Case note (post-run evidence linking,
  the edit modal, feature linking) are now serialized per note path, so
  overlapping read-modify-write updates can no longer drop each other's
  frontmatter changes.
```

```bash
git add src/application/services/use-case-service.ts tests/use-case-service.test.ts CHANGELOG.md
git commit -m "fix: serialize Use Case note writes per path (pre-V2 1.1)"
```

---

### Task 4: Output-event ordering — drain `testrun.output.received` before the terminal publish (item 1.3)

**Files:**
- Modify: `src/application/services/test-execution-service.ts` (streaming callback ~401-413, `terminal()` ~751-764)
- Test: `tests/test-execution-service.test.ts`

`testrun.output.received` publishes are fire-and-forget (`void this.publish(...)`); an async subscriber can still be processing a line when `testrun.completed` lands — late-line-after-banner. Chain output publishes per run and await the tail inside `terminal()` (EPIC-014 scenario attribution needs deterministic ordering).

- [x] **Step 1: Write the failing test**

Add to `tests/test-execution-service.test.ts`, following that file's existing builder/run-execution helpers (it already scripts `FakeChildProcessRunner` output lines and a recording bus — mirror the closest existing "publishes testrun.output.received" test's setup):

```ts
it("publishes the terminal event only after every streamed output event has been delivered", async () => {
  // Arrange a run whose fake child process emits at least one output line
  // (reuse the file's standard execute() setup), plus a SLOW async
  // subscriber on output events:
  const sequence: string[] = [];
  bus.subscribe("testrun.output.received", async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    sequence.push("output");
  });
  bus.subscribe("testrun.completed", () => {
    sequence.push("terminal");
  });

  await /* the file's standard successful execute() call */;

  expect(sequence.length).toBeGreaterThan(1);
  expect(sequence.at(-1)).toBe("terminal");
  expect(sequence.slice(0, -1).every((entry) => entry === "output")).toBe(true);
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/test-execution-service.test.ts -t "only after every streamed output"`
Expected: FAIL — with fire-and-forget publishes the slow output handler resolves after the terminal handler, so `sequence` ends with `"output"`.

- [x] **Step 3: Chain the publishes and drain in `terminal()`**

In `test-execution-service.ts`:

```ts
import { KeyedSerialQueue } from "../../shared/async/serial-queue";
```

Add the field:

```ts
// testrun.output.received publishes were fire-and-forget; chain them per run
// so the terminal publish can await the tail — a late line can never land
// after the completed/failed/cancelled banner (review §4; EPIC-014 needs
// deterministic output ordering for scenario attribution).
private readonly outputPublishes = new KeyedSerialQueue();
```

Replace the streaming callback body (~line 408):

```ts
(output) => {
  void this.outputPublishes.run(run.id, () =>
    this.publish("testrun.output.received", run.id, {
      runId: run.id,
      stream: output.stream,
      line: redactSecrets(output.line, runSecrets),
    }),
  );
},
```

In `terminal()` (after the `terminated` guard flips, before `lastFinishedRun` is set):

```ts
if (activeRun.terminated) return;
activeRun.terminated = true;
// Drain the run's chained output publishes so no testrun.output.received
// can be delivered after the terminal event; then drop the run's queue.
await this.outputPublishes.whenSettled(activeRun.run.id);
this.outputPublishes.delete(activeRun.run.id);
this.lastFinishedRun = activeRun.run;
await this.publish(type, activeRun.run.id, payload);
```

If `activeRun` is in scope of the streaming callback (check the surrounding `execute()` body), additionally guard the callback with `if (activeRun.terminated) return;` so a line racing a cancel cannot enqueue after the drain; if it is not in scope, skip this guard and note it in the task report (the review records the race as low-impact).

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/test-execution-service.test.ts`
Expected: PASS — new test green, and the existing run-lifecycle/EN-2 tests unchanged and green (the drain must not reorder `suite.executed`, snapshot, or cancel semantics; those publishes are awaited and unaffected).

- [x] **Step 5: Verify, CHANGELOG, commit**

Run: `npm run lint && npm run typecheck && npm test && npx fallow audit --base origin/main`
Expected: all green; audit `pass`. (`test-execution-service.ts` is large — if the audit surfaces a pre-existing finding pulled into scope by this edit, fix it in this task or report it; do not suppress.)

Under `### Fixed` add:

```markdown
- Streamed runner output events are now chained per run and drained before
  the terminal run event, so a late output line can no longer arrive after
  the completed/failed/cancelled banner.
```

```bash
git add src/application/services/test-execution-service.ts tests/test-execution-service.test.ts CHANGELOG.md
git commit -m "fix: drain chained output events before the terminal run event (pre-V2 1.3)"
```

---

### Task 5: Extend settings scalar repair to `ci.*` / `automation.*` (item 1.4)

**Files:**
- Modify: `src/application/services/settings-service.ts` (`load()` ~114-119; new private method)
- Test: `tests/settings-service.test.ts`

`load()` already repairs paths, `logging.level`, runner env inputs, and the `sut` shape; `ci.*` and `automation.*` scalars pass through `mergeWithDefaults` unscreened, so a tampered/synced `data.json` can crash `.trim()` call sites (`ci.nodeVersion.trim()` in `validate()`) or flip automation behaviour with truthy garbage. V2 adds settings (workers, browsers, retention, MCP toggle) — the posture must exist before the surface grows.

- [x] **Step 1: Write the failing tests**

Add to `tests/settings-service.test.ts` (reuse the file's `FakeDataStore` / `DefaultPathSafetyPolicy` / bus setup; pass the logger spy the same way the existing repair tests do — check the constructor's logger parameter position):

```ts
describe("scalar shape repair (ci.* / automation.*)", () => {
  it("repairs tampered ci scalars to their defaults on load", async () => {
    const store = new FakeDataStore();
    await store.save({
      ...DEFAULT_SETTINGS,
      ci: { provider: "circleci", workflowPath: 42, nodeVersion: null },
    });
    const service = buildServiceWith(store);
    const settings = await service.load();
    expect(settings.ci).toEqual(DEFAULT_SETTINGS.ci);
  });

  it("repairs tampered automation flags and retention to safe values", async () => {
    const store = new FakeDataStore();
    await store.save({
      ...DEFAULT_SETTINGS,
      automation: {
        ...DEFAULT_SETTINGS.automation,
        autoCreateFolders: "yes",
        generateEvidenceMarkdown: 1,
        evidenceRetentionDays: "30",
      },
    });
    const service = buildServiceWith(store);
    const settings = await service.load();
    expect(settings.automation.autoCreateFolders).toBe(DEFAULT_SETTINGS.automation.autoCreateFolders);
    expect(settings.automation.generateEvidenceMarkdown).toBe(
      DEFAULT_SETTINGS.automation.generateEvidenceMarkdown,
    );
    expect(settings.automation.evidenceRetentionDays).toBeUndefined();
  });

  it("keeps valid ci/automation values untouched (incl. a real retention number)", async () => {
    const store = new FakeDataStore();
    await store.save({
      ...DEFAULT_SETTINGS,
      ci: { provider: "azure-devops", workflowPath: "pipelines/e2e.yml", nodeVersion: "20" },
      automation: { ...DEFAULT_SETTINGS.automation, evidenceRetentionDays: 30 },
    });
    const service = buildServiceWith(store);
    const settings = await service.load();
    expect(settings.ci).toEqual({
      provider: "azure-devops",
      workflowPath: "pipelines/e2e.yml",
      nodeVersion: "20",
    });
    expect(settings.automation.evidenceRetentionDays).toBe(30);
  });
});
```

(`buildServiceWith(store)` = the file's existing service construction with the custom store; add a tiny local helper if one doesn't exist.)

- [x] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/settings-service.test.ts -t "scalar shape repair"`
Expected: the two tampered-value tests FAIL (the garbage values pass through); the valid-values test passes.

- [x] **Step 3: Implement `sanitizeScalarShapes`**

In `settings-service.ts`, add module-level (next to `LOG_LEVELS`):

```ts
const CI_PROVIDERS: ReadonlySet<string> = new Set([
  "github-actions",
  "azure-devops",
  "none",
] satisfies CiProvider[]);
```

Add the private method (mirroring the `sanitizePaths` log-and-fallback posture):

```ts
/**
 * Repairs `ci.*` / `automation.*` scalars with the same log-and-fallback
 * posture as {@link sanitizePaths} (review §4): a tampered/synced data.json
 * must not crash `.trim()` call sites or flip automation behaviour with
 * truthy garbage. V2 grows both sections; new scalars get screened here.
 */
private sanitizeScalarShapes(settings: TestHubSettings): TestHubSettings {
  const repair = <T>(field: string, value: unknown, valid: boolean, fallback: T): T => {
    if (valid) return value as T;
    this.logger.error(
      `Configured "${field}" has an invalid value; falling back to the default.`,
      undefined,
      { field, value, fallback },
    );
    return fallback;
  };
  const booleanFlag = (field: keyof AutomationSettings & string): boolean =>
    repair(
      `automation.${field}`,
      settings.automation[field],
      typeof settings.automation[field] === "boolean",
      DEFAULT_SETTINGS.automation[field] as boolean,
    );
  const retention = settings.automation.evidenceRetentionDays;
  return {
    ...settings,
    ci: {
      provider: repair(
        "ci.provider",
        settings.ci.provider,
        typeof settings.ci.provider === "string" && CI_PROVIDERS.has(settings.ci.provider),
        DEFAULT_SETTINGS.ci.provider,
      ),
      workflowPath: repair(
        "ci.workflowPath",
        settings.ci.workflowPath,
        typeof settings.ci.workflowPath === "string",
        DEFAULT_SETTINGS.ci.workflowPath,
      ),
      nodeVersion: repair(
        "ci.nodeVersion",
        settings.ci.nodeVersion,
        typeof settings.ci.nodeVersion === "string",
        DEFAULT_SETTINGS.ci.nodeVersion,
      ),
    },
    automation: {
      autoCreateFolders: booleanFlag("autoCreateFolders"),
      autoCreateDocumentation: booleanFlag("autoCreateDocumentation"),
      autoCreateDemoContent: booleanFlag("autoCreateDemoContent"),
      updateUseCaseFrontmatterAfterRun: booleanFlag("updateUseCaseFrontmatterAfterRun"),
      generateEvidenceMarkdown: booleanFlag("generateEvidenceMarkdown"),
      openDashboardAfterInitialization: booleanFlag("openDashboardAfterInitialization"),
      // undefined = keep forever (the V1 default) — also the repair fallback.
      evidenceRetentionDays: repair(
        "automation.evidenceRetentionDays",
        retention,
        retention === undefined ||
          (typeof retention === "number" && Number.isFinite(retention) && retention > 0),
        undefined,
      ),
    },
  };
}
```

Import `CiProvider` and `AutomationSettings` from the domain settings module if not present. Wire it into `load()`:

```ts
async load(): Promise<TestHubSettings> {
  const settings = this.sanitizeScalarShapes(
    this.sanitizeRunnerEnvInputs(this.sanitizePaths(mergeWithDefaults(await this.store.load()))),
  );
  return { ...settings, onboarding: repairOnboardingShape(settings.onboarding) };
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/settings-service.test.ts`
Expected: PASS — new tests green, all existing repair/F2 tests unchanged and green.

- [x] **Step 5: Verify, CHANGELOG, commit**

Run: `npm run lint && npm run typecheck && npm test && npx fallow audit --base origin/main`
Expected: all green; audit `pass`.

Under `### Fixed` add:

```markdown
- Settings repair on load now also screens `ci.*` and `automation.*` scalars
  (provider/workflow/node-version strings, automation booleans, evidence
  retention), so a tampered or synced `data.json` falls back to defaults
  instead of crashing or silently flipping automation behaviour.
```

```bash
git add src/application/services/settings-service.ts tests/settings-service.test.ts CHANGELOG.md
git commit -m "fix: repair ci.* and automation.* settings scalars on load (pre-V2 1.4)"
```

---

### Task 6: Path plumbing hardening (item 1.5)

**Files:**
- Modify: `src/infrastructure/filesystem/node-absolute-file-system.ts:16-20` (`getVaultBasePath`)
- Modify: `src/shared/utils/vault-path.ts:14-19` (`joinVaultPath`)
- Create: `tests/vault-path.test.ts`
- Modify: `tests/node-absolute-file-system.test.ts`

The migration and the MCP server (later) both mint paths from these two helpers; close the gaps before new callers appear.

- [x] **Step 1: Write the failing tests**

Create `tests/vault-path.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { joinVaultPath, relativeVaultPath } from "../src/shared/utils/vault-path";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

describe("joinVaultPath", () => {
  it("joins segments with '/', collapsing duplicate and trailing separators", () => {
    expect(joinVaultPath("TestHub", "", "Evidence//2026/", "")).toBe("TestHub/Evidence/2026");
  });

  it("throws on an absolute segment (vault paths are vault-relative, ADR-0008)", () => {
    expect(() => joinVaultPath("/etc", "passwd")).toThrow(/absolute segment/);
    expect(() => joinVaultPath("TestHub", "\\windows")).toThrow(/absolute segment/);
  });

  it("throws on a traversal segment ('..' may never appear in a vault path)", () => {
    expect(() => joinVaultPath("TestHub", "..")).toThrow(/traversal segment/);
    expect(() => joinVaultPath("a/../b", "c")).toThrow(/traversal segment/);
    // A dotfile or '..' inside a NAME is fine — only path-level '..' is a bug.
    expect(joinVaultPath("notes", "..hidden..name")).toBe("notes/..hidden..name");
  });
});

describe("relativeVaultPath (pinned: unchanged by the joinVaultPath guard)", () => {
  it("still produces '..' hops between sibling folders", () => {
    expect(relativeVaultPath(vp("TestHub/.testrunner"), vp("TestHub/features"))).toBe(
      "../features",
    );
  });
});
```

Add to `tests/node-absolute-file-system.test.ts` (inside the existing `vi.mock("obsidian", ...)` arrangement — extend the mocked `FileSystemAdapter` so `getBasePath()` is controllable):

```ts
it("getVaultBasePath strips trailing separators once at the source", async () => {
  // Arrange the mocked FileSystemAdapter's getBasePath to return a path with
  // trailing separators (follow the file's existing adapter-mock pattern):
  // "/vaults/my vault///" and "C:\\vaults\\mine\\".
  // Assert both come back without any trailing separator:
  // "/vaults/my vault" and "C:\\vaults\\mine".
});
```

(Write the body against the file's actual mock plumbing — the mock class is defined at `tests/node-absolute-file-system.test.ts:22`; give it a constructor/static field for the base path if it doesn't have one.)

- [x] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/vault-path.test.ts tests/node-absolute-file-system.test.ts`
Expected: the throw-cases and trailing-separator test FAIL (current code neither validates nor strips).

- [x] **Step 3: Implement both guards**

`src/shared/utils/vault-path.ts` — replace `joinVaultPath` (keep its existing doc comment, append the new paragraph):

```ts
/**
 * (existing doc comment paragraphs stay)
 *
 * Guard (review §4): segments must be vault-relative and traversal-free —
 * an absolute or `..` segment reaching this trusted brander is a programmer
 * error (ADR-0019), not user input (user paths are screened upstream by the
 * `vaultPath()` smart constructor / PathSafetyPolicy), so it throws.
 */
export const joinVaultPath = (...segments: (string | VaultPath)[]): VaultPath => {
  for (const segment of segments) {
    if (segment.startsWith("/") || segment.startsWith("\\")) {
      throw new Error(
        `joinVaultPath: absolute segment "${segment}" — vault paths are vault-relative (ADR-0008).`,
      );
    }
    if (/(^|[\\/])\.\.([\\/]|$)/.test(segment)) {
      throw new Error(`joinVaultPath: traversal segment "${segment}" — ".." is never a vault path part.`);
    }
  }
  return segments
    .filter((segment) => segment !== "")
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "") as VaultPath;
};
```

`node-absolute-file-system.ts`:

```ts
async getVaultBasePath(): Promise<Result<string>> {
  const adapter = this.app.vault.adapter;
  // Normalize the trailing separator ONCE at the source (review §4) so every
  // consumer can join `${base}/${vaultRelative}` without double separators.
  if (adapter instanceof FileSystemAdapter) {
    return ok(adapter.getBasePath().replace(/[\\/]+$/, ""));
  }
  return err(appError("INIT_FAILED", "Vault base path is only available on desktop."));
}
```

- [x] **Step 4: Audit the callers**

Run: `grep -rn "joinVaultPath(" src/ | grep -v vault-path.ts`
For each caller confirm no argument can be a `relativeVaultPath()` result, a raw user string, or an absolute path (they should all be branded `VaultPath`s or literals). Expected from the repo survey: callers in `use-case-service`, `specification-service`, `suite-service`, `demo-content-service`, `documentation-generation-service`, `step-definition-service`, `evidence-generation-service`, `report-import-service`, `test-execution-service`, `runner-template-writer`, views/modals — all settings-derived branded paths + literals. If any caller violates this, fix the caller (screen through `vaultPath()`), not the guard.

- [x] **Step 5: Run the full suite to prove no caller trips the guard**

Run: `npm run lint && npm run typecheck && npm test && npx fallow audit --base origin/main`
Expected: all green (the whole suite exercises every joinVaultPath call path); audit `pass`.

- [x] **Step 6: CHANGELOG + commit**

Under `### Fixed` add:

```markdown
- Path plumbing hardening: the vault base path is normalized (no trailing
  separator) at its single source, and `joinVaultPath` rejects absolute and
  `..` segments outright — closing the gaps before the V2 migration and MCP
  server mint new paths.
```

```bash
git add src/shared/utils/vault-path.ts src/infrastructure/filesystem/node-absolute-file-system.ts tests/vault-path.test.ts tests/node-absolute-file-system.test.ts CHANGELOG.md
git commit -m "fix: harden joinVaultPath and vault base path normalization (pre-V2 1.5)"
```

---

### Task 7: Extract `LiveRefresh` from the six live views (item 1.6)

**Files:**
- Create: `src/presentation/views/live-refresh.ts`
- Create: `tests/live-refresh.test.ts`
- Modify: `src/presentation/views/use-case-dashboard-view.ts`, `use-case-detail-view.ts`, `guided-tour-view.ts`, `evidence-explorer-view.ts`, `dashboard-view.ts`, `suite-dashboard-view.ts`

All six views repeat the identical `subscriptions[] + RenderScheduler + onOpen subscribe-loop + onClose unsubscribe-before-dispose` boilerplate (PRES-M1/M2). V2 adds three more views (triage, readiness, step library) — extract once, copy never again.

- [x] **Step 1: Write the failing tests**

Create `tests/live-refresh.test.ts` (use the same event-construction helpers the existing view/service tests use — `recordingEventBus()` / `createEvent` from `tests/fakes.ts` and `src/domain/events/`; match an event type + payload that actually exists, e.g. `dashboard.refreshed` or `evidence.generated`, to whatever payload shape `createEvent` requires):

```ts
import { describe, expect, it } from "vitest";
import { LiveRefresh } from "../src/presentation/views/live-refresh";
// + the repo's InMemoryEventBus / createEvent imports, matching existing tests

describe("LiveRefresh", () => {
  it("renders once on open and re-renders (coalesced) on a subscribed event", async () => {
    const bus = new InMemoryEventBus();
    let renders = 0;
    const live = new LiveRefresh(bus, () => {
      renders += 1;
    });
    await live.open(["evidence.generated"]);
    expect(renders).toBe(1);
    await bus.publish(createEvent("evidence.generated", /* minimal valid payload */));
    await live.schedule(); // settle the scheduler chain
    expect(renders).toBeGreaterThanOrEqual(2);
    live.close();
  });

  it("ignores events after close, and close is safe to call during a pending render", async () => {
    const bus = new InMemoryEventBus();
    let renders = 0;
    const live = new LiveRefresh(bus, () => {
      renders += 1;
    });
    await live.open(["evidence.generated"]);
    const before = renders;
    live.close();
    await bus.publish(createEvent("evidence.generated", /* payload */));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(renders).toBe(before);
  });

  it("does not render before open is called", () => {
    let renders = 0;
    new LiveRefresh(new InMemoryEventBus(), () => {
      renders += 1;
    });
    expect(renders).toBe(0);
  });
});
```

- [x] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/live-refresh.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement `LiveRefresh`**

Create `src/presentation/views/live-refresh.ts` (check the exact `RenderScheduler` constructor signature in `render-scheduler.ts` and the `DomainEventType` import path before writing):

```ts
import type { DomainEventType } from "../../domain/events/domain-event";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";
import { RenderScheduler } from "./render-scheduler";

/**
 * The shared live-view lifecycle every event-driven view repeats: subscribe
 * the view's render to a set of event types through a RenderScheduler
 * (coalesced renders, PRES-M2) and tear down in the safe order — unsubscribe
 * BEFORE disposing the scheduler so a handler firing mid-teardown can't
 * schedule() on a disposed scheduler (PRES-M1). Extracted from the six V1
 * views (review §4) so V2's new views (triage, readiness, step library)
 * start from one implementation.
 */
export class LiveRefresh {
  private readonly subscriptions: Unsubscribe[] = [];
  private readonly scheduler: RenderScheduler;

  constructor(
    private readonly eventBus: EventBus,
    render: () => void | Promise<void>,
  ) {
    this.scheduler = new RenderScheduler(async () => {
      await render();
    });
  }

  /** Subscribes to `types` and schedules the initial render. */
  open(types: readonly DomainEventType[]): Promise<void> {
    for (const type of types) {
      this.subscriptions.push(this.eventBus.subscribe(type, () => this.scheduler.schedule()));
    }
    return this.scheduler.schedule();
  }

  /** Coalesced manual refresh — the same path the event subscriptions use. */
  schedule(): Promise<void> {
    return this.scheduler.schedule();
  }

  close(): void {
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
    this.scheduler.dispose();
  }
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/live-refresh.test.ts`
Expected: PASS.

- [x] **Step 5: Migrate the six views**

For each of the six views, the same mechanical change (shown here for `use-case-dashboard-view.ts`; repeat identically in the other five, keeping each view's own event list and any extra `onOpen` work):

Delete the two fields:

```ts
private readonly subscriptions: Unsubscribe[] = [];
private readonly scheduler = new RenderScheduler(() => this.render());
```

Add the field declaration and assign in the constructor (after deps are assigned — do not use a field initializer, the deps parameter property must exist first):

```ts
private readonly live: LiveRefresh;
// in the constructor body:
this.live = new LiveRefresh(deps.eventBus, () => this.render());
```

Replace `onOpen` / `onClose`:

```ts
async onOpen(): Promise<void> {
  await this.live.open(REFRESH_ON);
}

async onClose(): Promise<void> {
  this.live.close();
}
```

Per-view notes:
- **`dashboard-view.ts`**: keeps its pre-render call (`refreshDashboard()` at ~line 163) in `onOpen` *before* `await this.live.open(...)`, and passes its full event list (the `REFRESH_ON`-style constant *plus* `settings.updated` and `tour.completed` — fold them into one array).
- **`guided-tour-view.ts`**: its scheduler callback was `async () => { this.render(); }` — `new LiveRefresh(deps.eventBus, () => this.render())` is equivalent; keep its inline event-list comment ("tour.* drives progress repaints; evidence.generated flips…") next to the array.
- **`evidence-explorer-view.ts`**: single-event list `["evidence.generated"]`.
- Any other call sites of `this.scheduler.schedule()` inside a view (manual refresh buttons etc. — grep each file for `scheduler.`) become `this.live.schedule()`.
- Remove now-unused `RenderScheduler` / `Unsubscribe` imports from each view; keep the `REFRESH_ON` constants where they are.

Verify the sweep: `grep -rn "new RenderScheduler" src/presentation/views/` must list only `live-refresh.ts` and `initialization-wizard-modal.ts` (deliberately untouched — modal lifecycle, no event subscriptions of this shape).

- [x] **Step 6: Verify, CHANGELOG, commit**

Run: `npm run lint && npm run typecheck && npm test && npx fallow audit --base origin/main`
Expected: all green (views are coverage-excluded; `live-refresh.ts` is NOT `*-view.ts` so it counts toward coverage — its test from Step 1 covers it); audit `pass` (the duplication detector should also stop seeing six clones of the boilerplate).

Under `### Changed` add:

```markdown
- The six event-driven views now share one `LiveRefresh` helper for the
  subscribe/coalesce/teardown lifecycle instead of six hand-copied
  implementations; V2's new views build on the same helper.
```

```bash
git add src/presentation/views/live-refresh.ts tests/live-refresh.test.ts src/presentation/views/use-case-dashboard-view.ts src/presentation/views/use-case-detail-view.ts src/presentation/views/guided-tour-view.ts src/presentation/views/evidence-explorer-view.ts src/presentation/views/dashboard-view.ts src/presentation/views/suite-dashboard-view.ts CHANGELOG.md
git commit -m "refactor: extract LiveRefresh from the six live views (pre-V2 1.6)"
```

---

### Task 8: `register-commands` smoke test + Vault-API-first `exists` (item 1.7)

**Files:**
- Create: `tests/register-commands.test.ts`
- Modify: `src/infrastructure/obsidian/obsidian-vault-adapter.ts` (the `exists`-shaped call sites at ~lines 17, 29, 72, 84, 129)

Two halves: (a) a smoke test so V2's new commands can't silently break registration; (b) reduce `vault.adapter` reliance to exactly the unindexed-path cases, each with a justifying comment (community-review bots flag bare adapter usage; the indefinitely-deferred marketplace option stays open at zero cost).

- [x] **Step 1: Write the smoke test**

Create `tests/register-commands.test.ts`. Build a fake `Plugin` that records `addCommand` calls and a `TestHubCommandDeps` stub where every service method is a `vi.fn()` returning the matching ok-shape (`ok(...)` / arrays / typed outcomes — mirror the deps interface at `src/presentation/commands/register-commands.ts:~50-75` and the outcome types its callbacks switch on):

```ts
import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "obsidian";
import { registerCommands } from "../src/presentation/commands/register-commands";

interface RecordedCommand {
  id: string;
  name: string;
  callback?: () => unknown;
}

const buildPlugin = () => {
  const commands: RecordedCommand[] = [];
  const plugin = {
    addCommand: (command: RecordedCommand) => {
      commands.push(command);
      return command;
    },
  } as unknown as Plugin;
  return { plugin, commands };
};

// Stub every TestHubCommandDeps member with a vi.fn() returning the ok-shape
// the callback expects (read the deps interface; e.g. validationService
// .validateEnvironment -> { valid: true, issues: [] }, suiteService.findAll
// -> ok([]), getSettings -> DEFAULT_SETTINGS, openWizard -> vi.fn(), ...).
const buildDeps = () => ({ /* full stub here, one line per member */ });

describe("registerCommands (smoke)", () => {
  it("registers the full command surface with unique, well-formed ids", () => {
    const { plugin, commands } = buildPlugin();
    registerCommands(plugin, buildDeps() as never);
    expect(commands.length).toBeGreaterThanOrEqual(40);
    const ids = commands.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of commands) {
      expect(command.id).toMatch(/^[a-z0-9-]+$/);
      expect(command.name.trim().length).toBeGreaterThan(0);
    }
  });

  it("every command callback is invocable against stubbed services without throwing", async () => {
    const { plugin, commands } = buildPlugin();
    registerCommands(plugin, buildDeps() as never);
    for (const command of commands) {
      if (command.callback) await expect(Promise.resolve(command.callback())).resolves.not.toThrow();
    }
  });
});
```

Notes for the implementer: the `Notice` constructor comes from `tests/__stubs__/obsidian.ts` (already a no-op); commands using `checkCallback`/modals — follow what the recorded command object actually carries and stub modal `open()` if a callback constructs one (the obsidian stub's `Modal` is already inert). Pin the *count* with `toBeGreaterThanOrEqual` (46 today), not equality — the test should catch *loss* of registration, not block additions.

- [x] **Step 2: Run it**

Run: `npx vitest run tests/register-commands.test.ts`
Expected: PASS once the deps stub is complete (iterate on the stub until green — every red is a real coupling the smoke test now documents). `register-commands.ts` stays in the vitest coverage `exclude` list — do not remove it (the smoke test runs regardless; including the file would distort the coverage thresholds with unexecuted command bodies).

- [x] **Step 3: Vault-API-first existence checks in `ObsidianVaultAdapter`**

In `obsidian-vault-adapter.ts`, for each `await this.app.vault.adapter.exists(...)` call site (~lines 17, 29, 72, 84, 129): try the index first, keep the adapter as the unindexed fallback. Pattern (shown for the `exists()` port method at line 17):

```ts
async exists(path: VaultPath): Promise<boolean> {
  const normalized = normalizePath(path);
  // Vault-API first (community guideline): indexed files/folders resolve via
  // the index; the adapter remains the deliberate fallback for paths Obsidian
  // does not index (`.testrunner/`, fresh evidence partitions).
  if (this.app.vault.getAbstractFileByPath(normalized) !== null) return true;
  return this.app.vault.adapter.exists(normalized);
}
```

Apply the same two-line pattern inline at the other four sites (ancestor check in recursive create, read fallback, list guard, idempotent-delete guard), adjusting to each site's local variable names. The remaining bare adapter calls (`read` at 73, `list` at 89/112, `rmdir` at 142) each get a one-line justification comment of the form `// adapter API: <path kind> is not in Obsidian's index`. Do not migrate them — they are the intended API for unindexed files (Decision 8).

- [x] **Step 4: Verify, CHANGELOG, commit**

Run: `npm run lint && npm run typecheck && npm test && npx fallow audit --base origin/main`
Expected: all green (`src/infrastructure/obsidian/**` is coverage-excluded; the change is exercised by the e2e smoke workflow at PR time); audit `pass`.

Under `### Changed` add:

```markdown
- Command registration is covered by a smoke test (unique ids, full surface,
  callbacks invocable), and the vault adapter's existence checks now resolve
  through the Vault API first, keeping adapter access to the documented
  unindexed-path cases only.
```

```bash
git add tests/register-commands.test.ts src/infrastructure/obsidian/obsidian-vault-adapter.ts CHANGELOG.md
git commit -m "test: register-commands smoke test; Vault-API-first exists (pre-V2 1.7)"
```

---

### Task 9: TD-001 — official `\|` escapes in Gherkin table cells (item 1.8)

**Files:**
- Modify: `src/application/content/gherkin.ts` (`parseTableRow` ~82-87, `serialiseCell` ~293-300, `significantLines` ~373-405)
- Modify: `src/presentation/views/feature-editor-format.ts:153` (`sanitizeCell`)
- Modify: `tests/gherkin.test.ts`, `tests/feature-editor-format.test.ts`
- Modify: `docs/tech-debt/TD-001.md`, `docs/tech-debt/README.md`

One escape rule at the parse/serialize boundary replaces three lossy layers. The playwright-bdd migration hands these files to the official Gherkin parser: files using the standard `\|` escape must round-trip, and the editor must stop silently rewriting user pipes to `/`.

- [x] **Step 1: Update the pinned tests + add the escape tests (failing first)**

In `tests/gherkin.test.ts`:

Replace the guard pin (lines ~316-319):

```ts
it("round-trips escaped-pipe table cells (official Gherkin escape, TD-001)", () => {
  const escaped = RICH.replace("| a    | 1     |", String.raw`| a\|b | 1     |`);
  expect(roundTripsLosslessly(escaped, path)).toBe(true);
});
```

Replace the substitution pin (lines ~345-356):

```ts
it("escapes literal pipes in model cells (table shape is the invariant)", () => {
  const spec = parseFeature(RICH, path);
  expect(spec).not.toBeNull();
  if (!spec) return;
  spec.scenarios[1].examples?.[0].rows.push(["a|b", "2", "3"]);
  const text = serialiseFeature(spec);
  expect(text).toContain(String.raw`| a\|b | 2 | 3 |`);
  const reparsed = parseFeature(text, path);
  expect(reparsed?.scenarios[1].examples?.[0].rows).toHaveLength(3);
  expect(reparsed?.scenarios[1].examples?.[0].rows[2]).toEqual(["a|b", "2", "3"]);
});
```

Add the boundary tests:

```ts
describe("table cell escapes (TD-001, official Gherkin: \\|, \\\\, \\n)", () => {
  const path = vp("Specifications/features/UC-001-escapes.feature");
  const featureWith = (row: string) =>
    `Feature: F\n\n  Scenario: S\n    Given a table\n      | col |\n      ${row}\n`;

  it("parses the three official escapes into literal cell values", () => {
    const spec = parseFeature(featureWith(String.raw`| a\|b\\c\nd |`), path);
    expect(spec?.scenarios[0].steps[0].dataTable).toEqual([["col"], ["a|b\\c\nd"]]);
  });

  it("re-escapes on serialization so escaped cells round-trip losslessly", () => {
    const text = featureWith(String.raw`| a\|b |`);
    expect(roundTripsLosslessly(text, path)).toBe(true);
  });

  it("leaves an unknown backslash sequence verbatim (lenient parse)", () => {
    const spec = parseFeature(featureWith(String.raw`| a\b |`), path);
    expect(spec?.scenarios[0].steps[0].dataTable).toEqual([["col"], [String.raw`a\b`]]);
  });
});
```

(If Task 10 has not run yet, `steps[0].dataTable` is still the live shape — these tests are written pre-TD-002 and Task 10 updates them to `stepTable(...)`.)

In `tests/feature-editor-format.test.ts` replace the `sanitizeCell` pin:

```ts
it("sanitizeCell trims only — pipes are handled by the serializer's escape (TD-001)", () => {
  expect(sanitizeCell(" a | b ")).toBe("a | b");
});
```

Run: `npx vitest run tests/gherkin.test.ts tests/feature-editor-format.test.ts`
Expected: the new/updated tests FAIL against the current substitution behaviour.

- [x] **Step 2: Implement the escape at the boundary**

In `gherkin.ts`, replace `parseTableRow`:

```ts
/**
 * Splits a `| a | b |` row into trimmed cells, honouring the official
 * Gherkin cell escapes: `\|` → `|`, `\\` → `\`, `\n` → newline (TD-001).
 * Any other backslash sequence is kept verbatim (lenient parse).
 */
const parseTableRow = (line: string): string[] => {
  const segments: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === "\\") {
      const next = line[i + 1];
      if (next === "|" || next === "\\") {
        current += next;
        i++;
      } else if (next === "n") {
        current += "\n";
        i++;
      } else {
        current += char;
      }
    } else if (char === "|") {
      segments.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  segments.push(current);
  // Drop the empty boundary segments produced by the leading `|` and (when
  // present) the trailing `|`; inner empty cells survive.
  if (segments.length > 0 && segments[0].trim() === "") segments.shift();
  if (segments.length > 0 && segments[segments.length - 1].trim() === "") segments.pop();
  return segments.map((cell) => cell.trim());
};
```

> Boundary-pin check: the current code strips exactly one leading and one trailing `|` then splits. Before committing, confirm against the existing table tests that genuinely empty edge cells (`| | a |`) still parse the same way — the existing corpus pins this.

Replace `serialiseCell`:

```ts
/**
 * Escapes a cell for a `|`-delimited row using the official Gherkin escapes
 * (TD-001): `\` → `\\`, `|` → `\|`, newline → `\n`. Replaces the V1 lossy
 * `/`-substitution — a literal pipe now round-trips instead of being
 * rewritten.
 */
export const serialiseCell = (cell: string): string =>
  cell.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "\\n");
```

In `significantLines`, replace the backslash special case:

```ts
    if (trimmed.startsWith("|")) {
      result.push(trimmed.includes("\\") ? trimmed : `| ${parseTableRow(trimmed).join(" | ")} |`);
      continue;
    }
```

with (and update the function's doc comment: delete the "table row containing a backslash is compared verbatim" sentence — the escape is now modelled):

```ts
    if (trimmed.startsWith("|")) {
      result.push(`| ${parseTableRow(trimmed).map(serialiseCell).join(" | ")} |`);
      continue;
    }
```

In `feature-editor-format.ts`, replace `sanitizeCell` and its doc comment:

```ts
/** Tidies editor cell input; pipes/backslashes are escaped by the serializer (TD-001). */
export const sanitizeCell = (value: string): string => value.trim();
```

- [x] **Step 3: Run the suites to verify everything passes**

Run: `npx vitest run tests/gherkin.test.ts tests/feature-editor-format.test.ts` then the full `npm test`.
Expected: PASS — including every pre-existing round-trip corpus test (they pin that unescaped tables still canonicalize identically).

- [x] **Step 4: Close TD-001, CHANGELOG, commit**

`docs/tech-debt/TD-001.md`: `status: resolved` + append:

```markdown
## Resolution (2026-06-12)

Resolved in the pre-V2 Phase 1 increment (plan:
`docs/superpowers/plans/2026-06-12-pre-v2-phase-1-clear-recorded-debt.md`):
the official escapes (`\|`, `\\`, `\n`) are implemented once at the
parse/serialize boundary (`parseTableRow`/`serialiseCell`); the `/`
substitution and the round-trip guard's backslash special case are gone;
`sanitizeCell` is a plain trim. Correctly escaped files now round-trip into
structured editing instead of being locked into raw mode.
```

Move the TD-001 row to **Resolved items** in `docs/tech-debt/README.md`.

Under `### Fixed` in the CHANGELOG add:

```markdown
- Gherkin table cells support the official escapes (`\|`, `\\`, `\n`): a
  literal pipe in table data round-trips through the structured editor
  instead of being silently rewritten to `/`, and files already using the
  standard escape are no longer locked out of structured mode (TD-001).
```

Run the full gate (`npm run lint && npm run typecheck && npm test && npx fallow audit --base origin/main`), then:

```bash
git add src/application/content/gherkin.ts src/presentation/views/feature-editor-format.ts tests/gherkin.test.ts tests/feature-editor-format.test.ts docs/tech-debt/TD-001.md docs/tech-debt/README.md CHANGELOG.md
git commit -m "fix: official escaped-pipe support in Gherkin table cells (TD-001, pre-V2 1.8)"
```

---

### Task 10: TD-002 — one-argument-per-step as a sum type on `GherkinStep` (item 1.9)

**Files:**
- Modify: `src/domain/entities/specification.ts:25-32`
- Modify: `src/application/content/gherkin.ts` (parser attach sites ~152, ~234; `pushStep` ~308-321)
- Modify: `src/presentation/views/feature-editor-format.ts` (delete `flagDoubleArguments` ~28-41; `projectValidation`)
- Modify: `src/presentation/views/feature-editor-view.ts` (`renderStepExtras` ~520-595 and the table/doc-string handlers)
- Modify: `tests/gherkin.test.ts`, `tests/feature-editor-format.test.ts`, `tests/specification-service.test.ts` (+ any other fixture found by the grep in Step 3)
- Modify: `docs/tech-debt/TD-002.md`, `docs/tech-debt/README.md`

Make the invalid state (table **and** doc string on one step) unrepresentable before the runner migration makes the resulting invalid Gherkin a suite failure.

- [x] **Step 1: Reshape the domain type**

In `specification.ts`, replace the `GherkinStep` interface:

```ts
/**
 * A step's single argument (TD-002): Gherkin allows at most ONE — a data
 * table or a doc string. The sum type makes the table+docString combination
 * unrepresentable; `serialiseFeature` can no longer emit Gherkin Cucumber
 * refuses to parse.
 */
export type StepArgument =
  | { kind: "table"; rows: string[][] }
  | { kind: "docString"; docString: DocString };

export interface GherkinStep {
  keyword: "Given" | "When" | "Then" | "And" | "But" | "*";
  text: string;
  /** The step's at-most-one argument (TD-002). */
  argument?: StepArgument;
}

/** Convenience accessors so consumers don't re-spell the discriminant. */
export const stepTable = (step: GherkinStep): string[][] | undefined =>
  step.argument?.kind === "table" ? step.argument.rows : undefined;

export const stepDocString = (step: GherkinStep): DocString | undefined =>
  step.argument?.kind === "docString" ? step.argument.docString : undefined;
```

- [x] **Step 2: Update the parser and serializer**

In `gherkin.ts` — table-row attach (~line 234), replace `(lastStep.dataTable ??= []).push(cells);` with:

```ts
if (lastStep.argument === undefined) {
  lastStep.argument = { kind: "table", rows: [cells] };
} else if (lastStep.argument.kind === "table") {
  lastStep.argument.rows.push(cells);
}
// else: the step already carries a doc string — Gherkin allows ONE argument
// (TD-002). Drop the row; the round-trip guard then fails the file into raw
// mode, which is correct (Cucumber rejects the file too).
```

Doc-string attach (~line 152), replace `if (lastStep) lastStep.docString = openDocString;` with:

```ts
// First argument wins (TD-002): a doc string after a table is dropped and
// the round-trip guard sends the file to raw mode.
if (lastStep && lastStep.argument === undefined) {
  lastStep.argument = { kind: "docString", docString: openDocString };
}
```

`pushStep` (~lines 308-321):

```ts
/** Appends one step line plus its single table / doc-string argument. */
const pushStep = (lines: string[], step: GherkinStep, indent: string): void => {
  lines.push(`${indent}${step.keyword} ${step.text}`.trimEnd());
  const inner = `${indent}  `;
  const argument = step.argument;
  if (argument?.kind === "table" && argument.rows.length > 0) {
    pushTable(lines, argument.rows, inner);
  }
  if (argument?.kind === "docString") {
    const { fence, mediaType, lines: body } = argument.docString;
    lines.push(`${inner}${fence}${mediaType ?? ""}`);
    for (const bodyLine of body) {
      lines.push(bodyLine.length > 0 ? `${inner}${bodyLine}` : "");
    }
    lines.push(`${inner}${fence}`);
  }
};
```

- [x] **Step 3: Sweep every other consumer**

Run: `grep -rn "dataTable\|docString" src/ tests/ --include="*.ts" -l`
Update each hit (expected surface, from the repo survey):

- `feature-editor-view.ts`: `renderStepExtras` reads `stepTable(step)` / `stepDocString(step)`; the add-table handler sets `step.argument = { kind: "table", rows: [["value"]] };`; the add-doc handler sets `step.argument = { kind: "docString", docString: { fence: '"""', lines: [""] } };`; removals become `delete step.argument;`; table/doc-string mutation handlers operate on `step.argument.rows` / `step.argument.docString` after narrowing the discriminant. The "at most ONE argument" gating comment now points at the type: the add buttons render only when `step.argument === undefined` (one condition instead of two).
- `feature-editor-format.ts`: delete `flagDoubleArguments` and its two call sites in `projectValidation`; any table helpers typed against `string[][]` keep working on `argument.rows`.
- Tests: rewrite fixtures `dataTable: [...]` → `argument: { kind: "table", rows: [...] }`, `docString: {...}` → `argument: { kind: "docString", docString: {...} }`; expectations through `stepTable(...)`/`stepDocString(...)`. Delete the `flagDoubleArguments`-based test ("flags a step carrying both…") — replace it with the guard-level pin:

```ts
it("a file with both a table and a doc string on one step fails the round-trip guard (TD-002)", () => {
  const text = `Feature: F\n\n  Scenario: S\n    Given x\n      | a |\n      """\n      body\n      """\n`;
  const path = vp("Specifications/features/UC-001-both-args.feature");
  const spec = parseFeature(text, path);
  expect(stepDocString(spec!.scenarios[0].steps[0])).toBeUndefined(); // first argument won
  expect(roundTripsLosslessly(text, path)).toBe(false); // raw mode, like Cucumber would reject it
});
```

Also update the Task 9 escape tests from `steps[0].dataTable` to `stepTable(spec!.scenarios[0].steps[0])`.

- [x] **Step 4: Verify**

Run: `npm run lint && npm run typecheck && npm test && npx fallow audit --base origin/main`
Expected: all green. Typecheck is the real proof here — zero remaining references to `.dataTable`/`.docString` on steps outside the domain module (`grep -rn "\.dataTable\b\|\.docString\b" src/` returns only `specification.ts` internals, i.e. the `StepArgument` definition and accessors).

- [x] **Step 5: Close TD-002, CHANGELOG, commit**

`docs/tech-debt/TD-002.md`: `status: resolved` + append:

```markdown
## Resolution (2026-06-12)

Resolved in the pre-V2 Phase 1 increment (plan:
`docs/superpowers/plans/2026-06-12-pre-v2-phase-1-clear-recorded-debt.md`)
via option 1 (sum type): `GherkinStep.argument` is
`{ kind: "table" } | { kind: "docString" }`, so a step with both arguments is
unrepresentable; the parser keeps the FIRST argument (a conflicting later one
is dropped and the round-trip guard sends the file to raw mode, mirroring
Cucumber's rejection); `flagDoubleArguments` and its validation message are
deleted along with the editor's two-condition button gating.
```

Move the TD-002 row to **Resolved items** in `docs/tech-debt/README.md`.

Under `### Changed` add:

```markdown
- A Gherkin step's argument is modelled as a sum type (data table OR text
  block, TD-002): the serializer can no longer emit a step with both, which
  Cucumber — and the V2 playwright-bdd runner — refuse to parse.
```

```bash
git add src/domain/entities/specification.ts src/application/content/gherkin.ts src/presentation/views/feature-editor-format.ts src/presentation/views/feature-editor-view.ts tests/ docs/tech-debt/TD-002.md docs/tech-debt/README.md CHANGELOG.md
git commit -m "refactor: one-argument-per-step sum type on GherkinStep (TD-002, pre-V2 1.9)"
```

---

### Task 11: TD-003 — single source of structural Feature validation (item 1.10)

**Files:**
- Create: `src/application/content/feature-validation.ts`
- Create: `tests/feature-validation.test.ts`
- Modify: `src/application/services/specification-service.ts:205-247` (`validate`)
- Modify: `src/presentation/views/feature-editor-format.ts` (`projectValidation`, `ValidationItem`)
- Modify: `tests/specification-service.test.ts`, `tests/feature-editor-format.test.ts`
- Modify: `docs/tech-debt/TD-003.md`, `docs/tech-debt/README.md`

The service and the editor already drifted on empty-name semantics. V2's scenario quality lint (US-074) layers new rules on this — build it on one implementation.

- [x] **Step 1: Write the failing tests for the shared module**

Create `tests/feature-validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { structuralIssues } from "../src/application/content/feature-validation";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { parseFeature } from "../src/application/content/gherkin";

describe("structuralIssues (TD-003 single source)", () => {
  it("returns no issues for a well-formed, UC-prefixed feature", () => {
    const spec = parseFeature(
      "Feature: Ok\n  Scenario: S\n    Given a step\n",
      vp("Specifications/features/UC-001-ok.feature"),
    );
    expect(spec).not.toBeNull();
    if (spec) expect(structuralIssues(spec)).toEqual([]);
  });

  it("flags an orphan filename as an ERROR (ADR-0012 — both surfaces agree now)", () => {
    const spec = parseFeature(
      "Feature: F\n  Scenario: S\n    Given x\n",
      vp("Specifications/features/orphan.feature"),
    );
    if (!spec) return;
    expect(structuralIssues(spec)).toEqual([
      { level: "error", message: 'No "UC-NNN-" filename prefix — this Feature is an orphan (ADR-0012).' },
    ]);
  });

  it("uses trim() empty-name semantics (whitespace-only counts as nameless)", () => {
    const spec = parseFeature(
      "Feature:  \n  Scenario: S\n    Given x\n",
      vp("Specifications/features/UC-001-blank.feature"),
    );
    if (!spec) return;
    expect(structuralIssues(spec).map((item) => item.message)).toContain("Feature has no name.");
  });

  it("flags a scenarioless feature and stepless scenarios", () => {
    const spec = parseFeature(
      "Feature: F\n  Scenario: Empty\n",
      vp("Specifications/features/UC-001-empty.feature"),
    );
    if (!spec) return;
    expect(structuralIssues(spec).map((item) => item.message)).toEqual([
      'Scenario "Empty" has no steps.',
    ]);
  });
});
```

Run: `npx vitest run tests/feature-validation.test.ts` → FAIL (module not found).

- [x] **Step 2: Implement the shared module**

Create `src/application/content/feature-validation.ts`:

```ts
import type { FeatureSpecification } from "../../domain/entities/specification";
import { useCaseIdFromPath } from "./gherkin";

/** One line of a structural validation verdict (service + editor strip). */
export interface ValidationItem {
  level: "error" | "warning";
  message: string;
}

/**
 * THE structural Feature rules (TD-003) — consumed by
 * `SpecificationService.validate` (the Validate action) and the Feature
 * Editor's live strip, which layers typing-time hints on top. Semantics
 * locked here: empty name uses trim() (whitespace-only is nameless), and an
 * orphan filename is an ERROR on both surfaces (ADR-0012).
 */
export const structuralIssues = (specification: FeatureSpecification): ValidationItem[] => {
  const items: ValidationItem[] = [];
  if (useCaseIdFromPath(specification.path) === null) {
    items.push({
      level: "error",
      message: 'No "UC-NNN-" filename prefix — this Feature is an orphan (ADR-0012).',
    });
  }
  if (specification.featureName.trim() === "") {
    items.push({ level: "error", message: "Feature has no name." });
  }
  if (specification.scenarios.length === 0) {
    items.push({ level: "error", message: "Feature has no scenarios." });
  }
  for (const scenario of specification.scenarios) {
    const label = scenario.name.trim() === "" ? "(unnamed)" : scenario.name;
    if (scenario.steps.length === 0) {
      items.push({ level: "error", message: `Scenario "${label}" has no steps.` });
    }
  }
  return items;
};
```

Run: `npx vitest run tests/feature-validation.test.ts` → PASS.

- [x] **Step 3: Consume it from the service**

In `specification-service.ts` `validate()`, replace the inline rule block (the orphan check + the `feature === null` / name / scenarios / steps checks) with:

```ts
const feature = parseFeature(read.value, featurePath);
if (feature === null) {
  // structuralIssues needs a parsed spec; cover the two pre-parse facts here.
  if (useCaseIdFromPath(featurePath) === null) {
    errors.push({
      message: 'No "UC-NNN-" filename prefix — this Feature is an orphan (ADR-0012).',
    });
  }
  errors.push({ message: "File does not contain a Feature: declaration." });
} else {
  errors.push(...structuralIssues(feature).map(({ message }) => ({ message })));
}
```

(Keep everything after the rule block — result assembly, events — unchanged. Remove the now-redundant standalone orphan check that ran before parsing.)

- [x] **Step 4: Consume it from the editor**

In `feature-editor-format.ts`: delete the local `ValidationItem` interface and re-export the shared one (`export type { ValidationItem } from "../../application/content/feature-validation";` — keep the editor's `"ok"`-level display row local to `refreshValidation`/`render`, typed as its own literal, since "ok" is presentation, not validation). Replace `projectValidation` with:

```ts
/**
 * Live validation for the editor strip: the shared structural rules
 * (TD-003) plus editor-only typing-time hints (unnamed scenario, rowless
 * Outline) for content that is still being typed.
 */
export const projectValidation = (specification: FeatureSpecification): ValidationItem[] => {
  const items = structuralIssues(specification);
  for (const scenario of specification.scenarios) {
    const label = scenario.name.trim() === "" ? "(unnamed)" : scenario.name;
    if (scenario.name.trim() === "") {
      items.push({ level: "warning", message: "A scenario has no name." });
    }
    if (scenario.keyword === "Scenario Outline") {
      const hasRows = (scenario.examples ?? []).some((block) => block.rows.length > 0);
      if (!hasRows) {
        items.push({
          level: "warning",
          message: `Scenario Outline "${label}" has no Examples rows.`,
        });
      }
    }
  }
  return items;
};
```

(Task 12 swaps the `keyword === "Scenario Outline"` condition for `isScenarioOutline` — leave it literal here.)

- [x] **Step 5: Update the consuming tests**

- `tests/feature-editor-format.test.ts`: the orphan test now expects `level: "error"` (was warning), and the combined nameless/stepless/rowless test's expected array re-orders to structural-first:

```ts
expect(messages).toEqual([
  "error:Feature has no name.",
  'error:Scenario "O" has no steps.',
  'warning:Scenario Outline "O" has no Examples rows.',
]);
```

(Verify the actual emitted order — structural issues first, hints second — and pin that.)
- `tests/specification-service.test.ts`: add a whitespace-name case to the validate suite:

```ts
it("flags a whitespace-only feature name (trim semantics, TD-003)", async () => {
  const { service, fs } = build();
  const path = vp("Specifications/features/UC-001-blank-name.feature");
  fs.files.set(path, "Feature:  \n  Scenario: S\n    Given a step\n");
  const result = await service.validate(path);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.valid).toBe(false);
  expect(result.value.errors.map((e) => e.message)).toContain("Feature has no name.");
});
```

- [x] **Step 6: Verify, close TD-003, CHANGELOG, commit**

Run: `npm run lint && npm run typecheck && npm test && npx fallow audit --base origin/main`
Expected: all green (the fallow duplication detector also stops seeing the twin rule blocks); audit `pass`.

`docs/tech-debt/TD-003.md`: `status: resolved` + append:

```markdown
## Resolution (2026-06-12)

Resolved in the pre-V2 Phase 1 increment (plan:
`docs/superpowers/plans/2026-06-12-pre-v2-phase-1-clear-recorded-debt.md`):
`structuralIssues()` in `src/application/content/feature-validation.ts` is
the single source, consumed by `SpecificationService.validate` and the
editor's `projectValidation` (which layers typing-time hints on top).
Decided semantics: trim() empty-name (whitespace-only is nameless; service
tests updated) and orphan-filename is an error on both surfaces (ADR-0012).
```

Move the TD-003 row to **Resolved items** in `docs/tech-debt/README.md`.

Under `### Changed` add:

```markdown
- Structural Feature validation has one implementation shared by the
  Validate action and the editor's live strip (TD-003); whitespace-only
  feature names are now flagged on both surfaces, and an orphan filename is
  consistently an error (ADR-0012).
```

```bash
git add src/application/content/feature-validation.ts tests/feature-validation.test.ts src/application/services/specification-service.ts src/presentation/views/feature-editor-format.ts tests/specification-service.test.ts tests/feature-editor-format.test.ts docs/tech-debt/TD-003.md docs/tech-debt/README.md CHANGELOG.md
git commit -m "refactor: single-source structural Feature validation (TD-003, pre-V2 1.10)"
```

---

### Task 12: TD-005 — one `isScenarioOutline` predicate (item 1.11)

**Files:**
- Modify: `src/domain/entities/specification.ts`
- Modify: `src/application/services/feature-insight-service.ts:91`
- Modify: `src/presentation/views/feature-editor-format.ts` (`projectValidation` rowless-Outline condition)
- Modify: `src/presentation/views/feature-editor-view.ts` (`renderScenarioCard` Examples-grid condition, ~line 445)
- Modify: `tests/feature-editor-format.test.ts` (+ a domain pin in `tests/domain-factories.test.ts` or a new small describe)
- Modify: `docs/tech-debt/TD-005.md`, `docs/tech-debt/README.md`

Scenario Reference (US-056) keys Outline examples as `::row-N` — identity and suite-match counts must agree on what an Outline *is* before history lands.

- [x] **Step 1: Write the failing tests**

Add to `tests/feature-editor-format.test.ts`:

```ts
it("warns about a rowless Outline even when only the Examples block implies it (TD-005 lenient predicate)", () => {
  const items = projectValidation({
    path: vp("Specifications/features/UC-001-implied.feature"),
    useCaseId: "UC-001",
    featureName: "F",
    tags: [],
    // No "Scenario Outline" keyword — but parsed Examples are attached.
    scenarios: [{ name: "S", tags: [], steps: [{ keyword: "Given", text: "x" }], examples: [] }],
  });
  expect(items).toEqual([
    { level: "warning", message: 'Scenario Outline "S" has no Examples rows.' },
  ]);
});
```

And the predicate pin (put it next to the other domain-entity tests — `tests/domain-factories.test.ts` or a new `describe` in `tests/gherkin.test.ts`):

```ts
describe("isScenarioOutline (TD-005)", () => {
  const base = { name: "S", tags: [], steps: [] };
  it("is true for the keyword, true for attached Examples, false for a plain scenario", () => {
    expect(isScenarioOutline({ ...base, keyword: "Scenario Outline" })).toBe(true);
    expect(isScenarioOutline({ ...base, examples: [] })).toBe(true);
    expect(isScenarioOutline(base)).toBe(false);
  });
});
```

Run them → FAIL (`isScenarioOutline` doesn't exist; the editor-format test sees no warning).

- [x] **Step 2: Export the predicate and update the three sites**

In `specification.ts`:

```ts
/**
 * THE "is this scenario an Outline" predicate (TD-005). Deliberately
 * LENIENT: the `Scenario Outline` keyword OR attached `Examples:` blocks
 * count. The lenient parser attaches Examples to a plain `Scenario:`
 * (malformed Gherkin Cucumber rejects); treating it as an Outline keeps
 * suite/tag match counts, the editor's Examples grid, and V2 scenario
 * identity (`::row-N`, US-056) in agreement instead of hiding the blocks.
 * Parse-time keyword normalisation was considered and rejected for now: it
 * would change round-trip behaviour for malformed files.
 */
export const isScenarioOutline = (scenario: ScenarioSpecification): boolean =>
  scenario.keyword === "Scenario Outline" || scenario.examples !== undefined;
```

Three call sites:
- `feature-insight-service.ts:91`: `const isOutline = isScenarioOutline(scenario);` (delete the inline expression; semantics identical — this site was already lenient).
- `feature-editor-format.ts` `projectValidation`: `if (isScenarioOutline(scenario)) {` (was keyword-only — behaviour change pinned by Step 1's test).
- `feature-editor-view.ts` `renderScenarioCard`: the Examples-grid condition `if ((scenario.keyword ?? "Scenario") === "Scenario Outline")` becomes `if (isScenarioOutline(scenario))` — a plain scenario with round-tripped Examples now shows its grid. The keyword `<select>` keeps rendering from `scenario.keyword ?? "Scenario"` (it edits the keyword, not the predicate).

- [x] **Step 3: Verify, close TD-005, CHANGELOG, commit**

Run: `npm run lint && npm run typecheck && npm test && npx fallow audit --base origin/main`
Expected: all green; the pre-existing `feature-insight-service` tests pin that tag matching didn't change.

`docs/tech-debt/TD-005.md`: `status: resolved` + append:

```markdown
## Resolution (2026-06-12)

Resolved in the pre-V2 Phase 1 increment (plan:
`docs/superpowers/plans/2026-06-12-pre-v2-phase-1-clear-recorded-debt.md`):
`isScenarioOutline` is exported from the domain entity module with the
LENIENT semantics (keyword or attached Examples) — matching what suite/tag
matching already shipped — and all three sites consume it. The editor now
shows the Examples grid for a plain scenario carrying parsed Examples
instead of hiding round-tripped blocks. Parse-time keyword normalisation
was deliberately rejected (it would flip malformed files' round-trip
behaviour); revisit if US-056 identity needs it.
```

Move the TD-005 row to **Resolved items** in `docs/tech-debt/README.md`.

Under `### Changed` add:

```markdown
- One domain predicate decides "is this scenario an Outline" everywhere
  (TD-005, lenient semantics): suite/tag match counts, the validation strip,
  and the editor's Examples grid can no longer disagree.
```

```bash
git add src/domain/entities/specification.ts src/application/services/feature-insight-service.ts src/presentation/views/feature-editor-format.ts src/presentation/views/feature-editor-view.ts tests/ docs/tech-debt/TD-005.md docs/tech-debt/README.md CHANGELOG.md
git commit -m "refactor: unify the isScenarioOutline predicate (TD-005, pre-V2 1.11)"
```

---

### Task 13: TD-004 — focus-preserving re-render replaces `commit(structureChanged)` (item 1.12)

**Files:**
- Create: `src/presentation/views/focus-restore.ts`
- Create: `tests/focus-restore.test.ts`
- Modify: `src/presentation/views/feature-editor-view.ts` (commit ~134-140, all ~32 `this.commit(...)` call sites, every control in the structured render path, delete `refreshValidation` if it becomes dead)
- Modify: `docs/tech-debt/TD-004.md`, `docs/tech-debt/README.md`

Make re-rendering safe instead of avoidable: `commit()` always re-renders and restores focus/caret via stable `data-focus-key` attributes, so the per-call-site structural/field classification — and its stale-DOM/focus-steal failure modes — disappears. Field edits fire on `change` (verified), so re-render frequency is per-commit, not per-keystroke.

- [x] **Step 1: Write the failing tests for the focus helpers**

Create `tests/focus-restore.test.ts` (the helpers are duck-typed so they're testable in the node environment — no DOM globals):

```ts
import { describe, expect, it, vi } from "vitest";
import { captureFocus, restoreFocus } from "../src/presentation/views/focus-restore";

const input = (key: string | null, selection?: { start: number; end: number }) => ({
  getAttribute: (name: string) => (name === "data-focus-key" ? key : null),
  focus: vi.fn(),
  selectionStart: selection?.start ?? null,
  selectionEnd: selection?.end ?? null,
  setSelectionRange: vi.fn(),
});

const rootWith = (found: unknown) => ({
  contains: () => true,
  querySelector: vi.fn(() => found),
});

describe("captureFocus", () => {
  it("captures the focus key and text selection of the active element", () => {
    const active = input("scenario:1/step:2:text", { start: 3, end: 7 });
    expect(captureFocus(rootWith(null), active)).toEqual({
      key: "scenario:1/step:2:text",
      selectionStart: 3,
      selectionEnd: 7,
    });
  });

  it("returns null when nothing is focused, the element is outside the root, or unkeyed", () => {
    expect(captureFocus(rootWith(null), null)).toBeNull();
    expect(captureFocus({ contains: () => false, querySelector: () => null }, input("k"))).toBeNull();
    expect(captureFocus(rootWith(null), input(null))).toBeNull();
  });
});

describe("restoreFocus", () => {
  it("re-focuses the matching element and restores the selection", () => {
    const target = input("scenario:1/step:2:text");
    const root = rootWith(target);
    restoreFocus(root, { key: "scenario:1/step:2:text", selectionStart: 3, selectionEnd: 7 });
    expect(root.querySelector).toHaveBeenCalledWith('[data-focus-key="scenario:1/step:2:text"]');
    expect(target.focus).toHaveBeenCalled();
    expect(target.setSelectionRange).toHaveBeenCalledWith(3, 7);
  });

  it("is a no-op for a null snapshot or a vanished element, and survives selection failures", () => {
    restoreFocus(rootWith(null), null);
    restoreFocus(rootWith(null), { key: "gone", selectionStart: null, selectionEnd: null });
    const stubborn = {
      ...input("k"),
      setSelectionRange: vi.fn(() => {
        throw new Error("type=number refuses ranges");
      }),
    };
    expect(() =>
      restoreFocus(rootWith(stubborn), { key: "k", selectionStart: 0, selectionEnd: 0 }),
    ).not.toThrow();
    expect(stubborn.focus).toHaveBeenCalled();
  });
});
```

Run: `npx vitest run tests/focus-restore.test.ts` → FAIL (module not found).

- [x] **Step 2: Implement the helpers**

Create `src/presentation/views/focus-restore.ts`:

```ts
/**
 * Focus capture/restore across a full editor re-render (TD-004). Editor
 * controls carry a stable, positional `data-focus-key`
 * (e.g. `scenario:1/step:2:text`); commit() captures the focused key (and
 * text selection) before rebuilding the DOM and re-focuses the match
 * afterwards. Keys use only `[a-z0-9:/-]`, so no CSS escaping is needed.
 * Duck-typed (no DOM lib types) so the logic is unit-testable in the node
 * test environment.
 */
export interface FocusSnapshot {
  key: string;
  selectionStart: number | null;
  selectionEnd: number | null;
}

interface FocusableLike {
  getAttribute(name: string): string | null;
  focus(): void;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  setSelectionRange?(start: number, end: number): void;
}

interface FocusRootLike {
  contains(node: unknown): boolean;
  querySelector(selector: string): unknown;
}

export const captureFocus = (root: FocusRootLike, active: unknown): FocusSnapshot | null => {
  if (active === null || typeof active !== "object" || !root.contains(active)) return null;
  const element = active as FocusableLike;
  if (typeof element.getAttribute !== "function") return null;
  const key = element.getAttribute("data-focus-key");
  if (key === null) return null;
  return {
    key,
    selectionStart: typeof element.selectionStart === "number" ? element.selectionStart : null,
    selectionEnd: typeof element.selectionEnd === "number" ? element.selectionEnd : null,
  };
};

export const restoreFocus = (root: FocusRootLike, snapshot: FocusSnapshot | null): void => {
  if (!snapshot) return;
  const element = root.querySelector(`[data-focus-key="${snapshot.key}"]`) as FocusableLike | null;
  if (!element) return;
  element.focus();
  if (snapshot.selectionStart !== null && typeof element.setSelectionRange === "function") {
    try {
      element.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd ?? snapshot.selectionStart);
    } catch {
      // Some input types refuse selection ranges — keeping focus is enough.
    }
  }
};
```

Run: `npx vitest run tests/focus-restore.test.ts` → PASS.

- [x] **Step 3: Flagless `commit()` + the mechanical call-site sweep**

In `feature-editor-view.ts` replace `commit`:

```ts
/**
 * Serialises the working spec, schedules a debounced save, and re-renders.
 * Re-rendering is always safe (TD-004): focus/caret are captured by
 * `data-focus-key` and restored after the rebuild, so call sites no longer
 * classify their change as structural vs field-level.
 */
private commit(): void {
  if (!this.specification) return;
  this.data = serialiseFeature(this.specification);
  this.requestSave();
  const snapshot = captureFocus(this.contentEl, document.activeElement);
  this.render();
  restoreFocus(this.contentEl, snapshot);
}
```

Sweep every call site: `grep -n "this.commit(" src/presentation/views/feature-editor-view.ts` (32 hits pre-plan) — replace all `this.commit(true)` / `this.commit(false)` with `this.commit()`. After the sweep, if `refreshValidation()` has no remaining callers (render rebuilds the strip), delete it — the fallow dead-code gate enforces this; keep `validationEl` only if `render()` still writes through it.

- [x] **Step 4: Key every structured-mode control**

Add `data-focus-key` to every interactive element the structured render path creates. Scheme (positional, matching the TD's proposal):

| Control | Key |
| --- | --- |
| Toolbar buttons | `toolbar:<action>` (e.g. `toolbar:mode`) |
| Feature name / description | `feature:name`, `feature:description` |
| Tag editor (owner-scoped) | `<owner>:tags:add`, `<owner>:tags:<i>:remove` |
| Background add | `background:add` |
| Step controls | `<owner>/step:<j>:<field>` for `keyword`, `text`, `remove`, `up`, `down` |
| Step argument controls | `<owner>/step:<j>:add-table`, `:add-doc`, `:doc-text`, `:doc-remove`; table cells `<owner>/step:<j>/table:<r>:<c>`; table buttons `<owner>/step:<j>/table:<action>` |
| Scenario controls | `scenario:<i>:<field>` for `keyword`, `name`, `remove`, `up`, `down`, `add-step`, `add-examples` |
| Examples controls | `scenario:<i>/examples:<b>:<field>`; header cells `…/head:<c>`; body cells `…/cell:<r>:<c>`; block buttons `…:<action>` |

where `<owner>` is `feature`, `background`, or `scenario:<i>`. Mechanics:

- Pass a `keyPrefix: string` parameter down through `renderStepList`, `renderStepExtras`, `renderExamples`, and `renderTagEditor` (callers supply `"background"` / `` `scenario:${index}` `` / `"feature"`), exactly as those helpers already receive their parent element.
- On `createEl` calls that already pass `attr`, add the pair; otherwise add an `attr` object. Example (feature name input at ~line 258):

```ts
const name = header.createEl("input", {
  type: "text",
  value: spec.featureName,
  cls: "e2e-test-hub-feature-editor-name",
  attr: {
    placeholder: "Feature name",
    "aria-label": "Feature name",
    "data-focus-key": "feature:name",
  },
});
```

and a step-text input inside `renderStepList(parent, steps, keyPrefix, …)`:

```ts
const text = row.createEl("input", {
  type: "text",
  value: step.text,
  attr: { "aria-label": "Step text", "data-focus-key": `${keyPrefix}/step:${index}:text` },
});
```

- Completeness check when done: every `createEl("input"`, `createEl("textarea"`, `createEl("select"`, and `createEl("button"` in the **structured** render path of `feature-editor-view.ts` carries a `data-focus-key` (raw-mode's single textarea keeps focus naturally — keying it is optional but harmless). Verify with `grep -n 'createEl("input"\|createEl("textarea"\|createEl("select"\|createEl("button"' src/presentation/views/feature-editor-view.ts` against `grep -c "data-focus-key"`.

- [x] **Step 5: Verify, close TD-004, CHANGELOG, commit**

Run: `npm run lint && npm run typecheck && npm test && npx fallow audit --base origin/main`
Expected: all green; audit `pass`. (`feature-editor-view.ts` is coverage-excluded view wiring; the helpers are covered by Step 1's tests. Real-DOM focus behaviour is validated manually in Obsidian / by the e2e smoke at PR time — note this in the task report.)

`docs/tech-debt/TD-004.md`: `status: resolved` + append:

```markdown
## Resolution (2026-06-12)

Resolved in the pre-V2 Phase 1 increment (plan:
`docs/superpowers/plans/2026-06-12-pre-v2-phase-1-clear-recorded-debt.md`)
via the always-re-render direction: `commit()` lost its `structureChanged`
parameter; every commit re-renders and restores focus/caret through stable
positional `data-focus-key` attributes (`captureFocus`/`restoreFocus` in
`src/presentation/views/focus-restore.ts`). The ~30 call sites no longer
hand-classify changes, so the stale-DOM / focus-steal failure mode is gone
by construction; re-render cost is uniform and optimisable in one place
(commits fire on `change` events, not per keystroke). V2's editor growth
(US-074 lint strip, US-081 autocomplete, US-082 Use Case Editor) builds on
the safe-by-construction pattern.
```

Move the TD-004 row to **Resolved items** in `docs/tech-debt/README.md`.

Under `### Changed` add:

```markdown
- The Feature Editor always re-renders on commit and restores focus/caret
  via stable control keys (TD-004): edit handlers no longer classify
  changes as structural vs field-level, eliminating the stale-DOM and
  focus-steal bug class the flag invited.
```

```bash
git add src/presentation/views/focus-restore.ts tests/focus-restore.test.ts src/presentation/views/feature-editor-view.ts docs/tech-debt/TD-004.md docs/tech-debt/README.md CHANGELOG.md
git commit -m "refactor: focus-preserving re-render replaces commit(structureChanged) (TD-004, pre-V2 1.12)"
```

---

### Task 14: Full gate, push, PR

**Files:**
- Verify only (plus this plan's checkboxes and any final CHANGELOG proofread)

- [x] **Step 1: Full PR gate locally**

Run: `npm run lint && npm run format:check && npm run typecheck && npm run build && npm run test:coverage`
Expected: all green; coverage thresholds (93/93/93/80) hold — the new shared modules (`serial-queue`, `live-refresh`, `feature-validation`, `focus-restore`) all carry their own tests. If `format:check` flags plan/doc files, run `npm run format` and amend.

- [x] **Step 2: Final fallow audit**

Run: `npx fallow audit --base origin/main`
Expected: verdict `pass`. This increment deletes duplication (six view copies, twin validation blocks) and the known complexity hot spot — the audit should be cleaner than baseline, not just passing. If any finding appears, fix it now (it is by definition introduced by this changeset).

- [x] **Step 3: Tech-debt register sanity check**

`docs/tech-debt/README.md` **Open items** table must now be empty (TD-001…TD-005 all moved to **Resolved items** alongside TD-006). If the empty table reads awkwardly, replace the table body with a single italic line: `*No open items.*` (keep the heading and lifecycle docs).

- [x] **Step 4: Push and open the PR**

```bash
git push -u origin claude/specorator-v2-increment-g137m7
```

(Retry per the repo's network-backoff convention if needed.) Then create a ready-for-review PR against `main` titled:

```
Pre-V2 Phase 1: clear recorded debt V2 builds on (items 1.1–1.12 + runInitialization refactor)
```

Body summary: one bullet per task group (concurrency/serialization 1.1–1.3, settings/path hardening 1.4–1.5, presentation extraction 1.6–1.7, Gherkin debt TD-001/002/003/005, editor re-render TD-004, the `runInitialization` complexity refactor), the decisions list from this plan's header, and a note that the blocking quality gate + (if triggered) e2e smoke validate the increment. Link the plan file.

- [x] **Step 5: Watch CI**

Subscribe to PR activity; the blocking `quality` job (fallow audit) and the standard CI matrix must go green. This PR does **not** touch the runner-template surface, so the e2e smoke auto-trigger is not expected.

---

## Phase 1 exit criteria (from the proposal §9)

- [x] Use Case note writes serialize per path; settings/post-run/output flows share `SerialQueue` (1.1–1.3)
- [x] `ci.*`/`automation.*` scalars repaired on load; `joinVaultPath`/`getVaultBasePath` hardened (1.4–1.5)
- [x] `LiveRefresh` extracted; six views migrated; `register-commands` smoke-tested; existence checks Vault-API-first (1.6–1.7)
- [x] TD-001, TD-002, TD-003, TD-005, TD-004 resolved and closed in the register (1.8–1.12)
- [x] `runInitialization` no longer trips the blocking gate on edit (TD-006 caveat retired)
- [x] Open tech-debt register is empty; CHANGELOG documents the increment; blocking quality gate green on the PR

**Next increment after this gate:** §9 Phase 2 ("Foundations the V2 epics assume", items 2.1–2.4: settings/data versioning, versioned `.testrunner` manifest + repair upgrades, `ReportParser` port, V2 ADRs), then the Phase 3 playwright-bdd migration — only after which V2.0 feature work begins.
