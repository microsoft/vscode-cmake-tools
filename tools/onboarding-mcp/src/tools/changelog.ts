import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { githubGet, GitHubApiError, REPO_URL } from "../github.js";
import { matchAreas } from "../data/sourceMap.js";

interface GitHubCommit {
    sha: string;
    commit: {
        message: string;
        author: {
            date: string;
        };
    };
    author: {
        login: string;
    } | null;
    html_url: string;
}

export function registerChangelogTool(server: McpServer): void {
    server.registerTool(
        "get_recent_changes",
        {
            title: "Get Recent Changes",
            description:
                "Fetches the most recent commits to the main branch of vscode-cmake-tools. " +
                "Each commit is annotated with affected areas (derived from keywords in the commit message " +
                "matched against the codebase source map). Includes a summary of the most active areas " +
                "to help new contributors understand what's currently in flux.",
            inputSchema: z.object({
                limit: z
                    .number()
                    .int()
                    .min(1)
                    .max(30)
                    .default(10)
                    .describe("Number of recent commits to fetch (default 10, max 30).")
            })
        },
        async ({ limit }) => {
            const effectiveLimit = Math.min(limit ?? 10, 30);

            try {
                const raw = await githubGet<GitHubCommit[]>(
                    `/commits?per_page=${effectiveLimit}`
                );

                // Track area frequencies for the summary
                const areaFrequency = new Map<string, number>();

                const commits = raw.map((c) => {
                    const firstLine = c.commit.message.split("\n")[0].trim();
                    const areas = matchAreas(c.commit.message);

                    for (const area of areas) {
                        areaFrequency.set(area, (areaFrequency.get(area) ?? 0) + 1);
                    }

                    return {
                        sha: c.sha.slice(0, 7),
                        message: firstLine,
                        author: c.author?.login ?? "unknown",
                        date: c.commit.author.date,
                        url: c.html_url,
                        affectedAreas: areas
                    };
                });

                // Top 3 most active areas
                const mostActiveAreas = [...areaFrequency.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([area]) => area);

                const areaList = mostActiveAreas.join(", ") || "general";
                const tip =
                    mostActiveAreas.length > 0 && !mostActiveAreas.includes("general")
                        ? `Recent activity is concentrated in ${areaList} — if you're new, these areas may have more in-flux context to catch up on.`
                        : "Recent commits span a broad range of areas. Check the affectedAreas on each commit to find patterns.";

                const result = {
                    commits,
                    summary: {
                        fetchedAt: new Date().toISOString(),
                        repoUrl: REPO_URL,
                        totalReturned: commits.length,
                        mostActiveAreas,
                        tip
                    }
                };

                return {
                    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }]
                };
            } catch (error) {
                const message =
                    error instanceof GitHubApiError
                        ? error.message
                        : `Failed to fetch commits: ${error instanceof Error ? error.message : String(error)}`;

                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify({ error: message }, null, 2)
                        }
                    ],
                    isError: true
                };
            }
        }
    );
}
