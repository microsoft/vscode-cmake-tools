export interface RepoLabel {
    name: string;
    description: string;
    /** If true, issues with this label are generally not code changes — skip for newcomers. */
    skipForContributors?: boolean;
}

export const knownLabels: RepoLabel[] = [
    {
        name: "bug",
        description: "Something is broken"
    },
    {
        name: "enhancement",
        description: "New feature or improvement"
    },
    {
        name: "documentation",
        description: "Documentation gap or error"
    },
    {
        name: "good first issue",
        description: "Explicitly tagged for newcomers — great starting point"
    },
    {
        name: "help wanted",
        description: "Maintainers are looking for community contribution"
    },
    {
        name: "question",
        description: "Not a code change — usually a support request",
        skipForContributors: true
    }
];
