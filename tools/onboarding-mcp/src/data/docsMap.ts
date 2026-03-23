const GITHUB_BASE = "https://github.com/microsoft/vscode-cmake-tools/blob/main";

export interface DocsEntry {
    keywords: string[];
    file: string;
    githubUrl: string;
    summary: string;
    keyHeadings: string[];
}

function doc(
    keywords: string[],
    file: string,
    summary: string,
    keyHeadings: string[]
): DocsEntry {
    return {
        keywords,
        file,
        githubUrl: `${GITHUB_BASE}/${file}`,
        summary,
        keyHeadings
    };
}

export const docsMap: DocsEntry[] = [
    doc(
        ["kit", "kits", "compiler", "toolchain"],
        "docs/kits.md",
        "Documents how kits are found, defined, and configured — including user-local kits, project kits, and scan behavior.",
        ["How kits are found and defined", "Kit options", "Specify a compiler", "Specify a toolchain", "Visual Studio"]
    ),
    doc(
        ["variant", "variants", "build type", "debug release", "cmake-variants"],
        "docs/variants.md",
        "Documents the cmake-variants.yaml schema and how variants apply build configurations like Debug/Release and shared/static linkage.",
        ["Example YAML variants file", "Variant schema", "Variant settings", "Variant options", "How variants are applied"]
    ),
    doc(
        ["preset", "presets", "cmakepresets", "cmake presets"],
        "docs/cmake-presets.md",
        "Full reference for CMakePresets.json support including configure, build, test, package, and workflow presets.",
        [
            "Configure and build with CMake Presets",
            "Supported CMake and CMakePresets.json versions",
            "Enable CMakePresets.json",
            "Configure and build",
            "Add new presets",
            "Edit presets"
        ]
    ),
    doc(
        ["settings", "config", "configuration", "cmake settings", "settings.json"],
        "docs/cmake-settings.md",
        "Reference for all cmake-tools settings in settings.json, including variable substitution and build problem matchers.",
        ["CMake settings", "Variable substitution", "Environment variables", "Command substitution", "Additional build problem matchers"]
    ),
    doc(
        ["configure", "cmake configure", "configuration process"],
        "docs/configure.md",
        "Explains the CMake configure step — how it is triggered, what happens internally, clean configure, and CMake Debugger.",
        ["The CMake Tools configure step", "The configure step outside of CMake Tools", "Clean configure", "Configure with CMake Debugger"]
    ),
    doc(
        ["build", "compile", "cmake build", "build target"],
        "docs/build.md",
        "Explains how to build the default target, a single target, build tasks, build flags, and clean build.",
        ["Build the default target", "Build a single target", "Create a build task", "How CMake Tools builds", "Clean build"]
    ),
    doc(
        ["debug", "debugging", "launch", "debug target", "launch.json"],
        "docs/debug-launch.md",
        "Documents launch targets, quick debugging (no launch.json), launch.json integration for gdb/lldb/msvc, and debugging tests.",
        ["Select a launch target", "Debugging without a launch.json", "Debug using a launch.json file", "Debugging tests", "Run without debugging"]
    ),
    doc(
        ["cmake debug", "cmake script debug", "cmake debugger", "cmakelist debug"],
        "docs/debug.md",
        "Documents debugging CMake scripts themselves (not the built binary) — stepping through CMakeLists.txt.",
        ["Debugging from CMake Tools UI entry points", "Debugging from launch.json", "Example launch.json"]
    ),
    doc(
        ["troubleshoot", "troubleshooting", "error", "problem", "common issues"],
        "docs/troubleshoot.md",
        "Common issues and resolutions, logging levels, log file locations, and how to get help.",
        ["Common Issues and Resolutions", "Increase the logging level", "Check the log file", "Get help"]
    ),
    doc(
        ["faq", "frequently asked", "questions", "help"],
        "docs/faq.md",
        "Frequently asked questions about CMake Tools — getting help, detecting VS Code, learning CMake, and common tasks.",
        ["How can I get help?", "How can I detect when CMake is run from VS Code?", "How do I learn about CMake?", "How do I perform common tasks"]
    ),
    doc(
        ["task", "tasks", "tasks.json", "cmake task"],
        "docs/tasks.md",
        "Documents the VS Code task integration for CMake operations — configure, build, test, install, and clean tasks.",
        ["Configure with CMake Tools tasks", "Build with CMake Tools tasks", "Test with CMake Tools tasks", "Install/Clean/Clean-rebuild with CMake Tools tasks"]
    ),
    doc(
        ["how to", "howto", "getting started", "quick start", "tutorial"],
        "docs/how-to.md",
        "Quick how-to guide for common operations — creating projects, configuring, building, debugging, and IntelliSense setup.",
        ["Create a new project", "Configure a project", "Build a project", "Debug a project", "Set up include paths for C++ IntelliSense"]
    ),
    doc(
        ["options", "cmake options", "visibility", "status bar config"],
        "docs/cmake-options-configuration.md",
        "Documents CMake options visibility configuration — controlling which commands and status bar items are shown.",
        ["Default Settings Json", "Configuring your CMake Status Bar and Project Status View"]
    )
];

/** Get all known topic keywords for listing in error messages */
export function knownTopics(): string[] {
    const topics = new Set<string>();
    for (const entry of docsMap) {
        for (const kw of entry.keywords) {
            topics.add(kw);
        }
    }
    return [...topics].sort();
}

/**
 * Find the best matching docs entry for a topic string.
 * Returns entries sorted by keyword match count (best first).
 */
export function findDocsEntries(topic: string): DocsEntry[] {
    const inputWords = topic
        .toLowerCase()
        .split(/[\s,./\\]+/)
        .filter((w) => w.length > 1);

    const inputPhrase = topic.toLowerCase().trim();

    const scored = docsMap
        .map((entry) => {
            let score = 0;
            for (const keyword of entry.keywords) {
                if (inputPhrase.includes(keyword.toLowerCase())) {
                    score += 2;
                } else {
                    const keywordWords = keyword.toLowerCase().split(/\s+/);
                    for (const kw of keywordWords) {
                        if (inputWords.includes(kw)) {
                            score += 1;
                        }
                    }
                }
            }
            return { entry, score };
        })
        .filter((e) => e.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((e) => e.entry);

    return scored;
}
