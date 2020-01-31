# What's New?

## 1.3.0
Improvements:
- Multi-root support. You can now open multiple folders in VS Code and CMake Tools will allow you to configure each of the projects in those folders.
- Add support for `${command:cmake.buildKit}`. [#334](https://github.com/microsoft/vscode-cmake-tools/issues/334) [@xgdgsc](https://github.com/xgdgsc)
- Add LLVM_ROOT and Visual Studio Clang locations to the search path for Kits. [#914](https://github.com/microsoft/vscode-cmake-tools/issues/914) [@Zingam](https://github.com/Zingam)
- Support additional `intelliSenseModes` in the configuration provider. [#960](https://github.com/microsoft/vscode-cmake-tools/issues/960)
- Detection of bundled CMake in Visual Studio. [#610](https://github.com/microsoft/vscode-cmake-tools/issues/610)
- Refactor CMakeServerClient.sendRequest() to improve consistency. [PR #949](https://github.com/microsoft/vscode-cmake-tools/pull/949)
- "Scan for kits" option in kits QuickPick. [#864](https://github.com/microsoft/vscode-cmake-tools/issues/864)
- Implementation of the CMake 3.15.0-rc2 cmake-file-api. [PR #720](https://github.com/microsoft/vscode-cmake-tools/pull/720)

Bug Fixes:
- Support temp folders not located on system drive. [PR #974](https://github.com/microsoft/vscode-cmake-tools/pull/974) [@Carsten87](https://github.com/Carsten87)
- Add MinGW path to the environment. [PR #983](https://github.com/microsoft/vscode-cmake-tools/pull/983)
- Don't do a clean build for utility targets. [#643](https://github.com/microsoft/vscode-cmake-tools/issues/643) [@rcxdude](https://github.com/rcxdude)
- Visual Studio builds should support `cmake.parallelJobs` setting. [PR #975](https://github.com/microsoft/vscode-cmake-tools/pull/975) [@tonka3000](https://github.com/tonka3000)
- Fix build cancellation. [#946](https://github.com/microsoft/vscode-cmake-tools/issues/946) [#781](https://github.com/microsoft/vscode-cmake-tools/issues/781) [#522](https://github.com/microsoft/vscode-cmake-tools/issues/522) [@KoeMai](https://github.com/KoeMai)
- Normalize both absolute and relative paths. [PR #963](https://github.com/microsoft/vscode-cmake-tools/pull/963) [@GeorchW](https://github.com/GeorchW)
- Filter out duplicate targets from the target selector. [#863](https://github.com/microsoft/vscode-cmake-tools/issues/863)
- Fix a crash when `chcp` is not found on the machine. [#977](https://github.com/microsoft/vscode-cmake-tools/issues/977)
- CMakeLists.txt and sourceDirectory fixes:
    - Don't fail if CMakeLists.txt was appended to sourceDirectory. [#1014](https://github.com/microsoft/vscode-cmake-tools/issues/1014)
    - Print the value of sourceDirectory when it is invalid. [#1025](https://github.com/microsoft/vscode-cmake-tools/issues/1025)
- Active folder fixes:
    - Allow temporary override of active folder. [PR #1021](https://github.com/microsoft/vscode-cmake-tools/pull/1021)
    - Improve various messages with the folder name information. [PR #1018](https://github.com/microsoft/vscode-cmake-tools/pull/1018)
- Clear the output for "install" if the setting dictates. [PR #1030](https://github.com/microsoft/vscode-cmake-tools/pull/1030)
- Change the name for unspecified kit back to __unspec__. [PR #1033](https://github.com/microsoft/vscode-cmake-tools/pull/1033)
- Mark all tests as 'not run' in case of build failure when running CTest. [PR #980](https://github.com/microsoft/vscode-cmake-tools/pull/980)

## 1.2.3
Bug fixes:
- CTest status bar button text appears malformed. [#911](https://github.com/microsoft/vscode-cmake-tools/issues/911)
- Cleanup fix for message "Platform undefined / toolset {}". [#913](https://github.com/microsoft/vscode-cmake-tools/issues/913)
- Fix incorrect file associations when language is unset. [#926](https://github.com/microsoft/vscode-cmake-tools/issues/926)

## 1.2.2
Bug fixes:
- Fix broken SchemaProvider. [#874](https://github.com/microsoft/vscode-cmake-tools/issues/874)
- Fix the RegExp for finding a debugger. [#884](https://github.com/microsoft/vscode-cmake-tools/issues/884)
- Update flow for missing CMakeLists.txt. [#533](https://github.com/microsoft/vscode-cmake-tools/issues/533)
- getVSInstallForKit should be a no-op on systems other than windows. [#886](https://github.com/microsoft/vscode-cmake-tools/issues/886)
- Include missing source directories in the custom browse path. [#882](https://github.com/microsoft/vscode-cmake-tools/issues/882)
- Handle exceptions thrown by spawn. [#895](https://github.com/microsoft/vscode-cmake-tools/issues/895)
- Various generators fixes:
    - [#900](https://github.com/microsoft/vscode-cmake-tools/issues/900)
    - [#880](https://github.com/microsoft/vscode-cmake-tools/issues/880)
    - [#885](https://github.com/microsoft/vscode-cmake-tools/issues/885)

## 1.2.1
Thank you to the following CMake Tools contributors: koemai, bjosa, emanspeaks, som1lse,
dcourtois, tsing80, andy-held, notskm, thezogoth, yokuyuki, dbird137, fabianogk, randshot.

**vector-of-bool** has moved on to other things and Microsoft is now maintaining this extension. Thank you **vector-of-bool**
for all of your hard work getting this extension to where it is today!

Breaking changes:
- The publisher id changes to ms-vscode.cmake-tools. This requires that you uninstall earlier versions of the extension.
- Scanning for kits is able to detect more accurately multiple VS installations.
  To achieve this, a Visual Studio kit is defined differently now in cmake-tools-kits.json:
  the "visualStudio" field represents an ID unique to the installation
  as opposed to "VisualStudio.${VS Version}" (which may be the same for multiple same year VS installations).
  The CMake Tools Extension is still able to work with the old definition VS kits,
  but for simplicity and to avoid duplicates in the json file it will prompt for permission to delete them
  each time a "Scan for kits" is performed.

Features:
- Support for localized messages.
- Cross compile support for CppTools integration.
- Adapt CppTools integration to API version 3. [#637](https://github.com/Microsoft/vscode-cmake-tools/issues/637)
- Expand kit environment variables. [#460](https://github.com/Microsoft/vscode-cmake-tools/issues/460)
- Add new commands: launchTargetDirectory, buildType, buildDirectory. [#334](https://github.com/Microsoft/vscode-cmake-tools/issues/334), [#654](https://github.com/Microsoft/vscode-cmake-tools/issues/654), [#564](https://github.com/Microsoft/vscode-cmake-tools/issues/564), [#559](https://github.com/Microsoft/vscode-cmake-tools/issues/559), [#695](https://github.com/Microsoft/vscode-cmake-tools/issues/695)
- Add support for VS2010.

Improvements:
- Restructuring of the CMake Driver.
- Improve stability of CMake Generator Selection. [#512](https://github.com/Microsoft/vscode-cmake-tools/issues/512)
- Refactor and extend CMS-server driver test.
- Rework the CMake Build from a terminal to a task.
- Add Launch target test.
- Increase wait time in test to open terminal.

Bug fixes:
- Cannot execute current target without a debugger. [#601](https://github.com/Microsoft/vscode-cmake-tools/issues/601)
- Path clobbering by bad kit file env. [#701](https://github.com/Microsoft/vscode-cmake-tools/issues/701), [#713](https://github.com/Microsoft/vscode-cmake-tools/issues/713)
- Target install missing. [#504](https://github.com/Microsoft/vscode-cmake-tools/issues/504)
- CTest controller updated on reconfig. [#212](https://github.com/Microsoft/vscode-cmake-tools/issues/212)
- Recalculate total for every run of CTest.
- Debug target does not find GDB. [#375](https://github.com/Microsoft/vscode-cmake-tools/issues/375)

## 1.1.3

Many thanks to [Yonggang Luo](https://github.com/lygstate) for several changes
in this version.

Removal:

- The visual CMake cache editor GUI is gone. The API with which it was drawn is
  being removed from a future version of VS Code, and the feature had many
  issues. A future CMake GUI will be introduced with more features and greater
  stability.

Features and Tweaks:

- On Linux, will detect old CMake versions and offer to do an automatic
  upgrade. Windows support is pending. If you have a macOS devices and would
  like to contribute, please open a pull request!
- Smarter parsing of GCC and Clang compile errors to fold `note:` and
  `required from:` blocks into their main diagnostic. This permits the
  folding and browsing of template and macro instantiation errors in a nicer
  fashion. MSVC error parsing pending. (**NOTE**: There is an upstream issue
  with the sort order of diagnostic information, so `required from`
  tracebacks may appear out-of-order).

Fixes:

- On Windows, "Launch target in terminal" will use `cmd.exe` unconditionally.
  This works around issues with command quoting in PowerShell
- "Debug target" will prefer `lldb-mi` to `lldb`. Fixes issues where `cpptools`
  is unable to launch the debugger.
- Document the `environmentVariables` field on kits.
- Fix legacy CMake mode not setting the CMake generator.
- Permit limited variable expansion for `cmake.cmakePath` in `settings.json`
  (refer to documentation for more details).

## 1.1.2

A bugfix release for [these issues](https://github.com/vector-of-bool/vscode-cmake-tools/milestone/13?closed=1).

## 1.1.1

A bugfix release for [these issues](https://github.com/vector-of-bool/vscode-cmake-tools/milestone/12?closed=1).

**BREAKING CHANGE**: Variant substitutions follow a new `${variant:var-key}`
syntax to match the special namespacing of substitutions.

## 1.1.0

1.1.0 includes a few new major features:

- `cpptools` integration for IntelliSense
- A Project Outline view as a custom explorer
- Building individual source files from the editor menus
- New UI for progress and cancellation

See the changelog in the official documentation for more information.
