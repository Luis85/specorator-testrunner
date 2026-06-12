---
id: EPIC-013
type: epic
title: Playwright-Native Runner
status: proposed
priority: P1
features:
  - "[[FEAT-029]]"
---

# EPIC-013 Playwright-Native Runner

> Replace cucumber-js-as-runner with playwright-bdd: Gherkin compiles to
> native `@playwright/test` specs. Revisits ADR-0004/AD-5/AD-6/AD-7; requires
> a new ADR ("Adopt playwright-bdd as execution engine") and a migration path
> for existing `.testrunner` projects (repair regenerates managed files; user
> steps are preserved and adapted with guidance).

Proposed in the [V2 Research and Proposal](../proposals/2026-06-11%20V2%20Research%20and%20Proposal.md) §6 — *P1, foundation*.

## Features

- [[FEAT-029]] — Optional Check Libraries *(V2.x, stories on acceptance)*

## Stories rolled up

- [[US-051]] — Migrate the runner to playwright-bdd
- [[US-052]] — Typed step definitions
- [[US-053]] — Run a single scenario
- [[US-054]] — Parallel execution & retries
- [[US-055]] — Browser matrix
- [[US-080]] — Open Playwright UI mode & trace viewer

## Use cases

- [[UC-025]] — Run a single Scenario from a Use Case
- [[UC-026]] — Debug a failed Scenario via Playwright trace
- [[UC-027]] — Run a Suite across multiple browsers
