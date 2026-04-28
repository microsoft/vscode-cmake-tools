# Configure CMake Tools settings

CMake Tools supports a variety of settings that can be set at the user, or workspace, level via VSCode's `settings.json` file. This topic  covers the available options and how they are used.

Options that support substitution, in the table below, allow variable references to appear in their strings. See [variable substitution](#variable-substitution), below, for more information about variable expansion.

## CMake settings

| Setting  | Description | Default value | Supports substitution |
|---------|---------|---------|-----|
| `cmake.additionalCompilerSearchDirs`| List of paths to search for additional compilers, like a MinGW installation. This means that GCC does not need to be on your `$PATH` for it to be found via kit scanning. For example: `["C:\\MinGW\\bin"]` (Search in C:\MinGW\bin for a MinGW installation) | `[]` | yes |
| `cmake.additionalKits` | Array of paths to custom kit files. These are in addition to the default kit files. | `[]` | no |
| `cmake.allowCommentsInPresetsFile` | Allow the use of JSON extensions such as comments in CMakePresets.json. Please note that your CMakePresets.json file may be considered invalid by other IDEs or on the command line if you use non-standard JSON. | `false` | no |
| `cmake.allowUnsupportedPresetsVersions` | Enables the use of presets files that are using features from the versions that Cmake Tools extension doesn't currently support. Unknown properties and macros will be ignored. | `false` | no |
| `cmake.automaticReconfigure` | Automatically configure CMake project directories when the kit or the configuration preset is changed. | `true` | no |
| `cmake.autoSelectActiveFolder`| If 'false', your active folder only changes if you manually run the `CMake: Select Active Folder` command. | `true` | no |
| `cmake.buildArgs` | An array of additional arguments to pass to `cmake --build`. | `[]` (empty array-no additional arguments) | yes |
| `cmake.buildBeforeRun` | If `true`, build the launch/debug target before running the target. | `true` | no |
| `cmake.buildDirectory` | Specify the build directory (i.e. the root directory where `CMakeCache.txt` will be generated.) | `${workspaceFolder}/build` | yes |
| `cmake.buildEnvironment`| An object containing `key:value` pairs of environment variables, which will be passed only to the compiler. | `null` (no environment variables specified) | yes |
| `cmake.buildTask` | If `true`, generate VS Code tasks for building. | `false` | no |
| `cmake.buildToolArgs` | An array of additional arguments to pass to the underlying build tool. | `[]` (empty array-no additional arguments) | yes |
| `cmake.cacheInit` | Path, or list of paths, to cache-initialization files. Passed to CMake via the `-C` command-line argument. | `[]` (empty array-no cache initializer files) | no |
| `cmake.clearOutputBeforeBuild` | If `true`, clear output before building. | `true` | no |
| `cmake.cmakeCommunicationMode` | Specifies the protocol for communicating between the extension and CMake | `automatic` | no |
| `cmake.cmakePath`| Specify location of the cmake executable. | `cmake` (causes CMake Tools to search the `PATH` environment variable, as well as some hard-coded locations.) | Supports substitution for `workspaceRoot`, `workspaceFolder`, `workspaceRootFolderName`, `userHome`, `${command:...}` and `${env:...}`. Other substitutions result in an empty string. |
| `cmake.configureArgs` | Arguments to CMake that will be passed during the configure process. Prefer to use `cmake.configureSettings` or [CMake variants](variants.md).</br> It is not recommended to pass `-D` arguments using this setting. | `[]` (empty array-no arguments) | yes |
| `cmake.configureEnvironment` | An object containing `key:value` pairs of environment variables, which will be passed to CMake only when configuring.| `null` (no environment variable pairs) | yes |
| `cmake.configureOnEdit` | Automatically configure CMake project directories when the path in the `cmake.sourceDirectory` setting is updated or when `CMakeLists.txt` or `*.cmake` files are saved. | `true` | no |
| `cmake.configureOnOpen` | Automatically configure CMake project directories when they are opened. | `true` | no |
| `cmake.cmakeProviderExtensions` | List of VS Code extension IDs that provide or install their own CMake binary. When CMake is not found during automatic configure-on-open and one of these extensions is installed, CMake Tools will briefly poll for CMake availability instead of showing an immediate error. Set to an empty array to disable this behavior. | `["stmicroelectronics.stm32-vscode-extension", "espressif.esp-idf-extension", "NXPSemiconductors.mcuxpresso", "nordic-semiconductor.nrf-connect"]` | no |
| `cmake.configureSettings` | An object containing `key:value` pairs, which will be passed to CMake when configuring. The same as passing `-DVAR_NAME=ON` via `cmake.configureArgs`. NOTE: Semicolons (`;`) in string values are automatically escaped to prevent CMake from interpreting them as list separators. If you want to pass a CMake list, use array notation instead, e.g. `"MY_LIST": [ "a", "b" ]`. | `{}` (no values) | yes |
| `cmake.copyCompileCommands`| If not `null`, copies the `compile_commands.json` file generated by CMake to the path specified by this setting whenever CMake successfully configures. |  `null` (do not copy the file) | yes |
| `cmake.postConfigureTask`| If not `null`, the task with this name is executed whenever CMake successfully configures. |  `null` (do not run any task) | yes |
| `cmake.coverageInfoFiles` | LCOV coverage info files to be processed after running tests with coverage using the test explorer. | `[]` | yes |
| `cmake.cpackArgs` | An array of additional arguments to pass to cpack. | `[]` | yes |
| `cmake.cpackEnvironment` | An object containing `key:value` pairs of environment variables, which will be available when running cpack. | `{}` | yes |
| `cmake.cpackPath` | Path to cpack executable. | `null` | no |
| `cmake.ctest.allowParallelJobs` | If `true`, allow running test jobs in parallel. When `false`, tests run sequentially in alphabetical order, matching the Test Explorer display order. | `false` | no |
| `cmake.ctest.debugLaunchTarget` | Target to debug during CTest execution. | `null` | no |
| `cmake.ctest.parallelJobs` | Specify the number of jobs to run in parallel for ctest. Using the value `0` will detect and use the number of CPUs. Using the value `1` will disable test parallelism. | `0` | no |
| `cmake.ctest.testExplorerIntegrationEnabled` | If `true`, configure CMake to generate information needed by the test explorer. When `false`, the automatic CTest discovery that runs after each build is also skipped; the post-configure refresh and the manual `cmake.refreshTests` command still run. | `true` | no |
| `cmake.ctest.testSuiteDelimiter` | Character(s) that separate test suite name components. | `null` | no |
| `cmake.ctestArgs` | An array of additional arguments to pass to CTest. | `[]` | yes |
| `cmake.ctestDefaultArgs` | Default arguments to pass to CTest. | `["-T", "test", "--output-on-failure"]` | no |
| `cmake.ctestPath` | Path to CTest executable. | `null` | no |
| `cmake.debugConfig`| The debug configuration to use when debugging a target. When `type` is specified, automatic debugger detection is skipped and a custom debug adapter can be used. Additional properties required by the debug adapter can be added freely. See [Debug and launch](debug-launch.md#customize-the-debug-adapter) for examples, including Natvis via `visualizerFile` without a `launch.json`. | `null` (no values) | yes |
| `cmake.defaultActiveFolder`| The name of active folder, which be used as default (Only works when `cmake.autoSelectActiveFolder` is disabled). | `""` | no |
| `cmake.defaultVariants` | Override the default set of variants that will be supplied when no variants file is present. See [CMake variants](variants.md). | See package.json | no |
| `cmake.deleteBuildDirOnCleanConfigure` | If `true`, delete build directory during clean configure. | `false` | no |
| `cmake.emscriptenSearchDirs` | List of paths to search for Emscripten. | `[]` | no |
| `cmake.enableAutomaticKitScan` | Enable automatic kit scanning. | `true` | no |
| `cmake.removeStaleKitsOnScan` | If `true`, a full **Scan for Kits** run removes compiler-based kits from `cmake-tools-kits.json` when they are no longer rediscovered. This is useful after compiler upgrades that leave older versions installed outside `PATH`. Set `"keep": true` in a kit entry to preserve it. This setting does not affect **Scan recursively for kits in specific directories**. | `false` | no |
| `cmake.enabledOutputParsers` | List of enabled output parsers. | `["cmake", "gcc", "gnuld", "msvc", "ghs", "diab", "iwyu"]` | no |
| `cmake.additionalBuildProblemMatchers` | Array of user-defined problem matchers for build output. Each entry has `name`, `regexp`, and optional capture group indices (`file`, `line`, `column`, `severity`, `message`, `code`). See [Additional Build Problem Matchers](#additional-build-problem-matchers) below. | `[]` | no |
| `cmake.enableLanguageServices` | If `true`, enable CMake language services. | `true` | no |
| `cmake.languageServerOnlyMode` | If `true`, keep CMake language services enabled while disabling CMake project, build, test, and kit integration. | `false` | no |
| `cmake.enableTraceLogging` | If `true`, enable trace logging. | `false` | no |
| `cmake.environment` | An object containing `key:value` pairs of environment variables, which will be available when configuring, building, or testing with CTest. | `{}` (no environment variables) | yes |
| `cmake.exclude` | CMake Tools will ignore the folders defined in this setting. | `[]` | yes |
| `cmake.exportCompileCommandsFile` | If `true`, generate the compile_commands.json file. | `true` | no |
| `cmake.generator` | Set to a string to override CMake Tools preferred generator logic. If set, CMake will unconditionally use it as the `-G` CMake generator command line argument. | `null` | no |
| `cmake.ignoreCMakeListsMissing` | If `true`, do not show error when opening a project without CMakeLists.txt. | `false` | no |
| `cmake.ignoreKitEnv` | If `true`, ignore kit environment variables. | `false` | no |
| `cmake.installPrefix` | If specified, sets a value for `CMAKE_INSTALL_PREFIX` when running CMake configure. If not set, no value will be passed.</br>If `CMAKE_INSTALL_PREFIX` is set via `cmake.configureArgs` or `cmake.configureSettings`, `cmake.installPrefix` will be ignored.| `null` (no value specified) | yes |
| `cmake.launchBehavior` | Behavior when launching a CMake target. | `reuseTerminal` | no |
| `cmake.loadCompileCommands` | Controls whether the extension reads compile_commands.json to enable single file compilation. | `true` | no |
| `cmake.loggingLevel` | A string setting that specifies how much output CMake Tools produces in its output channel. Set to one of `"trace"`, `"debug"`, `"info"`, `"note"`, `"warning"`, `"error"`, or `"fatal"`. `"trace"` is the most verbose.</br></br>Regardless of the logging level, CMake Tools writes all levels of logging to the CMake Tools log file. This file is useful if you need to [troubleshoot CMake Tools](troubleshoot.md) | `"info"` | no |
| `cmake.mergedCompileCommands` | Path where to create a merged compile_commands.json file. | `null` | no |
| `cmake.mingwSearchDirs` | **DEPRECATED**. List of paths to search for MinGW. Use `cmake.additionalCompilerSearchDirs` instead. | `[]` | no |
| `cmake.modifyLists.addNewSourceFiles` | Add source files to CMake lists when they are created. `"no"` disables, `"yes"` applies automatically, `"ask"` shows a preview of proposed changes to apply. | `"ask"` | no |
| `cmake.modifyLists.removeDeletedSourceFiles` | Remove source files from CMake lists when they are deleted. `"no"` disables, `"yes"` applies automatically, `"ask"` shows a preview of proposed changes to apply. | `"ask"` | no |
| `cmake.modifyLists.variableSelection` | How to choose which `set()` or `list(APPEND/PREPEND/INSERT)` command invocation to edit when adding source files to CMake lists. | `"never"` | no |
| `cmake.modifyLists.sourceVariables` | Variables to add source files to. Variables appearing earlier in this list will be given higher priority. Only used if `cmake.modifyLists.variableSelection` is not `"never"`. Supports glob patterns. | `["SRC", "SRCS", "SOURCES", "SOURCE_FILES", "*_SRC", "*_SRCS", "*_SOURCES", "*_SOURCE_FILES"]` | no |
| `cmake.modifyLists.targetSelection` | How to choose which target to add new source files to when adding source files to CMake lists. | `"askParentSourceDirs"` | no |
| `cmake.modifyLists.targetCommandInvocationSelection` | How to choose which of a target's source command invocations to edit when adding source files to CMake lists. | `"askParentDirs"` | no |
| `cmake.modifyLists.targetSourceCommands` | Commands to treat as target source commands when adding source files to CMake lists. Commands appearing earlier in this list will be given higher priority. Supports glob patterns. | `["target_sources", "add_executable", "add_library"]` | no |
| `cmake.modifyLists.scopeSelection` | How to choose which of a target's visibility scopes, file sets, or source keyword parameters to edit when adding source files to CMake lists. | `"ask"` | no |
| `cmake.modifyLists.sourceListKeywords` | Keyword arguments to user-defined functions and macros which introduce lists of source files. If left empty, all arguments consisting of only upper-case letters and underscores will be considered. Supports glob patterns. | `[]` | no |
| `cmake.options.advanced` | Advanced options for CMake Tools. | See package.json | no |
| `cmake.options.statusBarVisibility` | Controls visibility of the status bar. | `hidden` | no |
| `cmake.outputLogEncoding` | Encoding to use for tool output. | `auto` | no |
| `cmake.outlineViewType` | Project Outline View`s type. | `["list", "tree"]` | no |
| `cmake.parallelJobs` | Specify the number of jobs run in parallel during the build. Using the value `0` will detect and use the number of CPUs. Using the value `1` will disable build parallelism. | `0` | no |
| `cmake.parseBuildDiagnostics` | If `true`, parse compiler output for diagnostics. | `true` | no |
| `cmake.pinnedCommands` | List of commands pinned to the command palette. | `["workbench.action.tasks.configureTaskRunner", "workbench.action.tasks.runTask"]` | no |
| `cmake.platform` | CMake platform to use. | `null` | no |
| `cmake.postRunCoverageTarget` | Target to build after running tests with coverage using the test explorer. | `null` | no |
| `cmake.preferredGenerators` | A list of strings of generator names to try, in order, when configuring a CMake project for the first time. | `[]` | no |
| `cmake.preRunCoverageTarget` | Target to build before running tests with coverage using the test explorer. | `null` | no |
| `cmake.revealLog` | Controls when the CMake output log should be revealed. Possible values: `focus` (show the log and move focus to the output channel), `always` (show the log but do not move focus), `never` (do not show the log), `error` (show the log only when an error occurs). | `always` | no |
| `cmake.saveBeforeBuild` | If `true` (the default), saves open text documents when build or configure is invoked before running CMake. | `true` | no |
| `cmake.setBuildTargetSameAsLaunchTarget` | If `true`, setting the launch/debug target automatically sets the build target to match. | `false` | no |
| `cmake.setBuildTypeOnMultiConfig` | If `true`, set build type on multi-config generators. | `false` | no |
| `cmake.shell` | Path to a shell executable to route all CMake/CTest/CPack subprocess invocations through (e.g., Git Bash or MSYS2). Useful for embedded toolchains that require POSIX path translation on Windows. When `null`, the default system shell behavior is used. | `null` | no |
| `cmake.showConfigureWithDebuggerNotification` | If `true`, show notification when configure with debugger. | `true` | no |
| `cmake.showNotAllDocumentsSavedQuestion` | If `true`, show not all documents saved question. | `true` | no |
| `cmake.showSystemKits` | If `true`, show system kits in kit selection. | `true` | no |
| `cmake.skipConfigureIfCachePresent` | If `true`, skip configure if CMake cache is present. | `null` | no |
| `cmake.sourceDirectory` | A directory or a list of directories where the root `CMakeLists.txt`s are stored. | `${workspaceFolder}` | yes |
| `cmake.testEnvironment` | An object containing `key:value` pairs of environment variables, which will be available when debugging, running and testing with CTest. | `{}` (no environment variables) | yes |
| `cmake.toolset` | CMake toolset to use. | `null` | no |
| `cmake.touchbar.advanced` | Advanced options for touchbar. | See package.json | no |
| `cmake.touchbar.visibility` | Controls visibility of the touchbar. | `default` | no |
| `cmake.useCMakePresets` | Controls when to use CMake presets. | `auto` | no |
| `cmake.useVsDeveloperEnvironment` | Controls when to use Visual Studio Developer Environment for building. | `auto` | no |

## Variable substitution

Some settings support the replacement of special values in their string value by using a `${variable}` syntax.

### Where substitution works

Use this quick rule to avoid confusion:

- CMake Tools `${...}` variables in this section (for example `${buildKit}` and `${generator}`) are expanded only when CMake Tools reads supported `cmake.*` settings from `settings.json`.
- Generic VS Code `tasks.json` and `launch.json` fields are resolved by VS Code, not by CMake Tools. In those fields, use VS Code variables (for example `${workspaceFolder}`) or command substitutions such as `${command:cmake.buildKit}`.
- `${config:cmake.*}` in `tasks.json`/`launch.json` returns the raw setting value. It does not apply a second CMake Tools substitution pass.

Example:

- In a shell task command, `${buildKit}` and `${generator}` are not expanded.
- In a shell task command, `${command:cmake.buildKit}` is expanded.

The following built-in variables are expanded in supported `cmake.*` settings only. None of these are expanded in generic VS Code shell or process task commands. Use the `${command:cmake.*}` forms listed under [Command substitution](#command-substitution) for those contexts.

| Variable | Expansion |
|---------|---------|
|`${workspaceRoot}`|**DEPRECATED**. The full path to the workspace root directory.|
|`${workspaceFolder}` | The full path to the workspace root directory. |
|`${sourceDirectory}` | The full path to the root CMakeLists.txt. (not substituted for `cmake.sourceDirectory`, `cmake.cmakePath`, `cmake.ctestPath`, or in Kits) |
|`${workspaceRootFolderName}`| The name of the leaf directory in the workspace directory path.|
|`${buildType}`|The current CMake build type. For example: `Debug`, `Release`, `MinSizeRel`, `RelWithDebInfo`|
|`${buildKit}`| The current CMake kit full name. For example: `GCC 7.3.0`|
|`${buildKitVendor}`| The current CMake kit vendor name. Possible values: `GCC`, `MSVC`, `Clang` and so on|
|`${buildKitTriple}`| The current CMake kit target triple. For example: `arm-none-eabi`|
|`${buildKitVersion}`| The current CMake kit version. For example: `9.3.0`|
|`${buildKitHostOs}`| The current CMake kit host OS. Possible values: `win32`, `osx`, `linux` and so on, all in lowercase|
|`${buildKitTargetOs}`| The current CMake kit target OS. Possible values: `win32`, `osx`, `linux` and so on, all in lowercase|
|`${buildKitTargetArch}`| The current CMake kit target architecture. Possible values: `x86`, `x64`, `arm`, `aarch64` and so on, all in lowercase|
|`${buildKitVersionMajor}`| The current CMake kit major version. For example: `7`|
|`${buildKitVersionMinor}`| The current CMake kit minor version. For example: `3`|
|`${generator}`| The name of the CMake generator. For example: `Ninja`|
|`${projectName}`|**DEPRECATED**. Expands to the constant string `"ProjectName"` CMake does not consider there to be just one project name to use. The concept of a single project does not work in CMake. Use `${workspaceRootFolderName}`, instead.|
|`${userHome}`|  The full path to the current user's home directory. |

### Environment variables

Environment variables are expanded using the `${env:VARNAME}` and `${env.VARNAME}` syntax, where `VARNAME` is the environment to variable to expand. If the named environment variable is undefined, the expansion is an empty string.

### Variant substitution

Variant options are expanded using the `${variant:VARIANTNAME}` syntax, where the name of the currently active choice of the provided `VARIANTNAME` variant option is expanded. If the variant option is undefined, the expansion is an empty string.

### Command substitution

CMake Tools can expand VS Code commands. For example, you can expand the path to the launch target by using the syntax `${command:cmake.launchTargetPath}`.

This form is the recommended way to get CMake Tools values in generic `tasks.json` or `launch.json` fields.

Be careful with long-running commands because it isn't specified when, or how many times, CMake Tools will execute a command for a given expansion.

Supported commands for substitution:

|command|substitution|
|-------|------------|
|`cmake.getLaunchTargetPath`|The full path to the target executable, including the filename. The existence of the target is not validated.|
|`cmake.getLaunchTargetDirectory`|The full path to the target executable's directory. The existence of the directory is not validated.|
|`cmake.getLaunchTargetFilename`|The name of the target executable file without any path information. The existence of the target is not validated.|
|`cmake.getLaunchTargetName`|The name to the target. The existence of the target is not validated.|
|`cmake.launchTargetPath`|The full path to the target executable, including the filename. If `cmake.buildBeforeRun` is true, invoking this substitution will also start a build.|
|`cmake.launchTargetDirectory`|The full path to the target executable's directory. If `cmake.buildBeforeRun` is true, invoking this substitution will also start a build.|
|`cmake.launchTargetFilename`|The name of the target executable file without any path information. If `cmake.buildBeforeRun` is true, invoking this substitution will also start a build.|
|`cmake.launchTargetName`|The name of the target. If `cmake.buildBeforeRun` is true, invoking this substitution will also start a build.|
|`cmake.buildTargetName`|The current target selected for build.|
|`cmake.buildType`|Same as `${buildType}`. The current CMake build type.|
|`cmake.buildKit`|Same as `${buildKit}`. The current CMake kit name.|
|`cmake.buildDirectory`|The full path to the directory where CMake cache files are located.|
|`cmake.tasksBuildCommand`|The CMake command used to build your project based on the currently selected Kit + Variant + Target. Suitable for use within `tasks.json`.|
|`cmake.activeFolderName`|The name of the active folder (e.g. in a multi-root workspace)|
|`cmake.activeFolderPath`|The absolute path of the active folder (e.g. in a multi-root workspace)|
|`cmake.activeConfigurePresetName`|The name of the active configure preset.|
|`cmake.activeBuildPresetName`|The name of the active build preset.|
|`cmake.activeTestPresetName`|The name of the active test preset.|

### Test debug placeholders

The following placeholders are available in launch.json debug configurations used to debug CTest tests from the Test Explorer. See [Debugging tests](debug-launch.md#debugging-tests) for full examples.

|Placeholder|Expansion|
|-----------|---------|
|`${cmake.testProgram}`|The full path to the test executable.|
|`${cmake.testArgs}`|The command-line arguments for the test.|
|`${cmake.testWorkingDirectory}`|The working directory for the test.|
|`${cmake.testEnvironment}`|The environment variables set via the CTest `ENVIRONMENT` test property (e.g., from `set_tests_properties(... PROPERTIES ENVIRONMENT "A=B;C=D")`). Replaced with an array of `{ "name": "...", "value": "..." }` objects suitable for launch.json.|

## Additional build problem matchers

The `cmake.additionalBuildProblemMatchers` setting lets you define custom problem matchers that are applied to build output. This is useful when you integrate tools like **clang-tidy**, **PCLint Plus**, **cppcheck**, or custom scripts into your CMake build via `add_custom_command` or `add_custom_target`. Diagnostics from these tools will appear in the VS Code **Problems** pane alongside the standard compiler errors.

Custom matchers run **after** the built-in parsers (`gcc`, `msvc`, `gnuld`, etc.), so they will not interfere with standard compiler diagnostics.

Each matcher entry has the following properties:

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `name` | string | **yes** | — | Friendly name shown as the diagnostic source in the Problems pane. |
| `regexp` | string | **yes** | — | Regular expression applied to each build output line. |
| `file` | integer | no | `1` | Capture group index for the file path. |
| `line` | integer | no | `2` | Capture group index for the line number. |
| `column` | integer | no | — | Capture group index for the column number. |
| `severity` | integer or string | no | `"warning"` | Either a capture group index (integer) that captures `"error"`, `"warning"`, or `"info"`, or a fixed string. |
| `message` | integer | no | `3` | Capture group index for the diagnostic message. |
| `code` | integer | no | — | Capture group index for a diagnostic code. |

### Examples

**clang-tidy** (`/path/file.cpp:10:5: warning: some message [check-name]`):

```json
"cmake.additionalBuildProblemMatchers": [
  {
    "name": "clang-tidy",
    "regexp": "^(.+?):(\\d+):(\\d+):\\s+(warning|error|note):\\s+(.+?)\\s*(?:\\[(.+)\\])?$",
    "file": 1,
    "line": 2,
    "column": 3,
    "severity": 4,
    "message": 5,
    "code": 6
  }
]
```

**cppcheck** (`[file.cpp:10]: (warning) message`):

```json
"cmake.additionalBuildProblemMatchers": [
  {
    "name": "cppcheck",
    "regexp": "^\\[(.+?):(\\d+)\\]:\\s+\\((error|warning|style|performance|portability|information)\\)\\s+(.+)$",
    "file": 1,
    "line": 2,
    "severity": 3,
    "message": 4
  }
]
```

**Custom script with fixed severity** (`LINT: file.cpp:7: message`):

```json
"cmake.additionalBuildProblemMatchers": [
  {
    "name": "my-lint",
    "regexp": "^LINT:\\s+(.+?):(\\d+):\\s+(.+)$",
    "file": 1,
    "line": 2,
    "severity": "error",
    "message": 3
  }
]
```

#### Resolving a specific target with `${input:...}`

All launch-target commands (`cmake.launchTargetPath`, `cmake.getLaunchTargetPath`, and their directory/filename/name variants) accept an optional `targetName` argument. When `targetName` is provided, the command resolves that specific executable target **without changing the active launch target**. This is useful for projects with multiple executables, allowing stable per-target `launch.json` configurations.

Use VS Code [input variables](https://code.visualstudio.com/docs/editor/variables-reference#_input-variables) to pass arguments:

```jsonc
{
    "inputs": [
        {
            "id": "serverPath",
            "type": "command",
            "command": "cmake.launchTargetPath",
            "args": { "targetName": "my_server" }
        }
    ]
}
```

Then reference it in a launch configuration as `"program": "${input:serverPath}"`. See [Debugging a specific target](debug-launch.md#debugging-a-specific-target-multi-executable-projects) for full examples.

## Next steps

- Learn about [user vs. workspace settings](https://code.visualstudio.com/docs/getstarted/settings)
- [Get started with CMake Tools on Linux](https://code.visualstudio.com/docs/cpp/cmake-linux)
- Review [How CMake Tools builds](build.md#how-cmake-tools-builds)
- Explore the [CMake Tools documentation](README.md)
