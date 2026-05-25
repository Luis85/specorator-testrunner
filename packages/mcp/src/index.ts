// Specorator local MCP server (stdio) for Claude Code.
// See DESIGN.md section 7 for the full tool/resource/prompt contracts and the
// loopback execution-trigger channel.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "specorator",
  version: "0.0.1",
});

// Placeholder read-only tool. The full spec_* tool surface (validate/create/
// update/run/report/flakiness) is added in Phase 4.
server.registerTool(
  "spec_list_suites",
  {
    title: "List test suites",
    description: "List Specorator test suites found in the vault.",
    inputSchema: {
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    },
  },
  async () => {
    // TODO(phase-4): read suites from the vault working directory.
    return { content: [{ type: "text", text: "[]" }] };
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
