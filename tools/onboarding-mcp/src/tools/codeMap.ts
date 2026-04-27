import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { findSourceEntries, sourceMap } from "../data/sourceMap.js";

export function registerCodeMapTool(server: McpServer): void {
    server.registerTool(
        "find_source_file",
        {
            title: "Find Source File",
            description:
                "Given a natural-language description of a feature or area of the codebase " +
                "(e.g. 'kit scanning', 'build logic', 'test runner', 'launch config'), " +
                "returns matching source files with GitHub links, descriptions, and relevance notes. " +
                "If no match is found, returns suggestions of searchable topics.",
            inputSchema: z.object({
                feature: z
                    .string()
                    .describe(
                        "A natural-language description of the feature or area — " +
                        "e.g. 'where is kit scanning', 'build logic', 'test runner', 'launch config', 'status bar'."
                    )
            })
        },
        async ({ feature }) => {
            const results = findSourceEntries(feature);

            if (results.length === 0) {
                // Collect all unique keywords for suggestions
                const allKeywords = new Set<string>();
                for (const entry of sourceMap) {
                    for (const kw of entry.keywords) {
                        allKeywords.add(kw);
                    }
                }

                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    matches: [],
                                    tip: `No matches found for "${feature}". Try searching for one of these topics: ${[...allKeywords].sort().join(", ")}.`
                                },
                                null,
                                2
                            )
                        }
                    ]
                };
            }

            // Flatten matched entries into individual file results
            const matches = results.flatMap((entry) =>
                entry.files.map((f) => ({
                    file: f.path,
                    githubUrl: f.githubUrl,
                    description: f.description,
                    relevance: `Matched keywords: ${entry.keywords.filter((kw) => feature.toLowerCase().includes(kw.toLowerCase()) || kw.toLowerCase().split(/\s+/).some((w) => feature.toLowerCase().includes(w))).join(", ")}`
                }))
            );

            // Deduplicate by file path, keeping the first (highest-relevance) occurrence
            const seen = new Set<string>();
            const deduplicated = matches.filter((m) => {
                if (seen.has(m.file)) {
                    return false;
                }
                seen.add(m.file);
                return true;
            });

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                matches: deduplicated,
                                tip: "Start with the first match — it has the highest relevance to your query. Use 'explain_concept' for a deeper overview of any concept area."
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
