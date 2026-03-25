# CMake Tools Onboarding MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that helps new contributors onboard to the [vscode-cmake-tools](https://github.com/microsoft/vscode-cmake-tools) extension. It provides Copilot agent mode with structured, repo-specific knowledge about setup, code structure, and PR requirements.

## Install and build

```bash
cd tools/onboarding-mcp
npm install   # or: yarn install
npm run build # or: yarn build
```

## Wire it up in VS Code

Add the following to your **`.vscode/mcp.json`** at the workspace root:

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

The `GITHUB_TOKEN` env var is **optional** but recommended. Without it, GitHub API calls (used by Phase 3 tools) are limited to 60 requests/hour. With a token, the limit is 5,000/hour. You can create a personal access token at https://github.com/settings/tokens — no scopes are needed for public repos.

Once configured, the MCP server is available to Copilot agent mode (and any other MCP client) in VS Code.

## Development

```bash
# Run the server in dev mode (uses tsx, no build step needed):
npm run dev

# Build for production:
npm run build

# Run the production build:
npm start
```

## Available tools

### Phase 1 — Setup & PR

| Tool | Input | Description |
| --- | --- | --- |
| **`get_setup_guide`** | _(none)_ | Returns an ordered list of setup steps for new contributors to build and run the extension locally. Each step includes a number, title, optional shell command, and optional notes. |
| **`check_pr_readiness`** | `{ "changes": "..." }` | Given a free-text description of changes, returns a checklist of PR requirements from CONTRIBUTING.md. Each item includes the rule, a status (`"pass"`, `"warn"`, or `"manual_check_required"`), and a helpful hint. Items are flagged as `"warn"` when the description suggests a potential issue (e.g. mentioning `package.json` changes). |

### Phase 2 — Codebase Knowledge

| Tool | Input | Description |
| --- | --- | --- |
| **`explain_concept`** | `{ "concept": "..." }` | Explains a CMake Tools concept (e.g. `kit`, `preset`, `driver`, `ctest`, `build`, `configure`, `debug`, `settings`). Returns a summary, detailed explanation, related concepts, relevant source files, and a link to the docs page. If the concept is unknown, lists all known concepts. |
| **`find_source_file`** | `{ "feature": "..." }` | Given a natural-language description (e.g. `"kit scanning"`, `"build logic"`, `"test runner"`), returns matching source files with GitHub links, descriptions, and relevance notes. Useful for quickly navigating to the right file. |
| **`get_docs_page`** | `{ "topic": "..." }` | Given a topic (e.g. `presets`, `kits`, `debugging`, `troubleshooting`, `faq`), returns the matching documentation page with file path, GitHub URL, summary, and key section headings. |

### Phase 3 — Live GitHub Data

These tools make real GitHub API calls. They work without authentication (60 req/hr) but setting `GITHUB_TOKEN` raises the limit to 5,000 req/hr (see [Wire it up in VS Code](#wire-it-up-in-vs-code) above).

| Tool | Input | Description |
| --- | --- | --- |
| **`get_contributor_issues`** | `{ "limit?": 20, "label?": "..." }` | Fetches recently updated open issues and enriches each with contributor-friendliness signals (`hasGoodFirstIssueLabel`, `isRecentlyUpdated`, `hasLowCommentCount`, `hasNoBugLabel`). Optionally filter by label (e.g. `"bug"`, `"enhancement"`, `"good first issue"`, `"help wanted"`). Intentionally does **not** default to `"good first issue"` filtering because that label is sparsely used — Copilot should reason over the full issue list instead. |
| **`get_recent_changes`** | `{ "limit?": 10 }` | Fetches the most recent commits to main and annotates each with `affectedAreas` (derived from commit message keywords matched against the codebase source map). Includes a summary of the most active areas so new contributors can see what's currently in flux. |
