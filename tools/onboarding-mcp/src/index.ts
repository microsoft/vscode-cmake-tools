import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerSetupTool } from "./tools/setup.js";
import { registerPrChecklistTool } from "./tools/prChecklist.js";
import { registerConceptTool } from "./tools/concepts.js";
import { registerCodeMapTool } from "./tools/codeMap.js";
import { registerDocsTool } from "./tools/docs.js";

const server = new McpServer({
    name: "cmake-tools-onboarding",
    version: "0.2.0"
});

// Phase 1 tools
registerSetupTool(server);
registerPrChecklistTool(server);

// Phase 2 tools
registerConceptTool(server);
registerCodeMapTool(server);
registerDocsTool(server);

// Start the server over stdio
const transport = new StdioServerTransport();
await server.connect(transport);
