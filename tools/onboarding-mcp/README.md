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
            "args": ["${workspaceFolder}/tools/onboarding-mcp/dist/index.js"]
        }
    }
}
```

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
