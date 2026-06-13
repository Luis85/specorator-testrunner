---
type: adr
id: ADR-0024
status: accepted
title: Credential Storage Via Obsidian secretStorage
date: 2026-06-13
related:
  - "[[0013-sut-modeled-as-named-environments]]"
  - "[[0014-v1-auth-transport-is-environment-variables]]"
  - "[[2026-06-13-v2-foundational-adrs-design]]"
---

# Credential Storage Via Obsidian secretStorage

V2 moves SUT credentials out of plaintext in `data.json` (the SDD AD-9 tactical debt) into Obsidian's first-party secret storage. The plugin persists only the **secret name** per Environment auth key in settings; the **value** lives in Obsidian's machine-local, non-synced `app.secretStorage`, entered by the user through the `SecretComponent` UI. At run time the plugin calls `app.secretStorage.get(name)` and injects the value into the runner subprocess environment.

## Transport is unchanged

ADR-0014 is untouched. The plugin still injects per-Environment key/value pairs as environment variables; the user's step definitions read `process.env.*`; CI still reads the same keys from `secrets.E2E_*`. This decision changes **only storage at rest** — the value `get()` returns feeds the exact same `{ BASE_URL, ...auth.env }` spawn environment as today.

## Why first-party over the alternatives

`app.secretStorage` gives in-app UX (`SecretComponent`) **and** the "plugin never persists plaintext" privacy property **and** machine-local, not-synced semantics (right for credentials — they never ride Obsidian Sync to other devices) **and** marketplace-clean status — without a `require('electron')` `safeStorage` reach-around or the cross-platform variance, both of which become Obsidian's concern. The privacy/compliance persona (finance — 54.9% blocked by cloud-AI compliance) makes "we never store your credentials in the vault" a feature, not just hygiene.

## Considered alternatives

- **`.env`-only — plugin stores key names, values in a git-ignored `.testrunner/.env`.** Same privacy property but worse UX (no in-app entry; the user manages a file). Superseded by `secretStorage`, which keeps in-app entry.
- **Electron `safeStorage` directly (ciphertext in `data.json`).** Rejected: accessibility from an Obsidian plugin renderer is unverified, Linux libsecret may be absent, and the cross-platform variance is ours to own — all of which `secretStorage` abstracts.
- **Encrypted-at-rest in `data.json` with a plugin-managed key/passphrase.** Rejected: reintroduces key management (a key in `data.json` is theater; a passphrase is per-session friction).

## Migration

None. The plugin is in pre-announcement beta with no backwards-compat obligation: existing V1 plaintext `auth.env` values in `data.json` are dropped on the cut-over and users re-enter via `SecretComponent`. No import path, no deprecated read.

## Consequences

- Retires SDD AD-9 (plaintext credentials in plugin data).
- `SutAuth` changes shape: the V1 `env: Record<string, string>` (name → value) becomes name → secret-name references resolved through `secretStorage` at spawn time. `EnvironmentValidationService` validates that referenced secrets exist.
- **Redaction must follow the resolved values, not settings (ADR-0019).** V1 builds the redaction set — `TestExecutionService`'s per-run `runSecrets` and the Logger's secret set (`logger.setSecrets`) — from `collectCredentialValues(settings)`, which reads `auth.env` *values*. Once `auth.env` holds secret *names* and the real values live in `secretStorage`, that path would redact only the names, so a credential fetched from `secretStorage` and echoed by the runner could reach live `testrun.output.received` output and logs in the clear. **The values resolved from `secretStorage` for the spawn environment MUST be added to the redaction set at the same point they are fetched.** `collectCredentialValues` (and the logger's secret seeding) are re-pointed at the resolved values rather than at `settings`. This is a hard requirement of EPIC-020's credential work; a redaction test that runs a credential through output asserts it is masked (raised by the codex review on PR #38).
- **Verify-at-build:** the `minAppVersion` that `app.secretStorage` / `SecretComponent` require (a likely `manifest.json` bump), and that retrieval works on desktop, where runs happen (mobile is read-only per EPIC-018, so desktop-only secret access is acceptable). The exact at-rest encryption guarantee is confirmed before any strong written security claim; the load-bearing properties (no plaintext in `data.json`/git, machine-local, not synced, first-party) hold regardless.
