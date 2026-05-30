---
type: adr
id: ADR-0002
status: accepted
title: Store Runner in .testrunner
date: 2026-05-30
related:
  - "[[Solution Design]]"
  - "[[Building Block View]]"
  - "[[0001-separate-plugin-and-runner]]"
---

# Store Runner in .testrunner

The runner lives at `<vault root>/.testrunner/`. The dotfolder prefix keeps it out of Obsidian's file explorer (which hides dotfolders by default) while still placing it inside the git repo so CI can check it out alongside the vault content.

This avoids two failure modes: (a) the runner files cluttering the user's Obsidian sidebar; (b) the runner sitting outside the vault and being missing from the user's git workflow.
