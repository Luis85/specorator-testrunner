---
type: adr
id: ADR-0019
status: accepted
title: Error Handling and Logging Model
date: 2026-05-30
related:
  - "[[Solution Design]]"
  - "[[Technical Interface Specification]]"
  - "[[Building Block View]]"
  - "[[Event Catalog]]"
  - "[[0014-v1-auth-transport-is-environment-variables]]"
  - "[[0018-at-most-one-active-test-run]]"
---

# Error Handling and Logging Model

The plugin treats errors and diagnostics as first-class concerns with a four-sink, four-level logging model, a typed error-code union, and a UI rule for which surface (console / Notice / Modal / silent) each kind of error reaches. Logs are **vault-resident, configurable, and credential-redacting**.

## Log destinations

Every log call hits the enabled sinks; none of them is conditional on the others.

| Sink | Always on? | Persists across | Use |
| --- | --- | --- | --- |
| Browser console (`console.*`) | Yes | Obsidian session | Developer-facing during plugin dev; visible in Obsidian dev tools. |
| Obsidian `Notice` | Selectively | Toast lifetime | User-facing actionable messages. |
| Persistent file in `<vault>/<logging.path>/plugin-<YYYY-MM-DD>.log` | When `logging.enabled` is true (default) | Forever, until the user deletes / sweeps | Support / post-mortem after a crashed run. |

Logs live **inside the vault** under `Test Hub/logs/` by default. The user controls visibility per their own toolchain: add the path to `.gitignore` to keep logs out of git, or commit them as part of the project. The path, level, and on/off are all configurable in `SettingsTab`.

A daily rotation file naming convention bounds individual file size and makes pruning a one-glob operation (`Test Hub/logs/plugin-2026-*.log`).

## Log levels

`debug | info | warn | error`. `error` and `warn` are always written. `info` writes at the default level. `debug` writes when `logging.level = "debug"`. Settings changes take effect immediately, no plugin reload.

## Credential redaction

Sensitive values cannot land in the persistent log. The `Logger` redacts:

- Any structured field whose key matches `/pass|secret|token|key|auth|credential/i` — value replaced with `"***"` before serialisation.
- Any value that exactly matches an entry in the Active Environment's `SutAuth.env` map (per ADR-0014) — replaced with `"***"`. Catches accidental positional logging.

Redaction is enforced in the `Logger` itself, not at the call sites. Bypassing it requires calling the raw console, which is reviewable.

## Error UX rules

| Trigger | UI surface |
| --- | --- |
| Non-blocking success / progress info | Toast `Notice` (~4 s). |
| Non-blocking user-actionable error (`PATH_UNSAFE`, `COMMAND_DISALLOWED`, etc.) | Persistent `Notice` until clicked. Includes "Show details" → opens the current log file in the Obsidian editor. |
| Blocking decision (reset, first sweep, cancel-and-replace) | `Modal`. Never a Notice. |
| Background failure with no user action | Log to `warn` / `error` sink only; surface in the dashboard health tile. No popup. |
| Subprocess stderr (Cucumber / Playwright) | Streamed into `TestRunPanel`; persisted in the Evidence note body. Never raised as a `Notice`. |

## Subprocess error capture

The runner subprocess writes to its own stdout/stderr — captured by `ChildProcessRunner.runStreaming()` and emitted as `testrun.output.received { stream, line }`. On a terminal event:

- `testrun.completed` (passed / failed) — stderr is preserved with the run record and rendered in the Evidence note's "Runner output" collapsible section.
- `testrun.failed` (errored) — stderr is the primary diagnosis; `AppError.cause` carries the full stderr; Evidence body opens with it.
- `testrun.cancelled` — partial stderr is captured best-effort.

## Error code convention

`AppError.code` is a `SCREAMING_SNAKE_CASE` string with `<DOMAIN>_<KIND>` shape, declared as a string-literal union in `application/errors.ts` so adding a new code is a compile-time concern.

```ts
export type ErrorCode =
  // execution
  | "RUN_IN_PROGRESS"                      // ADR-0018
  | "RUN_TIMEOUT"
  | "RUN_CANCELLED"
  // path / command safety
  | "PATH_UNSAFE"                          // PathSafetyPolicy
  | "COMMAND_DISALLOWED"                   // CommandSafetyPolicy
  // install / runner
  | "INIT_FAILED"
  | "RUNNER_MISSING_FILE"
  | "BROWSER_NOT_INSTALLED"
  | "NPM_INSTALL_FAILED"
  // report / evidence
  | "REPORT_NOT_FOUND"
  | "REPORT_PARSE_FAILED"
  | "EVIDENCE_WRITE_FAILED"
  // settings / validation
  | "SETTINGS_INVALID"                     // settings document fails schema/shape validation
  | "VALIDATION_FAILED"                    // generic per-input/value validation failure
  | "SUT_ENV_NOT_FOUND";
```

> Note: the implemented union (`src/shared/errors/errors.ts`) also carries `MAINTENANCE_IN_PROGRESS` (reset/repair vs run mutual exclusion, security L1). The naming chokepoint is `CommandSafetyPolicy` (`DefaultCommandSafetyPolicy`) — an earlier draft of this ADR referred to a `RunnerExecutionPolicy`, which is not the implemented class name.

**`SETTINGS_INVALID` vs `VALIDATION_FAILED`.** Both are validation codes but are deliberately distinct, not redundant:

- `SETTINGS_INVALID` is reserved for the **settings document as a whole** failing to load/save cleanly — a malformed or out-of-range `TestHubSettings` blob (e.g. via hand-edit or Obsidian Sync). It backs the SettingsTab "Invalid setting" surface and the load/save guard.
- `VALIDATION_FAILED` is the **general-purpose input-validation** code used wherever a service rejects a specific value or argument that is *not* the settings document (a supplied slug, name, path, etc. failing a per-field check). It is widely used across the application services.

Keeping them separate lets callers distinguish "your saved configuration is broken" from "this particular input you just gave me is invalid" — they surface and recover differently.

Codes are stable across plugin versions (they're API for support and i18n). Adding is safe; renaming is a breaking change.

## Logger contract

```ts
export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, error?: Error | AppError, fields?: Record<string, unknown>): void;
}
```

Structured logging: `fields` is JSON-serialised into the persistent log; the console sink expands them inline. The convention name `runId` is reserved so log filtering by run is trivial.

## Considered alternatives

- **Logs in OS temp dir.** Doesn't sync, doesn't bloat the vault, no risk of accidental git commit. Rejected: less discoverable; user can't find them without instruction; survives only until the OS clears temp.
- **Logs in `.obsidian/plugins/e2e-test-hub/logs/`.** Plugin-data adjacent. Rejected: `.obsidian/` is sometimes committed; the user has no way to gitignore selectively without breaking other plugin data.
- **Console-only.** Simplest. Rejected: gone the moment the user reloads Obsidian; useless for support stories.
- **No credential redaction.** Trust call sites. Rejected: one careless `logger.debug("auth context", env)` leaks credentials into a file that may sync; redaction in the Logger itself is the only safe default.

## Residual risk: vault sync

Because logs live inside the vault and the default path (`Test Hub/logs/`) is not a dotfolder, Obsidian Sync (and similar vault syncers — iCloud, Dropbox) will copy logs across the user's devices unless explicitly excluded. The Logger's credential redaction covers structured fields and the Active Environment's known credential values, but it cannot catch every fragment a subprocess might print on stderr (URLs with query strings, paths to private files, third-party error traces).

The plugin documents this risk rather than mitigating it programmatically:

- The generated **User Manual** has a "Logs and sync" section that explains the risk and shows the exact lines to add to Obsidian Sync exclusions (and to `.gitignore`).
- The dashboard renders a passive **"Sync risk: logs are inside the vault"** tile next to the CI Readiness tile. The tile links to the manual section.

Moving the default path to a dotfolder (`.testhub-logs/`) was considered and rejected: it would lose the "discoverable in the vault" property the user explicitly wanted, and it would silently bypass the user's own sync/backup preferences. Generating sync-exclusion files automatically was considered and rejected: Obsidian Sync's exclusion file is user-owned, and writing to it without asking is invasive. Documentation + a passive dashboard tile is the lightest mitigation that respects user intent.

The default path can be moved to a dotfolder in V1.1 if telemetry-free user feedback shows people are surprised by what synced — no data migration needed (logs are local-machine artifacts).

## Consequences

- New `LoggingSettings` section under `TestHubSettings`. `RunnerSettings.verboseLogging` is *not* introduced; `logging.level` covers the same surface more generally.
- New `LogSinkPort` infrastructure adapter that writes to `<vault>/<logging.path>/plugin-<YYYY-MM-DD>.log`.
- `Logger` lives in the Shared Kernel and depends only on the port interface.
- `AppError.code` typed as `ErrorCode` union — new codes are added by editing the union.
- SettingsTab gains a Logging section: enabled, path (with `PathSafetyPolicy` validation), level.
- Users who don't want logs in git add the configured path to `.gitignore`; users who want a log archive commit it. Plugin doesn't take a position on which.
- Dashboard gains a passive "Sync risk" tile; User Manual gains a "Logs and sync" section.
