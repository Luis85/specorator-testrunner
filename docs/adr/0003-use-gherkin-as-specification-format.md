---
type: adr
id: ADR-0003
status: accepted
title: Use Gherkin as Specification Format
date: 2026-05-30
related:
  - "[[Specorator Testrunner]]"
  - "[[Solution Design]]"
---

# Use Gherkin as Specification Format

Feature specifications are written in Gherkin (`.feature` files), executed by Cucumber-JS. The personas the product is for — Product Owners, Business Analysts, QA Engineers — already work in `Given/When/Then` language; using anything else would force the product to invent its own specification language.

Lock-in is real but acceptable: a Gherkin scenario maps one-for-one to a Cucumber step definition, and replacing Cucumber later means rewriting the runtime but not the specifications. The Markdown-native vault is preserved either way.

## Considered alternatives

- Plain TypeScript test files (e.g. Playwright Test). Rejected: removes the living-documentation property; product owners cannot read or author them.
- Custom Markdown DSL. Rejected: invents a tool nobody else supports and tools (Cucumber Studio, Jira, IDE plugins) cannot read.
