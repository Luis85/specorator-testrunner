---
id: FEAT-031
type: feature
title: Report-Parser Port & Importers
status: proposed
priority: P3
increment: V2.x
epic: "[[EPIC-019]]"
stories:
  - "[[US-094]]"
  - "[[US-095]]"
---

# FEAT-031 Report-Parser Port & Importers

> Feature of [[EPIC-019]] — Interop & Open Formats. *(V2.x, stories on
> acceptance.)*

Pluggable `ReportParser` chain (Playwright JSON, JUnit XML) so externally-run
suites can feed evidence ("bring your own report"); CSV/Markdown importers
from TestRail/Xray/Zephyr exports to capture switchers (the research shows
export pain is a real switching trigger).

## Stories

Drafted ahead of acceptance; the feature itself stays V2.x. Both build on
the `ReportParser` port extracted pre-V2 (proposal §9 item 2.3).

- [[US-094]] — Bring-your-own-report import
- [[US-095]] — Test-management importers
