const GITHUB_BASE = "https://github.com/microsoft/vscode-cmake-tools/blob/main";

export interface SourceEntry {
    keywords: string[];
    files: Array<{
        path: string;
        githubUrl: string;
        description: string;
    }>;
}

function entry(keywords: string[], files: Array<{ path: string; description: string }>): SourceEntry {
    return {
        keywords,
        files: files.map((f) => ({
            ...f,
            githubUrl: `${GITHUB_BASE}/${f.path}`
        }))
    };
}

export const sourceMap: SourceEntry[] = [
    entry(
        ["kit", "kits", "compiler", "toolchain", "scan", "compiler scan", "kit scan"],
        [
            { path: "src/kits/kit.ts", description: "Kit type definitions, kit scanning, and compiler detection logic." },
            { path: "src/kits/kitsController.ts", description: "Kit controller — manages the active kit, scanning UI, and kit selection." }
        ]
    ),
    entry(
        ["variant", "variants", "debug release", "build type", "cmake-variants"],
        [
            { path: "src/kits/variant.ts", description: "Variant (build matrix) schema parsing and application of build configurations." }
        ]
    ),
    entry(
        ["preset", "presets", "cmakepresets", "cmakepresets.json", "cmake presets", "user preset"],
        [
            { path: "src/presets/preset.ts", description: "CMake Presets type definitions and interfaces for all preset types." },
            { path: "src/presets/presetsController.ts", description: "Presets controller — loading, merging, expanding, and watching preset files." },
            { path: "src/presets/presetsParser.ts", description: "Parser for CMakePresets.json / CMakeUserPresets.json files." }
        ]
    ),
    entry(
        ["driver", "cmake process", "cmake communication", "cmake driver"],
        [
            { path: "src/drivers/cmakeDriver.ts", description: "Abstract base class for CMake drivers — shared configure/build/target logic." },
            { path: "src/drivers/cmakeFileApiDriver.ts", description: "CMake File API driver — the modern default; reads query/reply files." },
            { path: "src/drivers/cmakeLegacyDriver.ts", description: "Legacy CMake driver for older CMake versions." }
        ]
    ),
    entry(
        ["file api", "cmake file api", "query", "reply", "code model"],
        [
            { path: "src/drivers/cmakeFileApi.ts", description: "CMake File API query/reply parsing and code model extraction." },
            { path: "src/drivers/cmakeFileApiDriver.ts", description: "File API driver that writes queries and reads replies from .cmake/api/v1/." },
            { path: "src/drivers/codeModel.ts", description: "CodeModelContent types — the authoritative source for targets and file groups." }
        ]
    ),
    entry(
        ["build", "compile", "build runner", "cmake build", "build output"],
        [
            { path: "src/cmakeBuildRunner.ts", description: "Build-process orchestration, output streaming, and build progress." },
            { path: "src/cmakeProject.ts", description: "Per-folder project state including the full build lifecycle." }
        ]
    ),
    entry(
        ["configure", "configuration", "cmake configure", "generate"],
        [
            { path: "src/cmakeProject.ts", description: "Per-folder project state — orchestrates the configure step." },
            { path: "src/drivers/cmakeDriver.ts", description: "Abstract driver base — runs cmake with the correct arguments for configure." }
        ]
    ),
    entry(
        ["test", "ctest", "test runner", "test explorer", "test results"],
        [
            { path: "src/ctest.ts", description: "CTest integration — parses test output, maps tests to VS Code Test Explorer." }
        ]
    ),
    entry(
        ["task", "tasks", "vscode task", "task provider", "tasks.json"],
        [
            { path: "src/cmakeTaskProvider.ts", description: "VS Code task provider — registers 'cmake' task type for configure/build/test." }
        ]
    ),
    entry(
        ["intellisense", "cpptools", "include path", "compile commands", "code completion"],
        [
            { path: "src/cpptools.ts", description: "CppTools configuration provider — passes compile flags and includes to C/C++ IntelliSense." },
            { path: "src/compilationDatabase.ts", description: "compile_commands.json handling for external tool consumption." }
        ]
    ),
    entry(
        ["debug", "launch", "debugger", "debug target", "launch.json"],
        [
            { path: "src/debug/debugger.ts", description: "Debug/launch orchestration — wires CMake targets to VS Code debug sessions." },
            { path: "src/debug/cmakeDebugger/debugConfigurationProvider.ts", description: "Debug configuration provider for CMake script debugging." }
        ]
    ),
    entry(
        ["extension", "entry point", "activate", "command registration", "extension.ts"],
        [
            { path: "src/extension.ts", description: "Extension activation, command registration, and ExtensionManager singleton." }
        ]
    ),
    entry(
        ["project", "workspace", "multi-root", "multi-folder", "project controller"],
        [
            { path: "src/projectController.ts", description: "Multi-folder workspace management and active-project routing." },
            { path: "src/workspace.ts", description: "Workspace utility functions." }
        ]
    ),
    entry(
        ["setting", "settings", "config", "configuration setting", "cmake setting"],
        [
            { path: "src/config.ts", description: "ConfigurationReader — canonical typed access to all extension settings." }
        ]
    ),
    entry(
        ["status bar", "status", "sidebar", "ui", "project status"],
        [
            { path: "src/status.ts", description: "Status bar items and visibility logic." },
            { path: "src/ui/projectStatus.ts", description: "Project Status sidebar view controller." }
        ]
    ),
    entry(
        ["logging", "log", "output channel", "logger"],
        [
            { path: "src/logging.ts", description: "Logging infrastructure — createLogger() for module-scoped loggers." }
        ]
    ),
    entry(
        ["expand", "variable substitution", "cmake variable", "variable expansion"],
        [
            { path: "src/expand.ts", description: "Variable expansion (${variable}) for both kit-context and preset-context vars." }
        ]
    ),
    entry(
        ["state", "persistent", "workspace state", "extension state"],
        [
            { path: "src/state.ts", description: "Persistent extension state storage across VS Code sessions." }
        ]
    ),
    entry(
        ["cpack", "package", "packaging", "installer"],
        [
            { path: "src/cpack.ts", description: "CPack integration — runs cpack to create distributable packages." }
        ]
    ),
    entry(
        ["coverage", "code coverage", "test coverage"],
        [
            { path: "src/coverage.ts", description: "Code coverage support for CTest results." }
        ]
    ),
    entry(
        ["diagnostics", "error", "warning", "build error", "compiler output", "problem matcher"],
        [
            { path: "src/diagnostics/build.ts", description: "Build diagnostics collection and routing." },
            { path: "src/diagnostics/gcc.ts", description: "GCC/Clang diagnostic output parser." },
            { path: "src/diagnostics/msvc.ts", description: "MSVC diagnostic output parser." },
            { path: "src/diagnostics/cmake.ts", description: "CMake output consumer — parses cmake stdout/stderr." }
        ]
    ),
    entry(
        ["outline", "project outline", "target tree", "tree view"],
        [
            { path: "src/ui/projectOutline/projectOutline.ts", description: "Project Outline tree view — shows targets and source files." },
            { path: "src/ui/projectOutline/targetsViewCodeModel.ts", description: "Code model to tree-view mapping for the project outline." }
        ]
    ),
    entry(
        ["workflow", "workflow preset"],
        [
            { path: "src/workflow.ts", description: "Workflow driver — chains configure/build/test/package presets into one sequence." }
        ]
    ),
    entry(
        ["telemetry", "telemetry event"],
        [
            { path: "src/telemetry.ts", description: "Telemetry helpers — use logEvent() instead of the VS Code telemetry API directly." }
        ]
    ),
    entry(
        ["rollbar", "error boundary", "error handling"],
        [
            { path: "src/rollbar.ts", description: "Top-level error boundaries — rollbar.invokeAsync() wraps event handlers." }
        ]
    )
];

/**
 * Find source entries whose keywords overlap with words in the input string.
 * Returns entries sorted by number of keyword matches (best first).
 */
export function findSourceEntries(feature: string): Array<SourceEntry & { matchCount: number }> {
    const inputWords = feature
        .toLowerCase()
        .split(/[\s,./\\]+/)
        .filter((w) => w.length > 1);

    const inputPhrase = feature.toLowerCase();

    const scored = sourceMap
        .map((entry) => {
            let matchCount = 0;
            for (const keyword of entry.keywords) {
                // Exact phrase match in input (handles multi-word keywords like "file api")
                if (inputPhrase.includes(keyword.toLowerCase())) {
                    matchCount += 2;
                } else {
                    // Single-word keyword overlap
                    const keywordWords = keyword.toLowerCase().split(/\s+/);
                    for (const kw of keywordWords) {
                        if (inputWords.includes(kw)) {
                            matchCount += 1;
                        }
                    }
                }
            }
            return { ...entry, matchCount };
        })
        .filter((e) => e.matchCount > 0)
        .sort((a, b) => b.matchCount - a.matchCount);

    return scored;
}

/**
 * Given a text string (e.g. a commit message), return the area names that match.
 * An "area" is derived from the first keyword of each SourceEntry.
 * Returns deduplicated area names, or ["general"] if nothing matched.
 *
 * Uses stricter matching than the interactive `findSourceEntries`:
 * - Multi-word keywords (e.g. "file api", "cmake driver") match as exact substrings.
 * - Single-word keywords only match if they appear as whole words (word-boundary match)
 *   AND are specific enough (> 4 chars) to avoid false positives from common English words
 *   like "build", "test", "debug" that appear in most commit messages.
 * - File-path-like patterns (e.g. "ctest.ts", "kitsController") are always high-signal.
 */
export function matchAreas(text: string): string[] {
    const lower = text.toLowerCase();

    // Very short common keywords that cause false positives in commit messages.
    // These only match when they appear near a file path or as a standalone technical term.
    const overlyGeneric = new Set([
        "build", "compile", "test", "debug", "launch", "log", "error",
        "warning", "status", "state", "config", "setting", "settings",
        "configure", "configuration", "package", "query", "reply", "ui"
    ]);

    const matched = new Set<string>();
    for (const entry of sourceMap) {
        const areaName = entry.keywords[0];
        let found = false;

        for (const keyword of entry.keywords) {
            const kw = keyword.toLowerCase();

            if (kw.includes(" ")) {
                // Multi-word keyword: exact substring match — high confidence
                if (lower.includes(kw)) {
                    found = true;
                    break;
                }
            } else if (!overlyGeneric.has(kw)) {
                // Specific single-word keyword: word-boundary match
                const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
                if (re.test(lower)) {
                    found = true;
                    break;
                }
            }
            // overlyGeneric single-word keywords are skipped unless they're part
            // of a multi-word keyword that matched above.
        }

        // Also check if any file paths from this entry appear in the text
        if (!found) {
            for (const file of entry.files) {
                const filename = file.path.split("/").pop()?.toLowerCase() ?? "";
                if (filename && lower.includes(filename)) {
                    found = true;
                    break;
                }
            }
        }

        if (found) {
            matched.add(areaName);
        }
    }

    return matched.size > 0 ? [...matched] : ["general"];
}
