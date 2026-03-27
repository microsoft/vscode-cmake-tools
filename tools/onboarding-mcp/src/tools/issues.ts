import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { githubGet, GitHubApiError, REPO_URL } from "../github.js";
import { knownLabels } from "../data/labels.js";

interface GitHubIssue {
    number: number;
    title: string;
    html_url: string;
    labels: Array<{ name: string }>;
    comments: number;
    created_at: string;
    updated_at: string;
    body: string | null;
    pull_request?: unknown;
}

function truncateBody(body: string | null, maxLen = 300): string {
    if (!body) {
        return "";
    }
    const trimmed = body.trim();
    if (trimmed.length <= maxLen) {
        return trimmed;
    }
    return trimmed.slice(0, maxLen).trimEnd() + "...";
}

function isRecentlyUpdated(updatedAt: string, daysThreshold = 90): boolean {
    const updated = new Date(updatedAt).getTime();
    const cutoff = Date.now() - daysThreshold * 24 * 60 * 60 * 1000;
    return updated >= cutoff;
}

export function registerIssuesTool(server: McpServer): void {
    server.registerTool(
        "get_contributor_issues",
        {
            title: "Get Contributor Issues",
            description:
                "Fetches recently updated open issues from the vscode-cmake-tools GitHub repo " +
                "and enriches each with contributor-friendliness signals (good-first-issue label, " +
                "recency, comment count, etc.) so Copilot can reason about what's workable for " +
                "a new contributor. Optionally filter by label (e.g. 'bug', 'enhancement', 'good first issue'). " +
                "Known labels: " + knownLabels.map((l) => `"${l.name}"`).join(", ") + ".",
            inputSchema: z.object({
                limit: z
                    .number()
                    .int()
                    .min(1)
                    .max(50)
                    .default(20)
                    .describe("Number of issues to fetch (default 20, max 50)."),
                label: z
                    .string()
                    .optional()
                    .describe(
                        "Optional label filter, e.g. 'bug', 'enhancement', 'good first issue'. " +
                        "If omitted, returns all recently updated open issues."
                    )
            })
        },
        async ({ limit, label }) => {
            const effectiveLimit = Math.min(limit ?? 20, 50);

            let path = `/issues?state=open&sort=updated&direction=desc&per_page=${effectiveLimit}`;
            if (label) {
                path += `&labels=${encodeURIComponent(label)}`;
            }

            try {
                const raw = await githubGet<GitHubIssue[]>(path);

                // Filter out pull requests (GitHub's issues endpoint includes PRs)
                const issues = raw.filter((i) => !i.pull_request);

                const enriched = issues.map((issue) => {
                    const labelNames = issue.labels.map((l) => l.name);
                    return {
                        number: issue.number,
                        title: issue.title,
                        url: issue.html_url,
                        labels: labelNames,
                        commentCount: issue.comments,
                        createdAt: issue.created_at,
                        updatedAt: issue.updated_at,
                        body: truncateBody(issue.body),
                        contributorSignals: {
                            hasGoodFirstIssueLabel: labelNames.includes("good first issue"),
                            isRecentlyUpdated: isRecentlyUpdated(issue.updated_at),
                            hasLowCommentCount: issue.comments < 5,
                            hasNoBugLabel: !labelNames.includes("bug")
                        }
                    };
                });

                const result = {
                    issues: enriched,
                    meta: {
                        fetchedAt: new Date().toISOString(),
                        repoUrl: REPO_URL,
                        totalReturned: enriched.length,
                        tip: "Issues with hasGoodFirstIssueLabel or low comment counts are often the best starting point for new contributors. Feature and documentation issues (hasNoBugLabel) tend to be safer than bug fixes for newcomers."
                    }
                };

                return {
                    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }]
                };
            } catch (error) {
                const message =
                    error instanceof GitHubApiError
                        ? error.message
                        : `Failed to fetch issues: ${error instanceof Error ? error.message : String(error)}`;

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
