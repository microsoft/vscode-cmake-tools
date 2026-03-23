import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { findDocsEntries, knownTopics } from "../data/docsMap.js";

export function registerDocsTool(server: McpServer): void {
    server.registerTool(
        "get_docs_page",
        {
            title: "Get Docs Page",
            description:
                "Given a topic (e.g. 'presets', 'kits', 'debugging', 'settings', 'troubleshooting'), " +
                "returns the matching documentation page with its file path, GitHub URL, a summary, and key headings. " +
                "If no match is found, returns a list of all known topics.",
            inputSchema: z.object({
                topic: z
                    .string()
                    .describe(
                        "The documentation topic — e.g. 'presets', 'kits', 'debugging', 'settings', " +
                        "'troubleshooting', 'faq', 'build', 'configure', 'tasks', 'variants'."
                    )
            })
        },
        async ({ topic }) => {
            const entries = findDocsEntries(topic);

            if (entries.length === 0) {
                const topics = knownTopics();
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    error: `No documentation found for topic: "${topic}"`,
                                    knownTopics: topics,
                                    hint: "Try one of the known topics listed above."
                                },
                                null,
                                2
                            )
                        }
                    ]
                };
            }

            // Return the best match as the primary result, with additional matches as related pages
            const best = entries[0];
            const related = entries.slice(1).map((e) => ({
                file: e.file,
                githubUrl: e.githubUrl,
                summary: e.summary
            }));

            const result: Record<string, unknown> = {
                topic,
                file: best.file,
                githubUrl: best.githubUrl,
                summary: best.summary,
                keyHeadings: best.keyHeadings
            };

            if (related.length > 0) {
                result.relatedPages = related;
            }

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(result, null, 2)
                    }
                ]
            };
        }
    );
}
