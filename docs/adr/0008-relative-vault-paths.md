---
type: adr
id: ADR-0008
status: accepted
title: Use Relative Vault Paths
date: 2026-05-30
related:
  - "[[Technical Interface Specification]]"
  - "[[Solution Design]]"
---

# Use Relative Vault Paths

All paths the plugin handles are typed as `VaultPath` and validated by `PathSafetyPolicy`: relative to the vault root, never starting with `/`, never containing `..`. Absolute paths cross a port boundary into `AbsoluteFileSystem`, and only for a small, enumerated set of sanctioned crossings:

- the child-process **working directory** (the `.testrunner` runner dir);
- **CI workflow generation** at the repo root;
- the configured **Node executable path** (`RunnerSettings.nodeExecutable`) — `CommandSafetyPolicy` explicitly permits `node` (and only `node`) to be an absolute or version-manager path so a system Node can be targeted, while still requiring `npm`/`npx` to be bare PATH-resolved commands (`command-safety-policy.ts`);
- **runtime-derived paths** computed from the vault base path obtained at the infrastructure boundary (`AbsoluteFileSystem.getVaultBasePath()`) — e.g. the absolute runner working directory and the Playwright browser-cache candidates resolved in `runner-paths.ts`. These are derived by joining vault-relative segments onto a single runtime-obtained absolute base, not accepted as configuration.

Everything else stays relative.

This makes vault content portable across machines without rewriting paths, makes settings round-trip cleanly through `loadData()`/`saveData()`, and makes the path-safety policy a single chokepoint that prevents the plugin from writing outside the vault.

## Branded `VaultPath` with a smart-constructor chokepoint (P3-4 ✅)

`VaultPath` is now a **branded type** — `string & { readonly __brand: "VaultPath" }` (`domain/value-objects/identifiers.ts`) — so a plain `string` can no longer be assigned to it. Obtaining one forces a deliberate choice between two constructors in `domain/value-objects/vault-path.ts`:

- **`vaultPath(raw): Result<VaultPath>`** — the SMART constructor. It runs `DefaultPathSafetyPolicy.validate` and brands the value on success. This is the type-enforced ADR-0008 chokepoint for **untrusted** input (settings on disk, frontmatter, user-entered paths). `SettingsService.load()` already validated each path here; loaded paths now leave that boundary genuinely branded.
- **`unsafeVaultPath(raw): VaultPath`** — a documented, NO-OP cast for values already known to be safe (the `DEFAULT_SETTINGS` constants, recombinations of already-branded segments such as `joinVaultPath`, Obsidian-managed file paths, and test fixtures). It performs no validation, so every call site is part of the auditable trusted surface; `grep -rn unsafeVaultPath src tests` enumerates it.

The runtime behaviour is unchanged — `PathSafetyPolicy` runs exactly where it ran before. The brand only makes the type reflect the existing chokepoint: the single way to turn an arbitrary string into a `VaultPath` is to pass validation or to make an explicit, greppable `unsafeVaultPath` cast. Only `VaultPath` is branded; `UseCaseId`/`SuiteId`/`RunId`/`EvidenceId` remain plain string aliases (smallest blast radius that captures the security value).
