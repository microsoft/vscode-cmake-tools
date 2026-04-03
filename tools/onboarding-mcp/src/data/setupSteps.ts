export interface SetupStep {
    step: number;
    title: string;
    command?: string;
    notes?: string;
}

export const setupSteps: SetupStep[] = [
    {
        step: 1,
        title: "Install Node.js",
        notes: "Download and install from https://nodejs.org/en/. The LTS version is recommended."
    },
    {
        step: 2,
        title: "Install yarn globally",
        command: "npm install -g yarn",
        notes: "yarn is used to compile the code and manage dependencies in this repo."
    },
    {
        step: 3,
        title: "Clone the repo and open it in VS Code",
        command: "git clone https://github.com/microsoft/vscode-cmake-tools.git && code vscode-cmake-tools",
        notes: "You can also open the cloned folder from VS Code's File > Open Folder menu."
    },
    {
        step: 4,
        title: "Delete .npmrc for local development",
        command: "rm .npmrc",
        notes: "The repo points the package manager to a public Azure Artifacts feed via .npmrc. Deleting it lets you use the default npm registry for local dev. Do NOT commit this deletion."
    },
    {
        step: 5,
        title: "Install dependencies",
        command: "yarn install",
        notes: "Installs all required packages. If you skipped step 4, this may fail due to the Azure Artifacts feed requiring authentication."
    },
    {
        step: 6,
        title: "Build and run the extension",
        command: "Press F5 in VS Code",
        notes: "This compiles the extension and launches it in a new Extension Development Host window. You can set breakpoints in the TypeScript source before pressing F5."
    },
    {
        step: 7,
        title: "Lint the code",
        command: "yarn run lint",
        notes: "Run this before submitting a PR. Warnings from eslint appear in the Errors and Warnings pane. Install the VS Code eslint extension for real-time feedback."
    },
    {
        step: 8,
        title: "Do NOT commit .npmrc or yarn.lock changes",
        notes: "Changes to .npmrc and yarn.lock from using the public npm registry must not be pushed. These files are configured for the project's Azure Artifacts feed."
    }
];
