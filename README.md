# Specorator Test Runner

A local-first, markdown-native, AI-assisted BDD test environment for
[Obsidian](https://obsidian.md). Write test cases in Gherkin inside Markdown
code fences, run them against real websites with Playwright, chain them into
end-to-end flows on the Obsidian Canvas, and read quality/regression reports
right in your vault.

> Status: **early design / scaffolding.** See [`DESIGN.md`](./DESIGN.md) for the
> full design of record.

## What it does

- **Author** test cases as ordinary notes — YAML frontmatter for metadata, prose
  for living documentation, a fenced ` ```gherkin ` block for the executable
  scenario.
- **Run** scenarios with a built-in natural-language step vocabulary (most
  scenarios need zero custom code) plus a code-free `(api)` state-setup family
  for seeding data and programmatic login.
- **Report** results back into the vault as Dataview-friendly notes, with
  flakiness scoring and regression detection backed by run history.
- **Chain** cases into E2E flows on the Obsidian Canvas, sharing browser session
  state down the chain.
- **CI** the same suites headless via the `specorator run` CLI — no Obsidian
  required.
- **Assist** authoring and triage with an opt-in local MCP server plus Claude
  Code skills, subagents, and slash commands.

## Architecture

One reusable **engine core** with three frontends — the Obsidian plugin, the
`specorator run` CLI (for CI), and an MCP server (for Claude Code). Playwright is
the primary execution driver. See [`DESIGN.md`](./DESIGN.md).

```
packages/
  engine/   @specorator/engine  — gherkin, vocabulary, driver, runner, reporting
  plugin/   Obsidian plugin     — authoring UI, explorer, canvas, dashboards
  cli/      @specorator/cli      — `specorator run` (headless CI)
  mcp/      @specorator/mcp      — local MCP server for Claude Code
```

## Development

Requires Node 20+.

```bash
npm install        # install workspace deps
npm run build      # build all packages
npm run typecheck  # type-check all packages
```

## License

MIT
