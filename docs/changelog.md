# Changelog and History

## 1.1.3

### Removed

- [#579](https://github.com/vector-of-bool/vscode-cmake-tools/issues/579): the visual CMake cache editor GUI is gone. The API with which it was drawn is
  being removed from a future version of VS Code, and the feature had many
  issues. A future CMake GUI will be introduced with more features and greater
  stability.
  

### Features and updates

- On Linux, will detect old CMake versions and offer to do an automatic
  upgrade. Windows support is pending. If you have a macOS devices and would
  like to contribute, please open a pull request.
- Smarter parsing of GCC and Clang compile errors to fold `note:` and
  `required from:` blocks into their main diagnostic. This permits the
  folding and browsing of template and macro instantiation errors in a nicer
  fashion. MSVC error parsing pending. (**NOTE**: There is an upstream issue
  with the sort order of diagnostic information, so `required from:`
  tracebacks may appear out-of-order).

### Fixes

- [#562](https://github.com/vector-of-bool/vscode-cmake-tools/issues/562): On Windows, "Launch target in terminal" will use `cmd.exe` unconditionally. This works around issues with command quoting in PowerShell.
- [#584](https://github.com/vector-of-bool/vscode-cmake-tools/issues/584): "Debug target" will prefer `lldb-mi` to `lldb`. Fixes issues where `ms-vscode.cpptools` is unable to launch the debugger.
- [#586](https://github.com/vector-of-bool/vscode-cmake-tools/issues/568): Document the `environmentVariables` field on kits.
- [#567](https://github.com/vector-of-bool/vscode-cmake-tools/issues/567): Fix legacy CMake mode not setting the CMake generator.  
- [#569](https://github.com/vector-of-bool/vscode-cmake-tools/issues/569): Permit limited variable expansion for `cmake.cmakePath` in `settings.json`  

## 1.1.2

### Features and updates

- Fix silent failure when a build directory appears at a different path than what is encoded in `CMakeCache.txt`.
- Improved logic in path normalization.
- Improve documentation on using `launch.json`.
- Fix shell splitting preventing certain command lines from being parsed correctly.
- Display a more helpful message when using a toolchain file and can't find the C and/or C++ compiler because it is not stored in the CMake cache.

See the [1.1.2 milestone on GitHub](https://github.com/vector-of-bool/vscode-cmake-tools/milestone/13?closed=1) for more details.

## 1.1.1

Fixes and updates

- Fix "Unable to automatically determine compiler" when using VS generators.
- Fix failure to provide IntelliSense information for header files even after adding them to a target.
- "Unexpected stderr/stdout..." no longer appears. This output is now logged as regular CMake status messages.

**BREAKING CHANGE**: Variant substitutions follow a new `${variant:var-key}` syntax to match the special namespacing of substitutions. See [variable substitution](cmake-settings.md#variable-substitution).

See the [1.1.1 milestone on GitHub](https://github.com/vector-of-bool/vscode-cmake-tools/milestone/12?closed=1) for more details.

## 1.1.0

1.1.0 includes the following new features:

- *A project outline view*. CMake Tools now renders a tree representation of your CMake project, including all targets and source files.
  - Individual targets can be built/run using the context menu in the outline.
  - Individual source files can be compiled using the outline context menu.
  - The debugger can be started by right-clicking on the desired executable.

- Update progress and cancellation notifications. Now uses the official VSCode progress APIs. A *Cancel* button is visible on the progress notification to cancel the build.
- Show progress for the *Configure/Generate* phase. This depends on CMake to generate reliable progress values.
- Automatically configure a project when it is opened. CMake Tools will ask you the first time, and this preference can be persisted.
- Will automatically ask you for a debug target if you try to debug but haven't yet set one.

### ms-vscode.cpptools integration

Recent versions of Microsoft's C and C++ extension now export an extensibility API that gives external sources the opportunity to provide project configuration information on a file-by-file basis.

CMake Tools 1.1.0+ uses this API to provide per-file compilation and configuration information to support the C++ extension. This means that a properly set up CMake project doesn't need to manually set configuration information in order to receive the benefits of ms-vscode.cpptools' IntelliSense engine.

See [set up include paths for C++ IntelliSense](how-to.md#set-up-include-paths-for-c-intellisense) for more details.

## 1.0.1

- Automatically detect when a kit specifies a path to a non-existent compiler and ask whether to remove or keep that kit.
- New option [cmake.copyCompileCommands](cmake-settings.md#cmake-settings) which allows you to set a path to which
  `compile_commands.json` will be copied after a configure.
- Fix failure when CMake executable has a different name than `cmake`.
- Fixed edits to the kits file not applying immediately.
- Fixed issue where CTest is not on the `$PATH` and it fails to detect tests.

## 1.0.0

Marks the first stable release. It is now a developer-ready tool that is suitable for everyday work.

### Features and updates

- Option to build on `cmake.launchTargetPath` (Launch-before-debug). See [cmake.buildBeforeRun](cmake-settings.md#cmake-settings) for more details.
- [LLVM for Windows](https://llvm.org/builds) is now supported as an auto-detected Kit type.
- To support LLVM for Windows, kit options can now be freely mixed-and-matched, e.g. setting a toolchain file along with a Visual Studio environment.
- Cache initialization files are now supported in `settings.json`. See [cmake.cacheInit](cmake-settings.md#cmake-settings).
- Kits are now optional. If no kit is active, CMake Tools will ask you if you want to scan, select a kit, or opt-out of kits. If no kit is chosen, CMake Tools let CMake decide what to do.
- GCC cross-compilers are now detected as regular compilers for compiler kits.
- Setting [cmake.defaultVariants](cmake-settings.md#cmake-settings) is respected again.
- Setting [cmake.mingwSearchDirs](cmake-settings.md#cmake-settings) is respected again.
- CMake Tools attempts to set the path to the debugger (`gdb` or `lldb`) during Quick Debugging.
- Fix for intermittent "Not yet configured" errors.

## 0.11.1

### Bug fixes and updates

- [#385](https://github.com/vector-of-bool/vscode-cmake-tools/issues/385): Attempted fix for "No build system was generated yet" by implementing more reliable dirty-checks when running a build/configure.
 - [#381](https://github.com/vector-of-bool/vscode-cmake-tools/pull/381): Fix handling spaces in filepaths when running `vswhere.exe`.  
- [#384](https://github.com/vector-of-bool/vscode-cmake-tools/issues/384): Fix environment variables from `settings.json` being ignored when using legacy (non-cmake-server) mode.
- [#395](https://github.com/vector-of-bool/vscode-cmake-tools/pull/395): Do not case-normalize diagnostics on Windows. This prevents VSCode from considering two equivalent paths to be different when opening them from the problems panel.
- [#394](https://github.com/vector-of-bool/vscode-cmake-tools/pull/394): Reset progress when build finishes. Stops a flash of "%100" when starting a new build.
- [#388](https://github.com/vector-of-bool/vscode-cmake-tools/issues/388): Better error message when trying to use debugging on non-cmake-server.

## 0.11.0

### Updates

- [CMake kits](kits.md) provide a new way to encapsulate the toolset used to build a project.
- Opt-in automatic error reporting.
- Stability and backend cleanup.
- All new documentation

## 0.10.x and Older

The pre-0.11.0 changelog can be found [here](https://github.com/vector-of-bool/vscode-cmake-tools/blob/develop/CHANGELOG.pre-0.11.0.md)
