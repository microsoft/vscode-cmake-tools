# What's New?

## 1.4.2
Improvements:
- Added new variable substitution command: `${command:cmake.launchTargetFilename}`. [#632](https://github.com/microsoft/vscode-cmake-tools/issues/632) [@ebai101](https://github.com/ebai101)
- Add output parser for Wind River Diab compiler. [PR #1267](https://github.com/microsoft/vscode-cmake-tools/issues/1267) [@ce3a](https://github.com/ce3a)
- Set application run directory to executable path. [#1395](https://github.com/microsoft/vscode-cmake-tools/issues/1395) [@Shatur95](https://github.com/Shatur95)

Bug Fixes:
- Allow minor version of File API protocol to be greater than expected. [#1341](https://github.com/microsoft/vscode-cmake-tools/issues/1341) [@KyleFromKitware](https://github.com/KyleFromKitware)
- Fix high-hitting crash related to output stream encoding. [PR #1367](https://github.com/microsoft/vscode-cmake-tools/issues/1367)
- Fix high-hitting crash: "message must be set" introduced by VS Code 1.49.0. [#1432](https://github.com/microsoft/vscode-cmake-tools/issues/1432)
- Fix detection of clang 10 on Debian. [#1330](https://github.com/microsoft/vscode-cmake-tools/issues/1330)
- Detect gdb for msys2 MinGW properly. [PR #1338](https://github.com/microsoft/vscode-cmake-tools/issues/1338) [@lygstate](https://github.com/lygstate)

## 1.4.1
Bug Fixes:
- VS environment not set correctly. [#1243](https://github.com/microsoft/vscode-cmake-tools/issues/1243)
- VS kits don't set host/target arch properly for toolsets. [#1256](https://github.com/microsoft/vscode-cmake-tools/issues/1256)
- Disable launchTarget key binding while debugging. [#1170](https://github.com/microsoft/vscode-cmake-tools/issues/1170)
- System headers not found. [#1257](https://github.com/microsoft/vscode-cmake-tools/issues/1257)
- Add setting to enable/disable automatic reconfiguring of projects. [#1259](https://github.com/microsoft/vscode-cmake-tools/issues/1259)
- Partial/full CMT activation improperly persisted for multi-root projects. [#1269](https://github.com/microsoft/vscode-cmake-tools/issues/1269)
- Fix MacOS debugging to work out of the box. [#1284](https://github.com/microsoft/vscode-cmake-tools/issues/1284)
- Ensure the silent kits scanning is run once for multi-root. [#1302](https://github.com/microsoft/vscode-cmake-tools/issues/1302)

## 1.4.0
Improvements:
- Documentation updates. [PR #1130](https://github.com/microsoft/vscode-cmake-tools/pull/1130) [@zalava](https://github.com/zalava)
- Add support for per-folder browse path. [#1073](https://github.com/microsoft/vscode-cmake-tools/issues/1073)
- Use a shell script to set environment variables for a kit. [#809](https://github.com/microsoft/vscode-cmake-tools/issues/809) [@pisker](https://github.com/pisker)
- Improvements of the status bar UI. [PR #1200](https://github.com/microsoft/vscode-cmake-tools/pull/1200) [@SchweizS](https://github.com/SchweizS)
- Add context menu for CMakeLists. [#741](https://github.com/microsoft/vscode-cmake-tools/issues/741) [@SchweizS](https://github.com/SchweizS)
- Support partial CMake Tools activation for non cmake repos. [#1167](https://github.com/microsoft/vscode-cmake-tools/issues/1167)
- Support ARM IntelliSense modes. [#1155](https://github.com/microsoft/vscode-cmake-tools/issues/1155)
- Support GNU language standards. [#1208](https://github.com/microsoft/vscode-cmake-tools/issues/1208)
- Add indication of active workspace to project outline. [#1183](https://github.com/microsoft/vscode-cmake-tools/issues/1183) [@SchweizS](https://github.com/SchweizS)

Bug Fixes:
- Skip over debugger guessing logic if cmake.debugConfig explicitly sets miDebuggerPath. [#1060](https://github.com/microsoft/vscode-cmake-tools/issues/1060)
- Normalize all paths sent to CppTools. [#1099](https://github.com/microsoft/vscode-cmake-tools/issues/1099)
- Add support for Objective-C and Objective-C++. [#1108](https://github.com/microsoft/vscode-cmake-tools/issues/1108) [@marksisson](https://github.com/marksisson)
- Update the configuration provider id. [#1045](https://github.com/microsoft/vscode-cmake-tools/issues/1045) [@ChristianS99](https://github.com/ChristianS99)
- Clear the terminal for Compile Active File. [#1122](https://github.com/microsoft/vscode-cmake-tools/issues/1122)
- Update vswhere to a version that supports utf-8. [#1104](https://github.com/microsoft/vscode-cmake-tools/issues/1104)
- Support source files outside the base path. [#1140](https://github.com/microsoft/vscode-cmake-tools/issues/1140)
- Allow quotes in cache entries. [#1124](https://github.com/microsoft/vscode-cmake-tools/issues/1124) [@tmaslach](https://github.com/tmaslach)
- Fix default preferred generators detection logic. [#1084](https://github.com/microsoft/vscode-cmake-tools/issues/1084)
- Fix host and target platform information for VS kits. [#964](https://github.com/microsoft/vscode-cmake-tools/issues/964)
- Fix error caused by duplicate project structure. [#587](https://github.com/microsoft/vscode-cmake-tools/issues/587) [@SchweizS](https://github.com/SchweizS)
- Disable launchTarget key binding while debugging. [#1170](https://github.com/microsoft/vscode-cmake-tools/issues/1170)
- Skip configuring when cache is present and according setting is on. [#984](https://github.com/microsoft/vscode-cmake-tools/issues/984)
- Remove deprecated cmake.useCMakeServer setting. [#1059](https://github.com/microsoft/vscode-cmake-tools/issues/1059)
- Trigger automatic CMake configure on CMakeLists.txt save. [#1187](https://github.com/microsoft/vscode-cmake-tools/issues/1187) [@Yuri6037](https://github.com/Yuri6037)
- Silently scanning for kits:
    - when there is no available kits json file. [PR #1192](https://github.com/microsoft/vscode-cmake-tools/pull/1192)
    - when the extension introduces breaking changes in the kits definition. [#1195](https://github.com/microsoft/vscode-cmake-tools/issues/1195)
- Various unhandled exceptions and crash fixes:
    - "cannot read property 'length' of undefined" when CMake not found in path. [#1110](https://github.com/microsoft/vscode-cmake-tools/issues/1110)
    - "cannot read property 'uri' of undefined" called by cmake.buildDirectory command. [#1150](https://github.com/microsoft/vscode-cmake-tools/issues/1150)
    - high hitting crash in telemetry. [PR #1154](https://github.com/microsoft/vscode-cmake-tools/pull/1154)

## 1.3.1
Improvements:
- Show "Collapse all" command on project outline view. [#839](https://github.com/microsoft/vscode-cmake-tools/issues/839) [@dirondin](https://github.com/dirondin)

Bug Fixes:
- Toolset and platform are swapped when reading from CMake cache. [#1065](https://github.com/microsoft/vscode-cmake-tools/issues/1065)
- Unable to debug targets when path is specified as absolute by the cmake-file-api. [#1067](https://github.com/microsoft/vscode-cmake-tools/issues/1067) [@KoeMai](https://github.com/KoeMai)

## 1.3.0
Improvements:
- Multi-root support. You can now open multiple folders in VS Code and CMake Tools will allow you to configure each of the projects in those folders.
- Add support for `${command:cmake.buildKit}`. [#334](https://github.com/microsoft/vscode-cmake-tools/issues/334) [@xgdgsc](https://github.com/xgdgsc)
- Add LLVM_ROOT and Visual Studio Clang locations to the search path for Kits. [#914](https://github.com/microsoft/vscode-cmake-tools/issues/914) [@Zingam](https://github.com/Zingam)
- Support additional `intelliSenseModes` in the configuration provider. [#960](https://github.com/microsoft/vscode-cmake-tools/issues/960)
- Detect bundled CMake in Visual Studio. [#610](https://github.com/microsoft/vscode-cmake-tools/issues/610) [@Zingam](https://github.com/Zingam)
- Add "Scan for kits" option in kits QuickPick. [#864](https://github.com/microsoft/vscode-cmake-tools/issues/864) [@Zingam](https://github.com/Zingam)
- Implement the CMake File API. [PR #720](https://github.com/microsoft/vscode-cmake-tools/pull/720) [@KoeMai](https://github.com/KoeMai)

Bug Fixes:
- Support temp folders not located on system drive. [PR #974](https://github.com/microsoft/vscode-cmake-tools/pull/974) [@Carsten87](https://github.com/Carsten87)
- Add MinGW path to the environment. [PR #983](https://github.com/microsoft/vscode-cmake-tools/pull/983)
- Don't do a clean build for utility targets. [#643](https://github.com/microsoft/vscode-cmake-tools/issues/643) [@rcxdude](https://github.com/rcxdude)
- Visual Studio builds should support `cmake.parallelJobs` setting. [PR #975](https://github.com/microsoft/vscode-cmake-tools/pull/975) [@tonka3000](https://github.com/tonka3000)
- Fix build cancellation. [#946](https://github.com/microsoft/vscode-cmake-tools/issues/946) [#781](https://github.com/microsoft/vscode-cmake-tools/issues/781) [#522](https://github.com/microsoft/vscode-cmake-tools/issues/522) [@KoeMai](https://github.com/KoeMai)
- Normalize both absolute and relative paths. [PR #963](https://github.com/microsoft/vscode-cmake-tools/pull/963) [@GeorchW](https://github.com/GeorchW)
- Filter out duplicate targets from the target selector. [#863](https://github.com/microsoft/vscode-cmake-tools/issues/863)
- Fix a crash when `chcp` is not found on the machine. [#977](https://github.com/microsoft/vscode-cmake-tools/issues/977)
- Don't fail if CMakeLists.txt was appended to sourceDirectory. [#1014](https://github.com/microsoft/vscode-cmake-tools/issues/1014)
- Mark all tests as 'not run' in case of build failure when running CTest. [PR #980](https://github.com/microsoft/vscode-cmake-tools/pull/980) [@Morozov-5F](https://github.com/Morozov-5F)
- Add command to hide launch/debug commands and debug button. [PR #1035](https://github.com/microsoft/vscode-cmake-tools/pull/1035)
- Add support for `${workspaceFolderBasename}`. [#869](https://github.com/microsoft/vscode-cmake-tools/issues/869)
- Fix exception thrown by debug/launch commands. [#1036](https://github.com/microsoft/vscode-cmake-tools/issues/1036)

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
