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
