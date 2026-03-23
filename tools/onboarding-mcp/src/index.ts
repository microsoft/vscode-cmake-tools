import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerSetupTool } from "./tools/setup.js";
import { registerPrChecklistTool } from "./tools/prChecklist.js";

const server = new McpServer({
    name: "cmake-tools-onboarding",
    version: "0.1.0"
});

// Register all tools
registerSetupTool(server);
registerPrChecklistTool(server);

// Start the server over stdio
const transport = new StdioServerTransport();
await server.connect(transport);
