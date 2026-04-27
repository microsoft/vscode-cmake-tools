import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prRules } from "../data/prRules.js";

export interface ChecklistItem {
    rule: string;
    status: "pass" | "warn" | "manual_check_required";
    hint: string;
}

export function registerPrChecklistTool(server: McpServer): void {
    server.registerTool(
        "check_pr_readiness",
        {
            title: "Check PR Readiness",
            description:
                "Given a free-text description of what a contributor changed, returns a checklist " +
                "of PR requirements derived from CONTRIBUTING.md. Each item has a rule, a status " +
                '("pass", "warn", or "manual_check_required"), and a hint. Since we cannot ' +
                "inspect the actual diff, most items are 'manual_check_required' with a helpful " +
                "hint. Items are flagged as 'warn' when the description suggests a potential issue.",
            inputSchema: z.object({
                changes: z
                    .string()
                    .describe("A free-text description of what the contributor changed.")
            })
        },
        async ({ changes }) => {
            const lowerChanges = changes.toLowerCase();

            const checklist: ChecklistItem[] = prRules.map((rule) => {
                let status: ChecklistItem["status"] = "manual_check_required";

                // Flag as "warn" if the change description contains any warn keywords
                if (
                    rule.warnKeywords?.some((keyword) =>
                        lowerChanges.includes(keyword.toLowerCase())
                    )
                ) {
                    status = "warn";
                }

                return {
                    rule: rule.rule,
                    status,
                    hint: rule.hint
                };
            });

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(checklist, null, 2)
                    }
                ]
            };
        }
    );
}
