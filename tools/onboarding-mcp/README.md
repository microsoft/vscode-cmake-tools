# CMake Tools Onboarding MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that helps new contributors onboard to the [vscode-cmake-tools](https://github.com/microsoft/vscode-cmake-tools) extension. It provides Copilot agent mode with structured, repo-specific knowledge about setup, code structure, and PR requirements.

## Install and build

```bash
cd tools/onboarding-mcp
yarn install
yarn build
```

## Wire it up in VS Code

Create (or add to) **`.vscode/mcp.json`** at the workspace root:

```json
{
    "servers": {
        "cmake-tools-onboarding": {
            "type": "stdio",
            "command": "node",
            "args": ["${workspaceFolder}/tools/onboarding-mcp/dist/index.js"],
            "env": {
                "GITHUB_TOKEN": "${env:GITHUB_TOKEN}"
            }
        }
    }
}
```

The `GITHUB_TOKEN` env var is **optional** but recommended. Without it, GitHub API calls are limited to 60 requests/hour. With a token, the limit is 5,000/hour. You can create a personal access token at https://github.com/settings/tokens — no scopes are needed for public repos.

Once configured, the MCP server is available to Copilot agent mode (and any other MCP client) in VS Code.

## Usage

The MCP server works **inside GitHub Copilot Chat** in VS Code. After building and wiring it up (see [above](#wire-it-up-in-vs-code)), just open Copilot Chat and go:

```bash
cd tools/onboarding-mcp
yarn install
yarn build
```

Then open a **Copilot Chat** panel (press `Ctrl+Shift+I` or click the Copilot icon in the sidebar) and switch to **Agent mode** (the dropdown at the top of the chat panel). VS Code may show a notification asking you to start the MCP server — click **Start**.

Once it's running, just ask questions in natural language. Copilot will automatically call the right tools. Here are some things you can try:

### Getting started
- *"How do I set up this repo for local development?"*
- *"Walk me through building and running the extension."*

### Understanding the codebase
- *"What is a kit? How is it different from a preset?"*
- *"Explain how the CMake driver works."*
- *"Where is the code that handles CTest?"*
- *"Which source file should I look at for build logic?"*

### Finding documentation
- *"Show me the docs page about CMake Presets."*
- *"Where can I find troubleshooting info?"*

### Exploring issues to work on
- *"What are some good issues for a new contributor?"*
- *"Show me recent open issues labeled 'enhancement'."*

### Understanding recent activity
- *"What areas of the codebase have changed recently?"*
- *"Show me the last 5 commits to main."*

### Preparing a PR
- *"I changed the preset loading logic and added a new setting. Is my PR ready?"*
- *"What do I need to check before submitting a PR?"*

> **Tip:** You don't need to name the tools or remember their inputs. Just describe what you need and Copilot will figure out which tool to call.

## Development

```bash
# Run the server in dev mode (uses tsx, no build step needed):
yarn dev

# Build for production:
yarn build

# Run the production build:
yarn start
```

## Available tools

| Tool | Input | Description |
| --- | --- | --- |
| **`get_setup_guide`** | _(none)_ | Returns an ordered list of setup steps for new contributors to build and run the extension locally. Each step includes a number, title, optional shell command, and optional notes. |
| **`check_pr_readiness`** | `{ "changes": "..." }` | Given a free-text description of changes, returns a checklist of PR requirements from CONTRIBUTING.md. Each item includes the rule, a status (`"pass"`, `"warn"`, or `"manual_check_required"`), and a helpful hint. Items are flagged as `"warn"` when the description suggests a potential issue (e.g. mentioning `package.json` changes). |
| **`explain_concept`** | `{ "concept": "..." }` | Explains a CMake Tools concept (e.g. `kit`, `preset`, `driver`, `ctest`, `build`, `configure`, `debug`, `settings`). Returns a summary, detailed explanation, related concepts, relevant source files, and a link to the docs page. If the concept is unknown, lists all known concepts. |
| **`find_source_file`** | `{ "feature": "..." }` | Given a natural-language description (e.g. `"kit scanning"`, `"build logic"`, `"test runner"`), returns matching source files with GitHub links, descriptions, and relevance notes. Useful for quickly navigating to the right file. |
| **`get_docs_page`** | `{ "topic": "..." }` | Given a topic (e.g. `presets`, `kits`, `debugging`, `troubleshooting`, `faq`), returns the matching documentation page with file path, GitHub URL, summary, and key section headings. |
| **`get_contributor_issues`** | `{ "limit?": 20, "label?": "..." }` | Fetches recently updated open issues and enriches each with contributor-friendliness signals. Optionally filter by label (e.g. `"bug"`, `"enhancement"`, `"good first issue"`, `"help wanted"`). Requires a network connection; set `GITHUB_TOKEN` for higher rate limits (see [above](#wire-it-up-in-vs-code)). |
| **`get_recent_changes`** | `{ "limit?": 10 }` | Fetches the most recent commits to main and annotates each with `affectedAreas` derived from the codebase source map. Includes a summary of the most active areas so new contributors can see what's currently in flux. |
