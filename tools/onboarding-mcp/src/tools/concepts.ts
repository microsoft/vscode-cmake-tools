import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { findConcept, knownConceptNames } from "../data/concepts.js";

export function registerConceptTool(server: McpServer): void {
    server.registerTool(
        "explain_concept",
        {
            title: "Explain Concept",
            description:
                "Explains a CMake Tools extension concept (e.g. 'kit', 'preset', 'driver', 'ctest'). " +
                "Returns a summary, detailed explanation, related concepts, relevant source files, " +
                "and a link to the documentation page. " +
                "If the concept is not recognized, returns a list of all known concepts.",
            inputSchema: z.object({
                concept: z
                    .string()
                    .describe(
                        "The concept to explain — e.g. 'kit', 'preset', 'variant', 'driver', 'ctest', " +
                        "'configure', 'build', 'task', 'intellisense', 'cpptools', 'debug', 'extension', 'settings'."
                    )
            })
        },
        async ({ concept }) => {
            const entry = findConcept(concept);

            if (!entry) {
                const known = knownConceptNames();
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    error: `Unknown concept: "${concept}"`,
                                    knownConcepts: known,
                                    hint: "Try one of the known concepts listed above, or use a common alias (e.g. 'test' for 'ctest', 'config' for 'settings')."
                                },
                                null,
                                2
                            )
                        }
                    ]
                };
            }

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                concept: entry.concept,
                                summary: entry.summary,
                                details: entry.details,
                                relatedConcepts: entry.relatedConcepts,
                                sourceFiles: entry.sourceFiles,
                                docsPage: entry.docsPage,
                                docsUrl: entry.docsUrl
                            },
                            null,
                            2
                        )
                    }
                ]
            };
        }
    );
}
