const GITHUB_BASE = "https://github.com/microsoft/vscode-cmake-tools/blob/main";

export interface ConceptEntry {
    concept: string;
    aliases: string[];
    summary: string;
    details: string;
    relatedConcepts: string[];
    sourceFiles: string[];
    docsPage: string;
    docsUrl: string;
}

export const concepts: ConceptEntry[] = [
    {
        concept: "kit",
        aliases: ["kits", "compiler kit", "toolchain kit"],
        summary:
            "A kit describes the compiler toolchain used to build a CMake project — the compiler, target architecture, and optional toolchain file. " +
            "Kits are scanned automatically or defined manually.",
        details:
            "Kits are the legacy (non-presets) way of telling CMake Tools which compiler to use. " +
            "On Windows, MSVC kits require the VS Developer Environment (vcvarsall.bat) to be merged into the build environment. " +
            "Kits are stored in a user-local cmake-kits.json file or a project-local .vscode/cmake-kits.json. " +
            "The extension can auto-scan for available compilers via the 'CMake: Scan for Kits' command. " +
            "If the project uses CMakePresets.json, kits are not used — presets take priority.",
        relatedConcepts: ["variant", "preset", "configure", "intellisense"],
        sourceFiles: ["src/kits/kit.ts", "src/kits/kitsController.ts"],
        docsPage: "docs/kits.md",
        docsUrl: `${GITHUB_BASE}/docs/kits.md`
    },
    {
        concept: "variant",
        aliases: ["variants", "build variant", "cmake-variants.yaml"],
        summary:
            "Variants let you define a matrix of build configurations (e.g. Debug/Release + shared/static). " +
            "They are defined in a cmake-variants.yaml file and are an alternative to CMake Presets for simpler projects.",
        details:
            "Variants are the legacy way (before CMake Presets) of selecting build type and other CMAKE_* cache variables. " +
            "A cmake-variants.yaml (or .json) file in the project or .vscode folder defines named settings with choices. " +
            "The user picks a combination via the status bar. Variants are not used when CMakePresets.json is present. " +
            "The variant schema supports buildType, linkage, and arbitrary CMake cache variables.",
        relatedConcepts: ["kit", "preset", "configure", "build"],
        sourceFiles: ["src/kits/variant.ts"],
        docsPage: "docs/variants.md",
        docsUrl: `${GITHUB_BASE}/docs/variants.md`
    },
    {
        concept: "preset",
        aliases: ["presets", "cmake preset", "cmakepresets", "cmakepresets.json", "cmake presets"],
        summary:
            "CMake Presets (CMakePresets.json) are the modern, standardized way to define configure, build, and test settings. " +
            "The extension supports CMakePresets.json and CMakeUserPresets.json, including inheritance and environment variables.",
        details:
            "CMakePresets.json is project-owned (committed to source control). CMakeUserPresets.json is user-owned (gitignored). " +
            "Both support 'include' chaining. The merged preset tree lives in PresetsController — never re-parse preset files directly. " +
            "Preset types include configure, build, test, package, and workflow presets. " +
            "When presets are enabled, kits and variants are ignored. " +
            "The extension detects the presets file version and validates against the appropriate JSON schema.",
        relatedConcepts: ["kit", "variant", "configure", "build", "ctest"],
        sourceFiles: ["src/presets/preset.ts", "src/presets/presetsController.ts", "src/presets/presetsParser.ts"],
        docsPage: "docs/cmake-presets.md",
        docsUrl: `${GITHUB_BASE}/docs/cmake-presets.md`
    },
    {
        concept: "driver",
        aliases: ["drivers", "cmake driver", "cmake process"],
        summary:
            "A driver is the internal abstraction that communicates with the CMake process. " +
            "There are two drivers: the CMake File API driver (modern, default) and the legacy server driver.",
        details:
            "The abstract base class CMakeDriver in src/drivers/cmakeDriver.ts defines the interface for configure, build, and target queries. " +
            "The File API driver (cmakeFileApiDriver.ts) writes query files and reads reply files from .cmake/api/v1/ — this is the modern default. " +
            "The legacy server driver (cmakeServerDriver.ts) uses the deprecated cmake-server protocol. " +
            "Most contributors only need to modify cmakeDriver.ts (shared logic) or cmakeFileApiDriver.ts. " +
            "The driver produces a CodeModelContent (defined in codeModel.ts) after configure — the authoritative source for targets and file groups.",
        relatedConcepts: ["configure", "build", "ctest", "extension"],
        sourceFiles: [
            "src/drivers/cmakeDriver.ts",
            "src/drivers/cmakeFileApiDriver.ts",
            "src/drivers/cmakeLegacyDriver.ts",
            "src/drivers/drivers.ts"
        ],
        docsPage: "docs/configure.md",
        docsUrl: `${GITHUB_BASE}/docs/configure.md`
    },
    {
        concept: "ctest",
        aliases: ["test", "tests", "test runner", "test explorer"],
        summary:
            "CTest is CMake's test runner. The extension integrates CTest results into the VS Code Test Explorer, " +
            "allowing you to run, debug, and view test results directly in the editor.",
        details:
            "src/ctest.ts is one of the largest files in the repo. It parses CTest output, maps tests to the VS Code Test Explorer API, " +
            "and supports test filtering, re-running failed tests, and debugging individual tests. " +
            "Test presets (in CMakePresets.json) or the cmake.ctest.* settings control CTest behavior. " +
            "The CTest driver is separate from the build driver — it has its own preset type and execution logic.",
        relatedConcepts: ["preset", "configure", "build", "debug"],
        sourceFiles: ["src/ctest.ts"],
        docsPage: "docs/debug-launch.md",
        docsUrl: `${GITHUB_BASE}/docs/debug-launch.md`
    },
    {
        concept: "configure",
        aliases: ["configuration", "cmake configure", "configure step"],
        summary:
            "The configure step runs cmake to generate build files. It is triggered automatically on first open or manually via commands. " +
            "Configuration state is tracked in src/cmakeProject.ts.",
        details:
            "Configuring runs the CMake command with the appropriate generator, toolchain, and cache variables. " +
            "In kit/variant mode, CMAKE_BUILD_TYPE is set at configure time for single-config generators. " +
            "In presets mode, the configure preset defines all these settings. " +
            "A 'clean configure' deletes the build directory and re-runs CMake from scratch. " +
            "The configure step also supports the CMake Debugger, which lets you step through CMakeLists.txt line by line. " +
            "After configure, the driver reads the code model to learn about targets and source files.",
        relatedConcepts: ["build", "driver", "preset", "kit", "variant"],
        sourceFiles: ["src/cmakeProject.ts", "src/drivers/cmakeDriver.ts"],
        docsPage: "docs/configure.md",
        docsUrl: `${GITHUB_BASE}/docs/configure.md`
    },
    {
        concept: "build",
        aliases: ["compile", "build step", "cmake build"],
        summary:
            "The build step compiles the project using the selected kit/preset. " +
            "The build runner is in src/cmakeBuildRunner.ts; the full project orchestration is in src/cmakeProject.ts.",
        details:
            "Building invokes cmake --build with the correct build directory and configuration. " +
            "For multi-config generators (Visual Studio, Ninja Multi-Config), the --config flag selects the build type at build time. " +
            "For single-config generators (Ninja, Unix Makefiles), the build type was already set during configure. " +
            "The build runner streams output to the terminal and parses diagnostics (errors/warnings) per compiler family — " +
            "see src/diagnostics/ for GCC, MSVC, GHS, IAR, and other parsers. " +
            "Build tasks can also be defined in tasks.json via the CMake task provider.",
        relatedConcepts: ["configure", "driver", "task", "preset", "kit"],
        sourceFiles: ["src/cmakeBuildRunner.ts", "src/cmakeProject.ts"],
        docsPage: "docs/build.md",
        docsUrl: `${GITHUB_BASE}/docs/build.md`
    },
    {
        concept: "task",
        aliases: ["tasks", "vscode task", "cmake task", "task provider"],
        summary:
            "CMake Tools exposes VS Code tasks (configure, build, test, etc.) via src/cmakeTaskProvider.ts. " +
            "Tasks allow contributors to wire CMake operations into VS Code's task system and terminal.",
        details:
            "The CMake task provider registers a 'cmake' task type. Users can define custom tasks in tasks.json " +
            "that run configure, build, test, install, clean, or clean-rebuild operations. " +
            "Tasks support the same presets and kit/variant settings as the command palette. " +
            "This file also handles the build and configure task definitions used by the extension internally.",
        relatedConcepts: ["build", "configure", "ctest"],
        sourceFiles: ["src/cmakeTaskProvider.ts"],
        docsPage: "docs/tasks.md",
        docsUrl: `${GITHUB_BASE}/docs/tasks.md`
    },
    {
        concept: "intellisense",
        aliases: ["intellisense", "code completion", "include paths", "compile commands"],
        summary:
            "IntelliSense integration passes compile commands and include paths to the C/C++ extension (ms-vscode.cpptools) " +
            "via src/cpptools.ts. This enables accurate code completion and error squiggles for C/C++ files.",
        details:
            "After a successful configure, the code model contains per-file compiler flags, include paths, and defines. " +
            "src/cpptools.ts implements the CppToolsApi configuration provider interface. " +
            "src/compilationDatabase.ts handles compile_commands.json export for tools that use it. " +
            "If IntelliSense is not working, the most common cause is a failed configure — the code model is only available after a successful configure.",
        relatedConcepts: ["configure", "driver", "cpptools"],
        sourceFiles: ["src/cpptools.ts", "src/compilationDatabase.ts"],
        docsPage: "docs/how-to.md",
        docsUrl: `${GITHUB_BASE}/docs/how-to.md`
    },
    {
        concept: "cpptools",
        aliases: ["cpptools", "c/c++ extension", "ms-vscode.cpptools"],
        summary:
            "cpptools refers to the IntelliSense integration with the Microsoft C/C++ extension (ms-vscode.cpptools). " +
            "CMake Tools provides compile flags and include paths so that IntelliSense works accurately.",
        details:
            "This is an alias for the 'intellisense' concept. " +
            "src/cpptools.ts implements the CppToolsApi configuration provider. " +
            "The configuration provider is registered once the C/C++ extension API is available. " +
            "Changes here affect how include paths, defines, and compiler flags are reported to IntelliSense.",
        relatedConcepts: ["intellisense", "configure"],
        sourceFiles: ["src/cpptools.ts"],
        docsPage: "docs/how-to.md",
        docsUrl: `${GITHUB_BASE}/docs/how-to.md`
    },
    {
        concept: "debug",
        aliases: ["debugging", "debugger", "launch", "debug target"],
        summary:
            "Debug support allows launching and debugging CMake targets directly from VS Code. " +
            "Launch configuration is handled in src/debug/ and wired into launch.json support.",
        details:
            "CMake Tools supports 'quick debugging' (no launch.json needed) and traditional launch.json-based debugging. " +
            "The user selects a launch target (an executable target from the code model), then runs 'CMake: Debug'. " +
            "The extension also includes a CMake script debugger (for debugging CMakeLists.txt itself) in src/debug/cmakeDebugger/. " +
            "For C/C++ debugging, the extension delegates to the cpptools debugger (cppdbg) or lldb-dap. " +
            "CTest tests can also be debugged individually from the Test Explorer.",
        relatedConcepts: ["build", "ctest", "configure", "extension"],
        sourceFiles: ["src/debug/debugger.ts", "src/debug/cmakeDebugger/debugConfigurationProvider.ts"],
        docsPage: "docs/debug-launch.md",
        docsUrl: `${GITHUB_BASE}/docs/debug-launch.md`
    },
    {
        concept: "extension",
        aliases: ["entry point", "extension.ts", "activation"],
        summary:
            "The extension entry point is src/extension.ts. It registers all commands, initializes the project controller, " +
            "and wires together the UI, kits, presets, and driver subsystems.",
        details:
            "src/extension.ts is one of the largest files in the repo. It contains the ExtensionManager class which is the true singleton of the extension. " +
            "It acts as glue between the lower layers (drivers, kits, presets) and the VS Code UX (commands, status bar, tree views). " +
            "New contributors should read this file last — start with the subsystem relevant to your change. " +
            "The project controller (src/projectController.ts) manages multi-folder workspaces and routes commands to the correct CMakeProject instance.",
        relatedConcepts: ["driver", "kit", "preset", "settings"],
        sourceFiles: ["src/extension.ts", "src/projectController.ts"],
        docsPage: "docs/README.md",
        docsUrl: `${GITHUB_BASE}/docs/README.md`
    },
    {
        concept: "settings",
        aliases: ["config", "configuration settings", "cmake settings", "cmake-tools settings"],
        summary:
            "All user-facing extension settings are typed and read in src/config.ts. " +
            "If you're adding a new setting, this is the file to modify alongside package.json.",
        details:
            "ConfigurationReader in src/config.ts is the canonical access point for all extension settings — " +
            "never call vscode.workspace.getConfiguration() directly. " +
            "When adding a new setting, you must update three locations: package.json (contributes.configuration), " +
            "src/config.ts (ConfigurationReader), and docs/cmake-settings.md. " +
            "Settings support variable substitution (${workspaceFolder}, etc.) via src/expand.ts.",
        relatedConcepts: ["extension", "preset", "kit", "variant"],
        sourceFiles: ["src/config.ts"],
        docsPage: "docs/cmake-settings.md",
        docsUrl: `${GITHUB_BASE}/docs/cmake-settings.md`
    },
    {
        concept: "cpack",
        aliases: ["cpack", "packaging", "cmake package"],
        summary:
            "CPack is CMake's packaging tool. The extension integrates CPack to create distributable packages " +
            "from built targets, with support for package presets.",
        details:
            "src/cpack.ts contains the CPack driver which runs cpack with the appropriate configuration. " +
            "Package presets in CMakePresets.json control CPack behavior when in presets mode. " +
            "CPack is invoked after a successful build to generate installers, archives, or other distributable formats.",
        relatedConcepts: ["build", "preset", "configure"],
        sourceFiles: ["src/cpack.ts"],
        docsPage: "docs/cmake-presets.md",
        docsUrl: `${GITHUB_BASE}/docs/cmake-presets.md`
    },
    {
        concept: "workflow",
        aliases: ["workflow", "workflow preset"],
        summary:
            "Workflow presets chain configure, build, test, and package steps into a single automated sequence. " +
            "They are defined in CMakePresets.json and executed via the 'CMake: Workflow' command.",
        details:
            "src/workflow.ts contains the workflow driver. A workflow preset references other presets in order " +
            "(configure → build → test → package). This lets teams define end-to-end CI-like flows that contributors " +
            "can run locally with a single command.",
        relatedConcepts: ["preset", "configure", "build", "ctest", "cpack"],
        sourceFiles: ["src/workflow.ts"],
        docsPage: "docs/cmake-presets.md",
        docsUrl: `${GITHUB_BASE}/docs/cmake-presets.md`
    }
];

/** Get all known concept names for listing in error messages */
export function knownConceptNames(): string[] {
    return concepts.map((c) => c.concept);
}

/** Find a concept by name or alias (case-insensitive) */
export function findConcept(name: string): ConceptEntry | undefined {
    const lower = name.toLowerCase().trim();
    return concepts.find(
        (c) =>
            c.concept === lower ||
            c.aliases.some((a) => a.toLowerCase() === lower)
    );
}
