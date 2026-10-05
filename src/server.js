import { readFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { tools } from "./tools.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const toolsByName = new Map(tools.map((t) => [t.name, t]));

const errorResult = (message) => ({
  content: [{ type: "text", text: JSON.stringify({ error: message }) }],
  isError: true,
});

export function createServer() {
  const server = new Server({ name: pkg.name, version: pkg.version }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = toolsByName.get(name);
    if (!tool) return errorResult(`Unknown tool: ${name}`);
    try {
      const { payload, isError } = tool.handler(args ?? {});
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError };
    } catch (err) {
      return errorResult(`Unhandled error in ${name}: ${err && err.message ? err.message : String(err)}`);
    }
  });

  return server;
}

export async function runStdioServer() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  // stderr only: stdout is reserved for the JSON-RPC stream.
  console.error(`${pkg.name} ${pkg.version}: MCP server running on stdio`);
}
