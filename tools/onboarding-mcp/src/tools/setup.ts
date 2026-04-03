import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { setupSteps } from "../data/setupSteps.js";

export function registerSetupTool(server: McpServer): void {
    server.registerTool(
        "get_setup_guide",
        {
            title: "Get Setup Guide",
            description:
                "Returns an ordered list of setup steps a new contributor needs to follow " +
                "to build and run the CMake Tools VS Code extension locally. " +
                "Each step includes a number, title, optional command, and optional notes."
        },
        async () => ({
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify(setupSteps, null, 2)
                }
            ]
        })
    );
}
