export interface PrRule {
    id: string;
    rule: string;
    hint: string;
    /** If the user's change description contains any of these keywords, flag the rule as "warn". */
    warnKeywords?: string[];
}

export const prRules: PrRule[] = [
    {
        id: "changelog",
        rule: "Updated CHANGELOG.md as part of the PR",
        hint: "Add an entry under the current version in CHANGELOG.md describing your user-visible change. Follow the existing tense and category style (Features / Improvements / Bug Fixes)."
    },
    {
        id: "naming-convention",
        rule: "New variables use lowerCamelCase, not snake_case",
        hint: "snake_case was used historically but is being phased out. All new variables must use lowerCamelCase."
    },
    {
        id: "yarn-lock-unchanged",
        rule: "yarn.lock was NOT modified and NOT committed",
        hint: "If you deleted .npmrc for local dev, yarn.lock may have changed. Revert it before committing: git checkout yarn.lock"
    },
    {
        id: "npmrc-unchanged",
        rule: ".npmrc was NOT committed",
        hint: "The .npmrc file points to an Azure Artifacts feed and must not be modified or deleted in your PR."
    },
    {
        id: "lint-passes",
        rule: "yarn run lint was run and passes",
        hint: "Run 'yarn run lint' locally and fix all warnings and errors before submitting your PR."
    },
    {
        id: "coding-guidelines",
        rule: "TypeScript coding guidelines followed",
        hint: "Follow the TypeScript coding guidelines: https://github.com/Microsoft/TypeScript/wiki/Coding-guidelines. Code is formatted using the default TypeScript formatter in VS Code with 4-space indentation."
    },
    {
        id: "dependency-changes",
        rule: "If package.json dependencies were added or changed, the team was pinged in the PR",
        hint: "Dependency changes require intervention from the CMake Tools team because the repo uses an Azure Artifacts feed. Mention @microsoft/vscode-cmake-tools in the PR.",
        warnKeywords: ["package.json", "dependency", "dependencies", "npm install", "yarn add", "added a package", "updated a package", "new dependency"]
    }
];
