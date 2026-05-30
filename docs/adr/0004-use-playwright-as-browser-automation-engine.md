---
type: adr
id: ADR-0004
status: accepted
title: Use Playwright as Browser Automation Engine
date: 2026-05-30
related:
  - "[[Solution Design]]"
  - "[[Technical Interface Specification]]"
---

# Use Playwright as Browser Automation Engine

Playwright drives the browser from the Cucumber `World`. Selected over Selenium, Cypress, and Puppeteer because: (a) first-class TypeScript support, (b) built-in trace + screenshot capture (which the Evidence pipeline depends on), (c) reliable auto-waiting that reduces flake without per-step sleeps, and (d) `playwright install --with-deps` is a one-command CI setup.

Playwright Test (the runner) is **not** used; Cucumber-JS is the runner and Playwright is used purely as the browser library. See [[0003-use-gherkin-as-specification-format]] for the Cucumber-vs-alternatives rationale.

## Considered alternatives

- Selenium. Rejected: weaker debugging, no first-party trace artifacts, slower test loop.
- Cypress. Rejected: in-browser execution model is incompatible with Cucumber-JS step definitions; multi-tab / new-window scenarios are limited.
- Puppeteer. Rejected: smaller maintained surface than Playwright and weaker cross-browser story.
