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

All paths the plugin handles are typed as `VaultPath` and validated by `PathSafetyPolicy`: relative to the vault root, never starting with `/`, never containing `..`. Absolute paths cross a port boundary into `AbsoluteFileSystem`, which is only used for the child-process working directory and for CI workflow generation at the repo root.

This makes vault content portable across machines without rewriting paths, makes settings round-trip cleanly through `loadData()`/`saveData()`, and makes the path-safety policy a single chokepoint that prevents the plugin from writing outside the vault.
