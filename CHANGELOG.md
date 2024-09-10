# What's New?

## 1.20

Improvements:

- Update signing to support VSCode extension signing. [#4055](https://github.com/microsoft/vscode-cmake-tools/pull/4055)

## 1.19.51

Bug Fixes:

- Fix generator and preferredGenerator logic. [#4031](https://github.com/microsoft/vscode-cmake-tools/issues/4031), [#4005](https://github.com/microsoft/vscode-cmake-tools/issues/4005), [#4032](https://github.com/microsoft/vscode-cmake-tools/issues/4032)

## 1.19.50

Bug Fixes:

- Fix env expansion of all variables (toolchainFile, etc.) in presets. [#4019](https://github.com/microsoft/vscode-cmake-tools/issues/4019)
- Fix issues with inheritance and presets. [#4023](https://github.com/microsoft/vscode-cmake-tools/issues/4023)

## 1.19.49

Features:

- Add setting `cmake.useVsDeveloperEnvironment` to allow for more user control on when the Visual Studio Developer Enviornment is attempted to be added to the CMake Presets environment. [#3892](https://github.com/microsoft/vscode-cmake-tools/pull/3892)

Improvements:

- Add `Unspecified` option for selecting a kit variant to allow CMake itself to select the build type. [#3821](https://github.com/microsoft/vscode-cmake-tools/issues/3821)
- Skip loading variants when using CMakePresets. [#3300](https://github.com/microsoft/vscode-cmake-tools/issues/3300)
- Resolve diagnostics files relative to workspace and build directory, fixes [#1401](https://github.com/microsoft/vscode-cmake-tools/issues/1401) [@fargies](https://github.com/fargies)
- Add setting to only show the cmake log on target failure. [#3785](https://github.com/microsoft/vscode-cmake-tools/pull/3785) [@stepeos](https://github.com/stepeos)
- Preset expansion occurs on `CMakePresets.json` or `CMakeUserPresets.json` save, and if there are no errors the expanded presets are cached. The VS Developer Environment will only be applied to a preset if it is selected. Expansion errors will show in the problems panel and preset files with errors will be invalid, and any presets they contain cannot be used. [#3905](https://github.com/microsoft/vscode-cmake-tools/pull/3905)
- Remove pop-ups asking to configure, default `cmake.configureOnOpen` to `true`. [#3967](https://github.com/microsoft/vscode-cmake-tools/pull/3967)

Bug Fixes:

- Attempt to fix stringifying the extension context. [#3797](https://github.com/microsoft/vscode-cmake-tools/issues/3797)
- Fix issue where `cmake.preferredGenerators` wasn't falling back to the next entry when the first entry didn't exist. [#2709](https://github.com/microsoft/vscode-cmake-tools/issues/2709)
- Potential fix for attempting to load a non-variants file as a variants file and throwing a parse exception. [#3727](https://github.com/microsoft/vscode-cmake-tools/issues/3727)
- Fix issue where `cmakeUserPresets.json` not showing up in project outline. [#3832](https://github.com/microsoft/vscode-cmake-tools/issues/3832)
- Fix edge case where parsing tests fails when additional output is printed before tests json. [#3750](https://github.com/microsoft/vscode-cmake-tools/issues/3750)
- Fix issue where `Configure with CMake Debugger` fails on restart because the previously used pipe to CMake Debugger is no longer available. [#3582](https://github.com/microsoft/vscode-cmake-tools/issues/3582)
- Fix custom kit PATH being overriden. [#3849](https://github.com/microsoft/vscode-cmake-tools/issues/3849)
- Fix debug variables being overriden. [#3806](https://github.com/microsoft/vscode-cmake-tools/issues/3806)
- Fix issue in Quick Start where a C file was generated in place of a C++ file. [#3856](https://github.com/microsoft/vscode-cmake-tools/issues/3856)
- Fix custom build tasks not showing up. [#3622](https://github.com/microsoft/vscode-cmake-tools/issues/3622)
- Fix the bug where if a relative path specified for `installDir`, it is not calculated relative to the source directory, which is how it should be according to the CMake `installDir` docs [here](https://cmake.org/cmake/help/latest/manual/cmake-presets.7.html#configure-preset). [#3871](https://github.com/microsoft/vscode-cmake-tools/issues/3871)
- Fix issue with CMakeLists.txt depth search. [#3901](https://github.com/microsoft/vscode-cmake-tools/issues/3901)
- Fix localized file path for schema files. [#3872](https://github.com/microsoft/vscode-cmake-tools/issues/3872)
- Disable annoy and invalid extenion message about fix windows sdk for MSVC 2022. [#3837](https://github.com/microsoft/vscode-cmake-tools/pull/3837)
- Fix re-using a terminal for launching even when the environment has changed. [#3478](https://github.com/microsoft/vscode-cmake-tools/issues/3478)
- Fix our keybindings for debug and run without debugging to better match VS Code. [#3507](https://github.com/microsoft/vscode-cmake-tools/issues/3507)
- Allow success recovery in the configure precondition handler. [#3554](https://github.com/microsoft/vscode-cmake-tools/issues/3554)
- Prevent second configure after `QuickStart` if the `automaticReconfigure` setting is enabled. [#3910](https://github.com/microsoft/vscode-cmake-tools/issues/3910)
- Set usepresets context after manually creating a CMakePresets.json/CMakeUserPresets.json or using QuickStart to create it. [#3854](https://github.com/microsoft/vscode-cmake-tools/issues/3854)
- Only do special handling of `~` for code model reply path on linux. [#3957](https://github.com/microsoft/vscode-cmake-tools/issues/3957)
- Fix issues with expanding unnecessary environment variables and incorrectly saving preset environments to cache. Also fixes expansion error reporting issue with not checking for an invalid Configure preset in other types of presets. [#3961](https://github.com/microsoft/vscode-cmake-tools/issues/3961) & [#1841](https://github.com/microsoft/vscode-cmake-tools/issues/1841)

## 1.18.44

Bug Fixes:

- Infrastructure fixes.

## 1.18.43

Features:

- Upgrade `cmake_minimum_required` version 3.0.0 -> 3.5.0. [#3793](https://github.com/microsoft/vscode-cmake-tools/issues/3793)

Improvements:

- Add setting for deleting entire build dir when clean configuring. [#3515](https://github.com/microsoft/vscode-cmake-tools/issues/3515)

Bug Fixes:

- Fix issue "Logs are unavailable when running tests from the Test Explorer" and display properly the test output. [#3140](https://github.com/microsoft/vscode-cmake-tools/issues/3140)
- Fix issue with "Test Results Not Found" when `cmake.ctest.allowParallelJobs` is disabled. [#3798](https://github.com/microsoft/vscode-cmake-tools/issues/3798)
- Update localized strings for Project Status UI and quick pick dropdowns. [#3803](https://github.com/microsoft/vscode-cmake-tools/issues/3803), [#3802](https://github.com/microsoft/vscode-cmake-tools/issues/3802)
- Fix issue where new presets couldn't inherit from presets in CmakeUserPresets.json. These presets are now added to CmakeUserPresets.json instead of CmakePresets.json. [#3725](https://github.com/microsoft/vscode-cmake-tools/issues/3725)
- Fix issue where CMakeTools does not recheck CMake Path to see if user installed CMake after launching VS Code. [3811](https://github.com/microsoft/vscode-cmake-tools/issues/3811)
- Fix issue where `cmake.buildToolArgs` was sometimes applied incorrectly when presets are used. [#3754](https://github.com/microsoft/vscode-cmake-tools/issues/3754)
- Fix issue where `preferredGenerator.platform` and `preferredGenerator.toolset` wasn't being compared between the old and new kit to trigger a clean configure on a kit selection change. [#2699](https://github.com/microsoft/vscode-cmake-tools/issues/2699)
- Still allow for users to add `--warn-unused-cli`. Now instead of overriding, it will remove our default `--no-warn-unused-cli`. [#1090](https://github.com/microsoft/vscode-cmake-tools/issues/1090)
- Ensure `useCMakePresets` context is set after making a CMakePreset.json with `Quick Start`. [#3734](https://github.com/microsoft/vscode-cmake-tools/issues/3734)

## 1.18.42

Bug Fixes:
- Fix schema validation for `$schema`. [#3809](https://github.com/microsoft/vscode-cmake-tools/pull/3809)
- Fix tests having too long of a command-line. [#3814](https://github.com/microsoft/vscode-cmake-tools/pull/3814)

## 1.18.41
Features:

- Add the possibility to open the current build directory in the Explorer. [#1451](https://github.com/microsoft/vscode-cmake-tools/issues/1451)
- Add support for CMakePresets V7 and V8. [#3549](https://github.com/microsoft/vscode-cmake-tools/issues/3549)
- Update `api.ts` to add the `onSelectedConfigurationChanged` event. [#3671](https://github.com/microsoft/vscode-cmake-tools/pull/3671) [@OrkunTokdemir](https://github.com/OrkunTokdemir)
- Improve CMake QuickStart by allowing the user to dynamically create a CMakePresets.json file. [#3649](https://github.com/microsoft/vscode-cmake-tools/issues/3649)

Improvements:

- Allow ctests to run in parallel when launched through the Test Explorer. [#3122](https://github.com/microsoft/vscode-cmake-tools/issues/3322)
- Properly set up environment for MSYS toolchains. [#2447](https://github.com/microsoft/vscode-cmake-tools/issues/2447) [@Steelskin](https://github.com/Steelskin)
- Allow for users to add `--warn-unused-cli`. This will override our default `--no-warn-unused-cli`. [#1090](https://github.com/microsoft/vscode-cmake-tools/issues/1090)
- Add option to disable kit scan by default when a kit isn't selected. [#1461](https://github.com/microsoft/vscode-cmake-tools/issues/1461)
- Show cmake output when version probe fails. [#3650](https://github.com/microsoft/vscode-cmake-tools/issues/3650)
- Improve various settings scopes [#3601](https://github.com/microsoft/vscode-cmake-tools/issues/3601)
- Refactor the Project Outline view to show a flat list of targets [#491](https://github.com/microsoft/vscode-cmake-tools/issues/491), [#3684](https://github.com/microsoft/vscode-cmake-tools/issues/3684)
- Add the ability to pin CMake Commands to the sidebar [#2984](https://github.com/microsoft/vscode-cmake-tools/issues/2984) & [#3296](https://github.com/microsoft/vscode-cmake-tools/issues/3296)
- Add support for variable expansion in `debugConfig.environment` [#3711](https://github.com/microsoft/vscode-cmake-tools/issues/3711)
- Add the ability to debug install targets [#532](https://github.com/microsoft/vscode-cmake-tools/issues/532)
- Add a "Don't Show Again" option in the select CMakeLists.txt.
- Log error statement if the environmentSetupScript fails. [#3566](https://github.com/microsoft/vscode-cmake-tools/issues/3566)
- Sort CMakeLists.txt by depth during selection [#3789](https://github.com/microsoft/vscode-cmake-tools/pull/3789) [@jmigual](https://github.com/jmigual)
- [Experiment] Improve CMake Tools experience when opening a folder [#3588](https://github.com/microsoft/vscode-cmake-tools/issues/3588)

Bug Fixes:
- Fix localization issue in package.json. [#3616](https://github.com/microsoft/vscode-cmake-tools/issues/3616)
- Remove incorrect validation which was breaking references from CMakeUserPresets to CMakePresets. [#3636](https://github.com/microsoft/vscode-cmake-tools/issues/3636)
- Fix 'Debug Test' from 'Test explorer' results in 'launch: property 'program' is missing or empty'. [#3280](https://github.com/microsoft/vscode-cmake-tools/issues/3280)
- Fix "Go to source" in Testing activity + test panel without function. [#3362](https://github.com/microsoft/vscode-cmake-tools/issues/3362)
- Remove an un-implemented "internal" command. [#3596](https://github.com/microsoft/vscode-cmake-tools/issues/3596)
- Fix incorrect test output. [#3591](https://github.com/microsoft/vscode-cmake-tools/issues/3591)
- Fix issue where our searching for cl and ninja was repeatedly unnecessarily, impacting performance. [#3633](https://github.com/microsoft/vscode-cmake-tools/issues/3633)
- Fix preset environment issue. [#3657](https://github.com/microsoft/vscode-cmake-tools/issues/3657)
- Fix invocation of vcvarsall.bat script argument for targetArch. [#3672](https://github.com/microsoft/vscode-cmake-tools/issues/3672)
- Ensure that we support ${workspaceFolder} when initializing cmake information. [#3658](https://github.com/microsoft/vscode-cmake-tools/issues/3658)
- Fix issue where correcting `cmake.cmakePath` is still broken. [#3570](https://github.com/microsoft/vscode-cmake-tools/issues/3570)
- Fix CMakePresets.json schema validation. [#3651](https://github.com/microsoft/vscode-cmake-tools/issues/3651)
- Update what we use to create the workspace browse configuration to pass to cpp tools by filtering out extra file groups that are generated. [#3729](https://github.com/microsoft/vscode-cmake-tools/issues/3729)
- Fix issue where `cmake.cacheInit` isn't supporting absolute path in environment variables. [#2777](https://github.com/microsoft/vscode-cmake-tools/issues/2777)

## 1.17.17

Bug Fixes:

- Fix the regression for inheritance of cache variables and other inheritable fields. [#3603](https://github.com/microsoft/vscode-cmake-tools/issues/3603)

## 1.17.16

Bug Fixes:

- Fix an issue where we weren't able to run tests when not using Presets. [#3589](https://github.com/microsoft/vscode-cmake-tools/issues/3589)
- Fix the order of preference for CMake Presets `inherit` field. [#3594](https://github.com/microsoft/vscode-cmake-tools/issues/3594)

## 1.17.15

Features:

- Update `api.ts` to add the `getActiveFolderPath` method. [#3528](https://github.com/microsoft/vscode-cmake-tools/pull/3528) [@Kemaweyan](https://github.com/Kemaweyan)
- Add a setting that allows users to enable/disable the Test Explorer integration. [#3145](https://github.com/microsoft/vscode-cmake-tools/issues/3145)
- Add support for CMake Presets V6 (package presets to run CPack and workflow presets). [#2871](https://github.com/microsoft/vscode-cmake-tools/issues/2871)
- Add support for pinning CMake commands to the side bar. [#3296](https://github.com/microsoft/vscode-cmake-tools/issues/3296)

Improvements:

- Improve when the "Configure with Debugger" popup appears and allow for "Do Not Show Again". [#3343](https://github.com/microsoft/vscode-cmake-tools/issues/3343)
- Add option to disable "Not all open documents were saved" popup. [#2889](https://github.com/microsoft/vscode-cmake-tools/issues/2889)
- Allow overriding of CMakePresets cache variables and arguments. [#1836](https://github.com/microsoft/vscode-cmake-tools/issues/1836)
- Improve advanced status bar options configuration by adding an `inherit` option to the `statusBarVisibility` setting and by adding the `inheritDefault` setting. Look at the CMake Options Visibility Configuration docs for more information. [#3452](https://github.com/microsoft/vscode-cmake-tools/issues/3452)

Bug Fixes:

- Fixed an issue where changing an empty value to a non-empty value using the Cache Editor UI didn't work. [PR #3508](https://github.com/microsoft/vscode-cmake-tools/pull/3508)
- Fix CMakePresets inheritance for the `condition` field. [PR #3494](https://github.com/microsoft/vscode-cmake-tools/pull/3494)
- Ensure that the output is cleared for `debugTarget` and `launchTarget`. [#3489](https://github.com/microsoft/vscode-cmake-tools/issues/3489)
- Fix the inheritance of the `environment` for CMakePresets. [#3473](https://github.com/microsoft/vscode-cmake-tools/issues/3473)
- Removed an unnecessary `console.assert` [#3474](https://github.com/microsoft/vscode-cmake-tools/issues/3474)
- Avoid running tests after a build failure [#3366](https://github.com/microsoft/vscode-cmake-tools/issues/3366)
- Make sure we clear the output on builds due to test when `Clear output before build` is enabled. [#1179](https://github.com/microsoft/vscode-cmake-tools/issues/1179)
- Ensure that, when switching between presets, the CMake executable is modified. [#2791](https://github.com/microsoft/vscode-cmake-tools/issues/2791)
- Fixed the key to reference the correct description for the `compact` option of the `cmake.options.advanced.variant.statusBarVisibility` setting. [#3511](https://github.com/microsoft/vscode-cmake-tools/issues/3511)
- Fixed the parsing of C and CXX compiler cache variables when adding a new configure preset from existing compilers. [#2773](https://github.com/microsoft/vscode-cmake-tools/issues/2773)
- Avoid the pitfalls of using `RegExp.exec()` in loops, replacing their usage with `string.matchAll()`. This change is applied to the expand.ts file which deals with expansion of variables in user provided strings. It may address the failures described in issue. [#3469](https://github.com/microsoft/vscode-cmake-tools/issues/3469)
- Fixed `compile_commands.json` file corruption with `copyCompileCommands` when value is equal to default path. [#3214](https://github.com/microsoft/vscode-cmake-tools/issues/3214) [@parniere](https://github.com/parniere)
- Fixed status bar visibility options' `inherit` option default. [PR #3579](https://github.com/microsoft/vscode-cmake-tools/pull/3579)

## 1.16.32
Improvements:

- Improve our "smarts" when we attempt to provide PATH's for compilers or ninja. [PR #3458](https://github.com/microsoft/vscode-cmake-tools/pull/3458)

## 1.16.31
Bug Fixes:
- Refactor our attempt to add VS paths to PATH for cl, clang, etc. so that we fix issues with using the wrong compiler. [PR #3449](https://github.com/microsoft/vscode-cmake-tools/pull/3449)

## 1.16.30
Bug Fixes:
- Fixed an issue where finding cl.exe and ninja from Visual Studio was broken. [PR #3445](https://github.com/microsoft/vscode-cmake-tools/pull/3445)

## 1.16.29
Features:
- Support different debug config for different targets. [PR #2801](https://github.com/microsoft/vscode-cmake-tools/pull/2801) [@RichardLuo0](https://github.com/RichardLuo0)
- Add ability to get a test's `WORKING_DIRECTORY` in launch.json via `cmake.testWorkingDirectory` [PR #3336](https://github.com/microsoft/vscode-cmake-tools/pull/3336)

Improvements:
- Updated debugging documentation to add the LLDB configuration needed for macOS. [PR #3332](https://github.com/microsoft/vscode-cmake-tools/pull/3332) [@slhck](https://github.com/slhck)
- In multi-root workspace, the Project Outline View now shows all configured projects. [PR #3270](https://github.com/microsoft/vscode-cmake-tools/pull/3270) [@vlavati](https://github.com/vlavati)
- Added script mode and ability to connect to externally launched CMake processes. [PR #3277](https://github.com/microsoft/vscode-cmake-tools/pull/3277)
- Added buttons to the project nodes in the Project Outline View. [PR #3354](https://github.com/microsoft/vscode-cmake-tools/pull/3354) [@vlavati](https://github.com/vlavati)
- `$penv{}` macros are expanded in `include` paths in CMakePresets.json as long as `version` is 7 or higher. [#3310](https://github.com/microsoft/vscode-cmake-tools/issues/3310)
- Disable search and select of CMakeLists.txt, if user chooses not to configure project without CMakeLists.txt in the root. [PR #3276](https://github.com/microsoft/vscode-cmake-tools/pull/3276) [@vlavati](https://github.com/vlavati)
- If the "configure" button of CMakeLists.txt node in the Project Outline is clicked, only the corresponding project is configured. [PR #3372](https://github.com/microsoft/vscode-cmake-tools/pull/3372) [@vlavati](https://github.com/vlavati)
- Added a command to directly open the extension settings (`CMake: Open CMake Tools Extension Settings`) and a gear icon button in the Project Status View title bar that calls it. [PR #3403](https://github.com/microsoft/vscode-cmake-tools/pull/3403)
- Added an icon button in the Project Status View title bar that calls the `CMake: Delete Cache and Reconfigure` command. [PR #3403](https://github.com/microsoft/vscode-cmake-tools/pull/3403)
- By default, all of the status bar options are hidden except `build`, `debug`, and `launch`. All of the previous status bar options are now, by default, visible in the Project Status View. These visibility settings can be customized in the `cmake.options.advanced` setting. This setting can also be accessed via the Project Status View. The `cmake.useProjectStatusView` setting is now removed. [PR #3407](https://github.com/microsoft/vscode-cmake-tools/pull/3407) & [PR #3417](https://github.com/microsoft/vscode-cmake-tools/pull/3417)

Bug Fixes:
- Fix Unhandled Exception if no args are specified in `cmake.getLaunchTargetFilename` inside an input context of a task. [PR #3348](https://github.com/microsoft/vscode-cmake-tools/issues/3348) [@vlavati](https://github.com/vlavati)
- Fix incorrect IntelliSense configuration with default/empty `CMAKE_BUILD_TYPE` using CMakePresets. [PR #3363](https://github.com/microsoft/vscode-cmake-tools/pull/3363) [@deribaucourt](https://github.com/deribaucourt)
- Paths containing `mingw` are no longer removed from the `PATH` environment variable because the selected MinGW kit is added before the `PATH` environment variable, rather than after. [#3220](https://github.com/microsoft/vscode-cmake-tools/issues/3220)
- Fix a bug where `CMake: Show Configure` or `CMake: Show Build` commands would run them. [#3381](https://github.com/microsoft/vscode-cmake-tools/issues/3381) [@AbdullahAmrSobh](https://github.com/AbdullahAmrSobh)

## 1.15.31
Features:
- Added support for the CMake Debugger. [#3093](https://github.com/microsoft/vscode-cmake-tools/issues/3093)
- Added support for passing a folder parameter to the `cmake.selectActiveFolder` command. [#3256](https://github.com/microsoft/vscode-cmake-tools/issues/3256) [@cvanbeek](https://github.com/cvanbeek13)

Improvements:
- When using CMake presets, the Project Status View now shows the build target along with the build preset. [PR #3241](https://github.com/microsoft/vscode-cmake-tools/pull/3241)
- IntelliSense resolves headers coming from MacOS frameworks. CMake 3.27 or later is required. [#2324](https://github.com/microsoft/vscode-cmake-tools/issues/2324)
- Allow configure settings to override the usual arguments the extension is usually passing to cmake. Don't have unremovable options. [#1639](https://github.com/microsoft/vscode-cmake-tools/issues/1639)
- Allow a way to run CTests in parallel by setting `cmake.ctest.allowParallelJobs` to `true`. [#3091](https://github.com/microsoft/vscode-cmake-tools/issues/3091)
- When clicking `Run CTests` from the status bar view, it now will bypass the Test Explorer and directly run the CTests. [#3151](https://github.com/microsoft/vscode-cmake-tools/issues/3151)

Bug Fixes:
- Fix per-folder browse configurations returning incorrect information. [#3155](https://github.com/microsoft/vscode-cmake-tools/issues/3155)
- Fix triggers of "Bad CMake Executable" error message. [#2368](https://github.com/microsoft/vscode-cmake-tools/issues/2368)
- Don't ignore empty cache string variables when configuring from presets. [#1842](https://github.com/microsoft/vscode-cmake-tools/issues/1842)
- Fix active build configuration warning coming from CppTools. [#2353](https://github.com/microsoft/vscode-cmake-tools/issues/2353)
- Fix our checking for invalid settings when CMakeUserPresets version is different than CMakePresets. [#2897](https://github.com/microsoft/vscode-cmake-tools/issues/2897)
- Fix the precendence order that we evaluate the `cmake.parallelJobs` setting. [#3206](https://github.com/microsoft/vscode-cmake-tools/issues/3206)
- Decreased the number of cases where we reconfigure erroneously upon usage of `cmake.getLaunchTargetPath`. [#2878](https://github.com/microsoft/vscode-cmake-tools/issues/2878)

## 1.14.33
Bug Fixes:
- Set `Cmake: Use Project Status View` to `false` by default. This setting may be subject to A/B experimentation in 1.14 releases. To opt-out of experimentation, set the `cmake.useProjectStatusView` setting explicitly in `settings.json`. [PR #3199](https://github.com/microsoft/vscode-cmake-tools/pull/3199/)

## 1.14.32
Features:
- Add a new UI to show the project status in the side bar. This feature appears and replaces the status bar when `Cmake: Use Project Status View` is toggled `true`. This will be used for A/B testing the views. [PR #3167](https://github.com/microsoft/vscode-cmake-tools/pull/3167)

Improvements:
- Added ability to select either C or C++ with the Quick Start commmand. [#3183](https://github.com/microsoft/vscode-cmake-tools/pull/3183)

Bug Fixes:
- Handle multiple test results in one test run. [#3160](https://github.com/microsoft/vscode-cmake-tools/pull/3160)
- When starting test and test preset is not selected, prompt for test preset selection. [#3163](https://github.com/microsoft/vscode-cmake-tools/pull/3163)

## 1.14.31
Bug Fixes:
- When `cmake.buildTasks` is `true`, CMake tasks in `tasks.json` that do not specify `targets` will no longer cause the build to fail. [#3123](https://github.com/microsoft/vscode-cmake-tools/issues/3123)
- Paths containing `mingw` are no longer removed from the `PATH` environment variable when configuring a project without specifying a kit. [#3136](https://github.com/microsoft/vscode-cmake-tools/issues/3136)
- Warning messages are no longer triggered by targets containing "warning" in the file path when running `Tasks: Run Build Task`. [#3118](https://github.com/microsoft/vscode-cmake-tools/issues/3118)
- Unable to resolve `cmake-tools-schema:/schemas/CMakePresets*.json`. [#2587](https://github.com/microsoft/vscode-cmake-tools/issues/2587) [#3108](https://github.com/microsoft/vscode-cmake-tools/issues/3108)

## 1.14.30
Bug Fixes:
- Fix extension crashes in the test explorer when `cmake.sourceDir` is a subfolder of `${workspaceFolder}`. [#3121](https://github.com/microsoft/vscode-cmake-tools/issues/3121)

## 1.14.29
Features:
- Test Explorer. [PR #3032](https://github.com/microsoft/vscode-cmake-tools/pull/3032)
- Add commands revealTestExplorer, refreshTests, and refreshTestsAll. [PR #3032](https://github.com/microsoft/vscode-cmake-tools/pull/3032)

Breaking changes:
- The `Run CTest` button in the status bar now only reveals the test explorer, and test results are removed from its text. [PR #3032](https://github.com/microsoft/vscode-cmake-tools/pull/3032)
- All test starting method, such as command `CMake: Run Tests` and test task, now runs through the test explorer. Tests can't run in parallel for now. [PR #3032](https://github.com/microsoft/vscode-cmake-tools/pull/3032)
- Catch test framework support is removed. [PR #3043](https://github.com/microsoft/vscode-cmake-tools/pull/3043)
- Rename `cmake.mingwSearchDirs` to `cmake.additionalCompilerSearchDirs`, make it more general and fix quirks with it. [PR #3056](https://github.com/microsoft/vscode-cmake-tools/pull/3056) [@philippewarren](https://github.com/philippewarren)

Improvements:
- Automatically configure CMake project directories when the kit or the configuration preset is changed. [PR #2973](https://github.com/microsoft/vscode-cmake-tools/pull/2973) [@maxmitti](https://github.com/maxmitti)
- Add an optional description field to kits. [PR #2944](https://github.com/microsoft/vscode-cmake-tools/pull/2944) [@TisziV](https://github.com/TisziV)
- Update documents on `cmake.mingwSearchDirs`. [#2996](https://github.com/microsoft/vscode-cmake-tools/issues/2996)
- When starting debugging, also build the selected build target. [PR #2987](https://github.com/microsoft/vscode-cmake-tools/pull/2987) [@Maddimax](https://github.com/Maddimax)
- Add support for CMake Presets V5. [#2979](https://github.com/microsoft/vscode-cmake-tools/issues/2979)
- Print the build time in the output window. [#3008](https://github.com/microsoft/vscode-cmake-tools/issues/3008)
- Allow using all of MSYS2 MinGW installations, which are also now found by default while scanning for kits if MSYS2 is installed at the default location (`C:\msys64\{wingw64|mingw32|clang64|clang32|clangarm64|ucrt64}\bin`). [PR #3056](https://github.com/microsoft/vscode-cmake-tools/pull/3056) [@philippewarren](https://github.com/philippewarren)

Bug Fixes:
- Check if "CMakeLists.txt" exists after renaming. [#2986](https://github.com/microsoft/vscode-cmake-tools/issues/2986)
- CMake kits fails when parsing exported functions after running environmentSetupScript. [#2676](https://github.com/microsoft/vscode-cmake-tools/issues/2686)
- Implement cmake.parseBuildDiagnostics. [#1932](https://github.com/microsoft/vscode-cmake-tools/issues/1932)
- CMake tools not fully loaded when opening multi-project folders. [#3000](https://github.com/microsoft/vscode-cmake-tools/issues/3000)
- Save the state of multiple projects in the same folder. [PR #3051](https://github.com/microsoft/vscode-cmake-tools/pull/3051)
- Expand variables in task's targets while searching matching taks. [#2970](https://github.com/microsoft/vscode-cmake-tools/issues/2970) [@piomis](https://github.com/piomis)
- Fix typo in `cmake.skipConfigureWhenCachePresent`. [#3040](https://github.com/microsoft/vscode-cmake-tools/issues/3040) [@Mlekow](https://github.com/Mlekow)
- Fix MinGW detection when not in PATH using `cmake.mingwSearchDirs` (now named `cmake.additionalCompilerSearchDirs`). [PR #3056](https://github.com/microsoft/vscode-cmake-tools/pull/3056) [@philippewarren](https://github.com/philippewarren)
- Fix check for `EACCES` error code [#3097](https://github.com/microsoft/vscode-cmake-tools/pull/3097)

## 1.13.45
Bug Fixes:
- Remove unwanted warning "Configuration is already in progress" in multi-root projects. [#2989](https://github.com/microsoft/vscode-cmake-tools/issues/2989)
- `setKitByName` command ignores the workspace folder argument. [PR #2991](https://github.com/microsoft/vscode-cmake-tools/pull/2991)

## 1.13.44
Bug Fixes:
- Compatibility between test and build presets was not enforced. [#2904](https://github.com/microsoft/vscode-cmake-tools/issues/2904)
- Fix problems with updating the code model. [#2980](https://github.com/microsoft/vscode-cmake-tools/issues/2980)
- Validate presets in initialization. [#2976](https://github.com/microsoft/vscode-cmake-tools/issues/2976)

## 1.13.43
Bug Fixes:
- Fix an issue causing the Add Presets commands not to appear. [PR #2977](https://github.com/microsoft/vscode-cmake-tools/pull/2977)

## 1.13.42
Bug Fixes:
- Fix failed activation when using the `cmake.allowUnsupportedPresetsVersions` setting. [#2968](https://github.com/microsoft/vscode-cmake-tools/issues/2968)
- Verify binary directories only if there are multiple sources. [#2963](https://github.com/microsoft/vscode-cmake-tools/issues/2963)
- Update quote function to fix path separator regression [#2974](https://github.com/microsoft/vscode-cmake-tools/pull/2974)

## 1.13.41
Bug Fixes:
- Fix "No folder is open" error when running quick start. [#2951](https://github.com/microsoft/vscode-cmake-tools/issues/2951)
- Add a control statement to the 'quote' function in shlex.ts to return the string without quotes. [#2955]
(https://github.com/microsoft/vscode-cmake-tools/issues/2955)
- CMake Tools fails to initialize the Active Project. [#2952](https://github.com/microsoft/vscode-cmake-tools/issues/2952)

## 1.13.40
Improvements:
- Support multiple projects in a single workspace folder. `cmake.sourceDirectory` setting now allows setting multiple paths. [#1374](https://github.com/microsoft/vscode-cmake-tools/issues/1374)
- Add a setting to disable reading `compile_commands.json`. [#2586](https://github.com/microsoft/vscode-cmake-tools/issues/2586) [@xiaoyun94](https://github.com/xiaoyun94)
- Preset in CMakeUserPresets.json using "condition" does not appear in configure preset selection. [#2749](https://github.com/microsoft/vscode-cmake-tools/issues/2749)
- Resolve workspace variables in `cmake-kits.json`. [#2737](https://github.com/microsoft/vscode-cmake-tools/issues/2737)
- Use upper case drive letters on Windows for `cmake.sourceDirectory`. [PR #2665](https://github.com/microsoft/vscode-cmake-tools/pull/2665) [@Danielmelody](https://github.com/Danielmelody)
- Custom browse configuration should not include (redundant) per-file arguments. [#2645](https://github.com/microsoft/vscode-cmake-tools/issues/2645)
- Support optional generator in `configurePresets` for version 3 and higher. [#2734](https://github.com/microsoft/vscode-cmake-tools/issues/2734) [@jochil](https://github.com/jochil)
- Add a public API for extension authors that depend on CMake Tools. [#494](https://github.com/microsoft/vscode-cmake-tools/issues/494)
- Support explicit typing in `cmake.configureSettings`. [#1457](https://github.com/microsoft/vscode-cmake-tools/issues/1457)
- Scan for kits will now add ARM64 hosts for MSVC. [PR #2887](https://github.com/microsoft/vscode-cmake-tools/pull/2887) [@scaryrawr](https://github.com/scaryrawr)
- Support canceling configuration [#2436](https://github.com/microsoft/vscode-cmake-tools/issues/2436) [@Danielmelody](https://github.com/Danielmelody)
- Pop up "Choose CMakeLists.txt" when user goes to configure while feature set is partially activated. [#2746](https://github.com/microsoft/vscode-cmake-tools/issues/2746)
- Adhere to the setting entry "Parallel Jobs" (`cmake.parallelJobs`) when generating the default build preset. [#2765](https://github.com/microsoft/vscode-cmake-tools/issues/2765) [@maxmitti](https://github.com/maxmitti)
- Add a setting to ignore unknown presets features from the versions that CMake Tools doesn't support yet. [#1963](https://github.com/microsoft/vscode-cmake-tools/issues/1963)

Bug Fixes:
- Fix warning message that appears when using a default build preset with a multi-config generator. [#2353](https://github.com/microsoft/vscode-cmake-tools/issues/2353)
- Update kits documentation. [#2761](https://github.com/microsoft/vscode-cmake-tools/issues/2761) [@jdeaton](https://github.com/jdeaton)
- Avoid calling build tasks for "Clean", "Install" and "Run Tests" commands when "cmake: buildTask" setting is true. [#2768](https://github.com/microsoft/vscode-cmake-tools/issues/2768)
- Generate the correct `configurePresets` for Clang or GCC compilers on Windows. [#2733](https://github.com/microsoft/vscode-cmake-tools/issues/2773)
- CMake Tools does not send `--target=` to cpptools. [#1896](https://github.com/microsoft/vscode-cmake-tools/issues/1896) [#2800](https://github.com/microsoft/vscode-cmake-tools/issues/2800)
- Fix the build task to return the error code. [#2799](https://github.com/microsoft/vscode-cmake-tools/issues/2799) [@BIKA-C](https://github.com/BIKA-C)
- Generate correct ClangCL Kits. [#2790](https://github.com/microsoft/vscode-cmake-tools/issues/2790) [#2810](https://github.com/microsoft/vscode-cmake-tools/issues/2810)
- Cache the version check for the cmake executable. [#2818](https://github.com/microsoft/vscode-cmake-tools/issues/2818)
- ctest -N does not work with custom cmake path from preset. [#2842](https://github.com/microsoft/vscode-cmake-tools/issues/2842)
- Resolve variables in args before passing them to the terminal. [#2846](https://github.com/microsoft/vscode-cmake-tools/issues/2846)
- Quote launch arguments sent to the terminal if they have special characters. [#2898](https://github.com/microsoft/vscode-cmake-tools/issues/2898)
- CMake Tools should choose cmake.exe from the newest VS when it's not found in the PATH. [#2753](https://github.com/microsoft/vscode-cmake-tools/issues/2753)
- Calling build targets from CMake Project Outline always builds default target if useTasks option is set. [#2778](https://github.com/microsoft/vscode-cmake-tools/issues/2768) [@piomis](https://github.com/piomis)
- Fix `${command:cmake.buildType}` so that it returns the right value when using CMake Presets. [#2894](https://github.com/microsoft/vscode-cmake-tools/issues/2894)
- Fix a problem with multi-root projects not activating the configuration provider. [#2915](https://github.com/microsoft/vscode-cmake-tools/issues/2915)
- Remove the default path for `cmake.mingwSearchDirs` since the path is world-writable. [PR #2942](https://github.com/microsoft/vscode-cmake-tools/pull/2942)
- Build command is not able to properly pick-up tasks from tasks.json file if configured with isDefault option and cancellation of running build task is not working. [#2935](https://github.com/microsoft/vscode-cmake-tools/issues/2935) [@piomis](https://github.com/piomis)

## 1.12.27
Bug Fixes:
- Add default target to the build task when target is not defined. [#2729](https://github.com/microsoft/vscode-cmake-tools/issues/2729)

## 1.12.26
Improvements:
- Support for presets version 4. [#2492](https://github.com/microsoft/vscode-cmake-tools/issues/2492) [@chausner](https://github.com/chausner)
- Triggering reconfigure after changes are made to included files. [#2526](https://github.com/microsoft/vscode-cmake-tools/issues/2526) [@chausner](https://github.com/chausner)
- Add target name to terminal window name for launch. [#2613](https://github.com/microsoft/vscode-cmake-tools/issues/2613)
- Add support for "preset" and "env" in task provider. [#2636](https://github.com/microsoft/vscode-cmake-tools/issues/2636) [#2553](https://github.com/microsoft/vscode-cmake-tools/issues/2553) [#2714](https://github.com/microsoft/vscode-cmake-tools/issues/2714) [#2706](https://github.com/microsoft/vscode-cmake-tools/issues/2706)
- Add Craig Scott's "Professional CMake" book to the list of resources in doc/faq.md for learning CMake. [#2679](https://github.com/microsoft/vscode-cmake-tools/pull/2679) [@david-fong](https://github.com/david-fong)

Bug Fixes:
- CMakeUserPresets.json version not detected without CMakePresets.json. [#2469](https://github.com/microsoft/vscode-cmake-tools/issues/2469) [@chausner](https://github.com/chausner)
- Do not prompt to select a Kit if `cmake.configureOnOpen` is `false`. [#2538](https://github.com/microsoft/vscode-cmake-tools/issues/2538)
- Don't delete CMakeCache.txt when switching kits if the buildDirectory also changes. [#2546](https://github.com/microsoft/vscode-cmake-tools/issues/2546) [@david-fong](https://github.com/david-fong)
- Set the working directory for the file api driver. [#2569](https://github.com/microsoft/vscode-cmake-tools/issues/2569)
- Add "description" properties to the cmake.revealLog setting. [#2578](https://github.com/microsoft/vscode-cmake-tools/issues/2578)
- Detect clang-cl.exe compilers that are not bundled with Visual Studio. [#2622](https://github.com/microsoft/vscode-cmake-tools/issues/2622)
- Clear output channel after auto-reconfigure. [#2628](https://github.com/microsoft/vscode-cmake-tools/issues/2628)
- Fix issues with launching the target in PowerShell terminal. [#2650](https://github.com/microsoft/vscode-cmake-tools/issues/2650) [#2621](https://github.com/microsoft/vscode-cmake-tools/issues/2621) [#535](https://github.com/microsoft/vscode-cmake-tools/issues/535)
- Respect VS Code setting "insertSpaces" when updating preset files via GUI. [#2677](https://github.com/microsoft/vscode-cmake-tools/issues/2677)
- CMake install task does not run in terminal. [#2693](https://github.com/microsoft/vscode-cmake-tools/issues/2693)
- Deprecation warnings show up as errors in Problems view. [#2708](https://github.com/microsoft/vscode-cmake-tools/issues/2708)

## 1.11.26
- Revert back to the previous CMake language server extension dependency. [PR #2599](https://github.com/microsoft/vscode-cmake-tools/pull/2599)

Bug Fixes:
- Ninja is used as a default generator. [#2598](https://github.com/microsoft/vscode-cmake-tools/issues/2598)

## 1.11.25
Improvements:
- Fix build Error: EMFILE: too many open files. [#2288](https://github.com/microsoft/vscode-cmake-tools/issues/2288) [@FrogTheFrog](https://github.com/FrogTheFrog)
- Add commands to get preset names. [PR #2433](https://github.com/microsoft/vscode-cmake-tools/pull/2433)
- Add IntelliSense support for `debugConfig.console`. [#2428](https://github.com/microsoft/vscode-cmake-tools/issues/2428)
- Add c++23 support. [#2475](https://github.com/microsoft/vscode-cmake-tools/issues/2475) [@sweemer](https://github.com/sweemer)
- Add support for multiple targets in the CMake task provider. [#2122](https://github.com/microsoft/vscode-cmake-tools/issues/2122)
- Add setting `cmake.showSystemKits`. [PR #2520](https://github.com/microsoft/vscode-cmake-tools/pull/2520) [@bharatvaj](https://github.com/bharatvaj)
- Add support for "Configure", "Install" and "Test" tasks. [#2452](https://github.com/microsoft/vscode-cmake-tools/issues/2452)
- Add setting `cmake.ignoreCMakeListsMissing`. [PR #2537](https://github.com/microsoft/vscode-cmake-tools/pull/2537) [@ilg-ul](https://github.com/ilg-ul)
- Add support for "Clean" and "Clean Rebuild" tasks. [#2555](https://github.com/microsoft/vscode-cmake-tools/issues/2555)
- The extension for CMake language support is replaced. [PR #2267](https://github.com/microsoft/vscode-cmake-tools/pull/2267) [@josetr](https://github.com/josetr)

Bug Fixes:
- `Clean All Projects` menu item builds rather than cleans. [#2460](https://github.com/microsoft/vscode-cmake-tools/issues/2460)
- Update terminal's environment variables when the kit is changed. [#2364](https://github.com/microsoft/vscode-cmake-tools/issues/2364)
- Add timeouts for compiler scanning. [#1289](https://github.com/microsoft/vscode-cmake-tools/issues/1289)
- Fix schema validation for presets version 4. [#2490](https://github.com/microsoft/vscode-cmake-tools/issues/2490)
- Remove problematic environment variables from the debugger environment. [#2442](https://github.com/microsoft/vscode-cmake-tools/issues/2442)
- Fix preferredGenerator "Watcom WMake" not working. [#2500](https://github.com/microsoft/vscode-cmake-tools/issues/2500)
- When `debugConfig` has specific modes or debugger paths set, the linker check heuristic should be skipped. [#2509](https://github.com/microsoft/vscode-cmake-tools/issues/2509)
- Exclude environment variables from debugging if the values have newlines. [#2515](https://github.com/microsoft/vscode-cmake-tools/issues/2515)
- Correctly configure the build environment when using VS 2015 and Ninja in CMakePresets.json. [#2516](https://github.com/microsoft/vscode-cmake-tools/issues/2516)
- Select the correct VS toolset for Ninja generators with CMake Presets. [#2423](https://github.com/microsoft/vscode-cmake-tools/issues/2423)
- Fix unhandled exception with CMakePresets.json. [#2117](https://github.com/microsoft/vscode-cmake-tools/issues/2117)
- Fix issues with compiler argument quoting when configuring IntelliSense. [#2563](https://github.com/microsoft/vscode-cmake-tools/pull/2563)
- Fix clang version detection regexes. [PR #2549](https://github.com/microsoft/vscode-cmake-tools/pull/2549) [@chausner](https://github.com/chausner)

## 1.10.5
Bug Fixes:
- fix "CMake: compile active file" command. [#2438](https://github.com/microsoft/vscode-cmake-tools/issues/2438)

## 1.10.4
Improvements:
- Don't specify number of jobs when building with Ninja. [#696](https://github.com/microsoft/vscode-cmake-tools/issues/696)
- Support for the Ninja Multi-Config generator. [#1423](https://github.com/microsoft/vscode-cmake-tools/issues/1423)
- Minimize build progress notification to the status bar. [#2308](https://github.com/microsoft/vscode-cmake-tools/issues/2308)
- Allow editing Kits when presets are in use. [#1965](https://github.com/microsoft/vscode-cmake-tools/issues/1965)
- Launch the target in the default terminal. [PR #2311](https://github.com/microsoft/vscode-cmake-tools/pull/2311) [@michallukowski](https://github.com/michallukowski)
- Allow launching targets in parallel. [#2240](https://github.com/microsoft/vscode-cmake-tools/issues/2120) [@ColinDuquesnoy](https://github.com/ColinDuquesnoy)

Bug Fixes:
- CMakePrests.json toolset requires the VS version instead of the toolset version. [#1965](https://github.com/microsoft/vscode-cmake-tools/issues/1965)
- CMakePresets should be able to specify a VC toolset by version number. [#2366](https://github.com/microsoft/vscode-cmake-tools/pull/2366)
- CMake task provider does not configure the VS Build environment for Ninja builds. [#2258](https://github.com/microsoft/vscode-cmake-tools/pull/2258)
- `${buildKit}` is not updated after a Kit switch. [#2335](https://github.com/microsoft/vscode-cmake-tools/issues/2335)
- Test the existence of a property instead of the value when expanding preset conditions. [#2329](https://github.com/microsoft/vscode-cmake-tools/issues/2329)
- Include `hostSystemName` in variable expansion when only using User presets. [#2362](https://github.com/microsoft/vscode-cmake-tools/issues/2362)
- Trim whitespace from `environmentSetupScript`. [#2391](https://github.com/microsoft/vscode-cmake-tools/issues/2391)
- Incorrect `cmake.additionalKits` setting breaks CMake extension. [#2382](https://github.com/microsoft/vscode-cmake-tools/issues/2382)
- VS2010 compile errors are not shown in Problems. [#2376](https://github.com/microsoft/vscode-cmake-tools/issues/2376)
- Always rebuilds sources with autodetected clang and ninja on linux. [#2289](https://github.com/microsoft/vscode-cmake-tools/issues/2289)
- Clean Reconfigure All Projects removes wrong files after switching kit. [#2326](https://github.com/microsoft/vscode-cmake-tools/issues/2326)
- Update documentation. [#2334](https://github.com/microsoft/vscode-cmake-tools/pull/2334) [@atsju](https://github.com/atsju)
- Ninja not able to build single-threaded. [#2222](https://github.com/microsoft/vscode-cmake-tools/issues/2222)
- Fix various kit detection issues. [#2246](https://github.com/microsoft/vscode-cmake-tools/issues/2246) [#1759](https://github.com/microsoft/vscode-cmake-tools/issues/1759) [#1653](https://github.com/microsoft/vscode-cmake-tools/issues/1653) [#1410](https://github.com/microsoft/vscode-cmake-tools/issues/1410) [#1233](https://github.com/microsoft/vscode-cmake-tools/issues/1233) [@fourdim](https://github.com/fourdim)
- Stop using `-H` to configure projects. [#2292](https://github.com/microsoft/vscode-cmake-tools/issues/2292)
- `environmentSetupScript` capitalizes environment variable names. [#1592](https://github.com/microsoft/vscode-cmake-tools/issues/1592) [@lygstate](https://github.com/lygstate)
- Debug Target failed when `debugConfig.environment` not present. [#2236](https://github.com/microsoft/vscode-cmake-tools/issues/2236) [@lygstate](https://github.com/lygstate)
- Presets in CMakePresets.json should not inherit from presets in CMakeUserPresets.json. [#2232](https://github.com/microsoft/vscode-cmake-tools/issues/2232)
- Refresh the launch terminal if the user default changes. [PR #2408](https://github.com/microsoft/vscode-cmake-tools/pull/2408)
- Strip BOM from files when reading. [#2396](https://github.com/microsoft/vscode-cmake-tools/issues/2396)
- When using the configuration provider for the C++ extension, the browse configuration was not being updated after code model changes. [#2410](https://github.com/microsoft/vscode-cmake-tools/issues/2410)

## 1.9.2
Bug fixes:
- Fix infinite recursion into symlinks. [#2257](https://github.com/microsoft/vscode-cmake-tools/issues/2257)
- Fix `Show Build Command` for folders that do not use CMake Presets. [#2211](https://github.com/microsoft/vscode-cmake-tools/issues/2211)
- Fix presets not shown when a common dependency is inherited more than once. [#2210](https://github.com/microsoft/vscode-cmake-tools/issues/2210)
- Fix IntelliSense usage of short name from variants file for buildType. [#2120](https://github.com/microsoft/vscode-cmake-tools/issues/2120) [@gost-serb](https://github.com/gost-serb)

## 1.9.1
Bug fixes:
- Fix presets using conditions with macros and inheritance. [#2185](https://github.com/microsoft/vscode-cmake-tools/issues/2185)
- Parallelism no longer working in 1.9.0 for CMake < 3.14.0. [#2181](https://github.com/microsoft/vscode-cmake-tools/issues/2181)
- `CMake: Compile Active File` command stopped working in v1.9.0. [#2180](https://github.com/microsoft/vscode-cmake-tools/issues/2180)
- Exception after successful build when cpptools IntelliSense is disabled. [#2188](https://github.com/microsoft/vscode-cmake-tools/issues/2188)
- Fix issue with presets (v3) and "toolchainFile". [#2179](https://github.com/microsoft/vscode-cmake-tools/issues/2179)
- Don't add `-j` argument when `cmake.parallelJobs` is set to `1`. [#1958](https://github.com/microsoft/vscode-cmake-tools/issues/1958) [@mark-ulrich](https://github.com/mark-ulrich)
- Warn the user about CMAKE_BUILD_TYPE inconsistencies. [#2096](https://github.com/microsoft/vscode-cmake-tools/issues/2096)

## 1.9.0
Improvements:
- Add support for CMakePresets version 3. [#1904](https://github.com/microsoft/vscode-cmake-tools/issues/1904)
- Add diagnostic support for parsing IAR compiler output. [PR #2131](https://github.com/microsoft/vscode-cmake-tools/pull/2131) [@willson556](https://github.com/willson556)
- Add "Log Diagnostics" command. [PR #2141](https://github.com/microsoft/vscode-cmake-tools/pull/2141)
- Add build and configure commands to show cmake commands without running them. [PR #1767](https://github.com/microsoft/vscode-cmake-tools/pull/1767)
- Implement support for merging multiple compile_commands in super-builds sub-folders of the build directory. [PR #2029](https://github.com/microsoft/vscode-cmake-tools/pull/2029) [@Felix-El](https://github.com/Felix-El)
- Add `cmake.allowCommentsInPresetsFile` setting to allow JS style comments in CMakePresets files. [#2169](https://github.com/microsoft/vscode-cmake-tools/issues/2169)

Bug fixes:
- MSVC_VERSION is incorrect when cmake configures with clang-cl. [#1053](https://github.com/microsoft/vscode-cmake-tools/issues/1053) [@tklajnscek](https://github.com/tklajnscek)
- Build error because `binaryDir` removed after configure. [#2128](https://github.com/microsoft/vscode-cmake-tools/issues/2128)
- Configuration from build presets ignored by Intellisense and launch (when using multi config generators). [#2099](https://github.com/microsoft/vscode-cmake-tools/issues/2099)
- Extra {0} output message when having preset with circular inherits. [#2118](https://github.com/microsoft/vscode-cmake-tools/issues/2118)
- CMake-Tools does not reconfigure after a change of CMakeLists.txt in a subdirectory of root. [#1911](https://github.com/microsoft/vscode-cmake-tools/issues/1911) [@AbdullahAmrSobh](https://github.com/AbdullahAmrSobh)
- Fixes msvc2015 detection when only vs2019 are installed. [#1955](https://github.com/microsoft/vscode-cmake-tools/issues/1955) [@lygstate](https://github.com/lygstate)
- Allow for clang compilers to be set in presets without full path. [#1922](https://github.com/microsoft/vscode-cmake-tools/issues/1922)
- Compiler flags containing spaces not passed correctly to IntelliSense. [#1414](https://github.com/microsoft/vscode-cmake-tools/issues/1414)
- Don't scan the whole workspace for CMakeLists.txt, just a few folders. [#2127](https://github.com/microsoft/vscode-cmake-tools/issues/2127)
- Regression with Visual Studio generator and non-default toolset. [#2147](https://github.com/microsoft/vscode-cmake-tools/issues/2147)
- Debug shows "No compiler found in cache file." dialog. [#2121](https://github.com/microsoft/vscode-cmake-tools/issues/2121)
- Unable to work with pre-configured projects (cache is deleted). [#2140](https://github.com/microsoft/vscode-cmake-tools/issues/2140)
- Unknown C/C++ standard control flags: -std=gnu++2b and -std=c2x. [#2150](https://github.com/microsoft/vscode-cmake-tools/issues/2150)
- Select the most recently used build/test preset when configure preset changes. [#1927](https://github.com/microsoft/vscode-cmake-tools/issues/1927)
- Re-enable build target selection when using presets. [#1872](https://github.com/microsoft/vscode-cmake-tools/issues/1872)

## 1.8.1
Bug fixes:
- Command substitutions in launch.json are broken. [#2091](https://github.com/microsoft/vscode-cmake-tools/issues/2091)
- `cmake.configureOnOpen` setting is ignored. [#2088](https://github.com/microsoft/vscode-cmake-tools/issues/2088)
- User-defined preset not shown when inheriting from `CMakePresets.json`. [#2082](https://github.com/microsoft/vscode-cmake-tools/issues/2082)
- Fix presets using server API. [#2026](https://github.com/microsoft/vscode-cmake-tools/issues/2026)

## 1.8.0
Improvements:
- Last selected target isn't read on start up. [#1148](https://github.com/microsoft/vscode-cmake-tools/issues/1148)
- Use cached cmake-file-api response to configure IntelliSense on startup. [#1149](https://github.com/microsoft/vscode-cmake-tools/issues/1149)
- Show a quickPick of all the CMakeLists.txt inside the project (if none exists where "cmake.sourceDirectory" points at). [#533](https://github.com/microsoft/vscode-cmake-tools/issues/533)
- Add command to get the active folder of a workspace. [#1715](https://github.com/microsoft/vscode-cmake-tools/issues/1715) [@guestieng](https://github.com/guestieng)
- Task provider refactoring to best utilize latest updates from VSCode. [PR #1880](https://github.com/microsoft/vscode-cmake-tools/pull/1880)
- Add docker container definition. [PR #1758](https://github.com/microsoft/vscode-cmake-tools/pull/1758)
- Enhance the vsix build with package scripts in package.json. [PR #1752](https://github.com/microsoft/vscode-cmake-tools/pull/1752) [@lygstate](https://github.com/lygstate)

Bug fixes:
- Fix various presets field settings to be passed correctly on to CMake. [#2009](https://github.com/microsoft/vscode-cmake-tools/issues/2009)
- Check for target architecture when reading toolchain FileAPI. [#1879](https://github.com/microsoft/vscode-cmake-tools/issues/1879)
- Fix environment variable in debugging docs. [PR #1874](https://github.com/microsoft/vscode-cmake-tools/pull/1874) [@zariiii9003](https://github.com/zariiii9003)
- Fix typo in variant docs. [PR #1970](https://github.com/microsoft/vscode-cmake-tools/pull/1970) [@melak47](https://github.com/melak47)
- Update schema for preset cache variable CMAKE_BUILD_TYPE. [#1934](https://github.com/microsoft/vscode-cmake-tools/issues/1934)
- Fix regression in ctestDefaultArgs (ctest hardcoded directives: -T, test, --output-on-failure). [#1956](https://github.com/microsoft/vscode-cmake-tools/issues/1956)
- Don't throw when unknown diagnostics apepar. [#1796](https://github.com/microsoft/vscode-cmake-tools/issues/1796)
- Add parse target triple to fix "bad clang binary" error. [#1916](https://github.com/microsoft/vscode-cmake-tools/issues/1916) [@lygstate](https://github.com/lygstate)
- Include CMAKE_BUILD_TYPE in the generated text of configure preset. [#1847](https://github.com/microsoft/vscode-cmake-tools/issues/1847)
- Show also the "hidden" presets in the "Inherit from configure presets" quick pick. [#1923](https://github.com/microsoft/vscode-cmake-tools/issues/1923)
- Clang-cl diagnostics don't appear in Problems view. [#517](https://github.com/microsoft/vscode-cmake-tools/issues/517) [@ki-bo](https://github.com/ki-bo)
- Fix duplication in name of MSVC versus LLVM Clang kit. [PR #1951](https://github.com/microsoft/vscode-cmake-tools/pull/1951) [@lygstate](https://github.com/lygstate)
- Fixes output encoding in the vcvars setup process. [PR #1985](https://github.com/microsoft/vscode-cmake-tools/pull/1985) [@lygstate](https://github.com/lygstate)
- Remove vendor support since the string expansion is wrong for it. [#1966](https://github.com/microsoft/vscode-cmake-tools/issues/1966)
- Add configure preset environment to debug/launch. [#1884](https://github.com/microsoft/vscode-cmake-tools/issues/1884)
- Fix msvc2015 detection when only vs2019 is installed. [#1905](https://github.com/microsoft/vscode-cmake-tools/issues/1905) [@lygstate](https://github.com/lygstate)
- Prevent file index overwritting in multi-config generators. [#1800](https://github.com/microsoft/vscode-cmake-tools/issues/1800) [@andredsm](https://github.com/andredsm)
- Various cache variables edit/save fixes. [PR #1826](https://github.com/microsoft/vscode-cmake-tools/pull/1826) [@aemseemann](https://github.com/aemseemann)
- Use JSON as the language mode of preset files. [#2035](https://github.com/microsoft/vscode-cmake-tools/issues/2035)
- Fix broken links to contributing file. [PR #2016](https://github.com/microsoft/vscode-cmake-tools/pull/2016) [@andredsm](https://github.com/andredsm)
- Kit scan generates incorrect kits for VS 2022 [#2054](https://github.com/microsoft/vscode-cmake-tools/issues/2054)
- Fix presets for msvc compilers with x86 outputs [PR #2072](https://github.com/microsoft/vscode-cmake-tools/pull/2072)

## 1.7.3
Bug fixes:
- Make sure CMake Tools configuration provider gets registered with presets on. [#1832](https://github.com/microsoft/vscode-cmake-tools/issues/1832)
- Add the license field to package.json. [#1823](https://github.com/microsoft/vscode-cmake-tools/issues/1823)
- Add title to "Select target" quickpick. [#1860](https://github.com/microsoft/vscode-cmake-tools/issues/1860)

## 1.7.2
Bug fixes:
- Fix paths of target sources outside the workspace. [#1504](https://github.com/microsoft/vscode-cmake-tools/issues/1504) [@sleiner](https://github.com/sleiner)
- Use stricter type checks in presets expansion. [#1815](https://github.com/microsoft/vscode-cmake-tools/issues/1815)
- Solve conflict between -DCMAKE_GENERAOR:STRING=Ninja versus -G "Visual Studio 16 2019" -A x64. [PR #1753](https://github.com/microsoft/vscode-cmake-tools/pull/1753) [@lygstate](https://github.com/lygstate)
- Fix operator precedence when getting code page. [#1615](https://github.com/microsoft/vscode-cmake-tools/issues/1615) [@taoyouh](https://github.com/taoyouh)
- Override the locale when querying compiler versions. [#1821](https://github.com/microsoft/vscode-cmake-tools/issues/1821)
- Fix typo in CMakePresets.json schema. [PR #1809](https://github.com/microsoft/vscode-cmake-tools/pull/1809) [@bluec0re](https://github.com/bluec0re)


## 1.7.1
Improvements:
- CppTools-API v5 integration. [#1624](https://github.com/microsoft/vscode-cmake-tools/issues/1624)

Bug fixes:
- Correct macros evaluation in inherited presets. [#1787](https://github.com/microsoft/vscode-cmake-tools/issues/1787)
- Macro expansions should consider environment variables defined in the kit. [#1250](https://github.com/microsoft/vscode-cmake-tools/issues/1250)
- Fix 1.7.0 IntelliSense regression related to default standard and CppTools provider version. [#1788](https://github.com/microsoft/vscode-cmake-tools/issues/1788)
- Correct folder information for presets in multi-root projects. [PR #1785](https://github.com/microsoft/vscode-cmake-tools/pull/1785)


## 1.7.0
Improvements:
- Support for CMake Presets. [#529](https://github.com/microsoft/vscode-cmake-tools/issues/529)
- Support for File API "toolchains" object.
- User defined additional kits. [PR #1701](https://github.com/microsoft/vscode-cmake-tools/pull/1701) [@mjvankampen](https://github.com/mjvankampen)
- Touchbar extra functionality. [PR #1693](https://github.com/microsoft/vscode-cmake-tools/pull/1693) [@poterba](https://github.com/poterba)

Bug fixes:
- Can not compile active file if definition has quoted text. [#969](https://github.com/microsoft/vscode-cmake-tools/issues/969)
- Compiler flags containing spaces not passed correctly to IntelliSense. [#1414](https://github.com/microsoft/vscode-cmake-tools/issues/1414)
- Gcc/clang version analysis improvements. [#1575](https://github.com/microsoft/vscode-cmake-tools/issues/1575)
- Disable the extension when no CMakeLists is present. [#1578](https://github.com/microsoft/vscode-cmake-tools/issues/1578)
- Remove the "CMake Tools initializing" popup message. [#1518](https://github.com/microsoft/vscode-cmake-tools/issues/1518)
- Allow CppTools to chose a C/Cpp standard default. [#1477](https://github.com/microsoft/vscode-cmake-tools/issues/1477)
- Added ${workspaceHash} variable. [PR #1055](https://github.com/microsoft/vscode-cmake-tools/pull/1055) [@Zingam](https://github.com/Zingam)
- Setup CMT_MINGW_PATH properly on win32. [PR #1611](https://github.com/microsoft/vscode-cmake-tools/pull/1611) [@lygstate](https://github.com/lygstate)
- Codespaces specific changes of configureOnOpen default and popup UI. [#1676](https://github.com/microsoft/vscode-cmake-tools/issues/1676)
- Fixes environment expanding and document testEnvironment. [PR #1598](https://github.com/microsoft/vscode-cmake-tools/pull/1598) [@lygstate](https://github.com/lygstate)
- Pass cmake.debugConfig.args to launch target. [PR #1603](https://github.com/microsoft/vscode-cmake-tools/pull/1603) [@jbdamiano](https://github.com/jbdamiano)
- Dependencies package versions upgrade. [PR #1475](https://github.com/microsoft/vscode-cmake-tools/pull/1475) [@lygstate](https://github.com/lygstate)
- Add vendor hostOs targetOs targetArch versionMajor versionMinor attributes for kit. [PR #1337](https://github.com/microsoft/vscode-cmake-tools/pull/1337) [@lygstate](https://github.com/lygstate)
- Always correctly build target executable path. [PR #1674](https://github.com/microsoft/vscode-cmake-tools/pull/1674) [@falbrechtskirchinger](https://github.com/falbrechtskirchinger)
- Use variables instead of hardcoded values for system path references. [#883](https://github.com/microsoft/vscode-cmake-tools/issues/883) [@Zingam](https://github.com/Zingam)
- ctestPath should allow the same substitutions as cmakePath. [#785](https://github.com/microsoft/vscode-cmake-tools/issues/785) [@FakeTruth](https://github.com/FakeTruth)
- Change the order of available kits such that folder kits come first. [#1736](https://github.com/microsoft/vscode-cmake-tools/issues/1736)
- Fix "Configuring project" infinite loop when using "Locate" on a project without CMakeLists.txt. [#1704](https://github.com/microsoft/vscode-cmake-tools/issues/1704)
- Fix problems with using gdb debugger on MAC. [#1691](https://github.com/microsoft/vscode-cmake-tools/issues/1691)
- Fix parsing of target architecture flags with values that include arm64. [#1735](https://github.com/microsoft/vscode-cmake-tools/issues/1735)
- Changed ctest --output-on-failure from hardcode to default argument. [PR #1729](https://github.com/microsoft/vscode-cmake-tools/pull/1729) [@PedroLima92](https://github.com/PedroLima92)
- Update cmake-settings.md document. [PR #1754](https://github.com/microsoft/vscode-cmake-tools/pull/1754) [@lygstate](https://github.com/lygstate)


## 1.6.0
Bug Fixes:
- Fix Clang kit detection when version is at end of line. [#1342](https://github.com/microsoft/vscode-cmake-tools/issues/1342) [@falbrechtskirchinger](https://github.com/falbrechtskirchinger)
- Fix cache variables regular expression dealing with '='. [#1613](https://github.com/microsoft/vscode-cmake-tools/issues/1613)
- Add cmake.exportCompileCommandFile. [#1440](https://github.com/microsoft/vscode-cmake-tools/issues/1440)
- Fix the regexp of Gcc/Clang version to account for localization and more possible text patterns. [#1575](https://github.com/microsoft/vscode-cmake-tools/issues/1575)
- Fix regexp for compiler flags that contain spaces. [#1414](https://github.com/microsoft/vscode-cmake-tools/issues/1414)
- Fix compile active file when definition has quoted text. [#969](https://github.com/microsoft/vscode-cmake-tools/issues/969)
- Re-register the tasks provider when the current build targe changes. [#1576](https://github.com/microsoft/vscode-cmake-tools/issues/1576)
- Don't localize the VS Clang kit name. [PR #1632](https://github.com/microsoft/vscode-cmake-tools/pull/1632)
- Remove CMake Tools activation of non CMake projects when tasks.runask is executed. [PR #1642](https://github.com/microsoft/vscode-cmake-tools/pull/1642)
- Add the TWXS CMake extension in the CMake Tools extension pack. [PR #1643](https://github.com/microsoft/vscode-cmake-tools/pull/1643)

## 1.5.3
Bug Fixes:
- "Clean all projects" broken since 1.5.0. [#1542](https://github.com/microsoft/vscode-cmake-tools/issues/1542)
- CMake task provider should not attempt to register until the CMake driver is available.  [#1549](https://github.com/microsoft/vscode-cmake-tools/issues/1549)

## 1.5.2
Bug Fixes:
- Fix deadlock caused by commands invoked in string expansion during activation. [PR #1532](https://github.com/microsoft/vscode-cmake-tools/pull/1532)

## 1.5.1
Bug Fixes:
- Fix regular expression for variables values used in settings and kits json. [#1526](https://github.com/microsoft/vscode-cmake-tools/issues/1526) [#1525](https://github.com/microsoft/vscode-cmake-tools/issues/1525)
- Add a setting to control whether the Touch Bar is visible or not. [PR #1529](https://github.com/microsoft/vscode-cmake-tools/pull/1529)

## 1.5.0
Improvements:
- Support variables for Kit.toolchainFile. [PR #991](https://github.com/microsoft/vscode-cmake-tools/pull/991) [#1056](https://github.com/microsoft/vscode-cmake-tools/issues/1056) [@blakehurd](https://github.com/blakehurd)/[@bobbrow](https://github.com/bobbrow)
- Implement cmake:hideBuildCommand context option. [PR #1355](https://github.com/microsoft/vscode-cmake-tools/pull/1355) [@tritao](https://github.com/tritao)
- Add option to set CMAKE_BUILD_TYPE also on multi-config generators. [PR #1393](https://github.com/microsoft/vscode-cmake-tools/pull/1393) [@tonka3000](https://github.com/tonka3000)
- Detect Clang for MSVC (GNU CLI) kits. [#823](https://github.com/microsoft/vscode-cmake-tools/issues/823) [@omcnoe](https://github.com/omcnoe)
- GUI support for CMake Tools cache. [#513](https://github.com/microsoft/vscode-cmake-tools/issues/513) [@nieroger](https://github.com/nieroger)
- Tasks support. [PR #1268](https://github.com/microsoft/vscode-cmake-tools/pull/1268) [@vptrbv](https://github.com/vptrbv)
- MacBook Pro touchbar support. [#499](https://github.com/microsoft/vscode-cmake-tools/issues/499) [@vptrbv](https://github.com/vptrbv)

Bug Fixes:
- Set right base_path for variant config files. [PR #1462](https://github.com/microsoft/vscode-cmake-tools/pull/1462) [@leolcao](https://github.com/leolcao)
- Inconsistent buildType substitution. [#1366](https://github.com/microsoft/vscode-cmake-tools/issues/1366)
- ${workspaceFolder} is not working for "environmentSetupScript" option. [#1309](https://github.com/microsoft/vscode-cmake-tools/issues/1309) [@Yaxley123](https://github.com/Yaxley123)
- Preserve focus when executing "CMake:Run Without Debugging". [#1138](https://github.com/microsoft/vscode-cmake-tools/issues/1138) [@estshorter](https://github.com/estshorter)
- Problems with CMake: Quick Start. [#1004](https://github.com/microsoft/vscode-cmake-tools/issues/1004) [@alan-wr](https://github.com/alan-wr)
- Remove depends on optimist by upgrade handlebars. [PR #1447](https://github.com/microsoft/vscode-cmake-tools/pull/1447) [@lygstate](https://github.com/lygstate)
- Ignore the vcvars dev-bat call result. [PR #1403](https://github.com/microsoft/vscode-cmake-tools/pull/1403) [@lygstate](https://github.com/lygstate)
- Fix vs2010 which doesn't recognize host=x64. [PR #1481](https://github.com/microsoft/vscode-cmake-tools/pull/1481) [@lygstate](https://github.com/lygstate)
- Don't rebuild when doing command substitution. [#1487](https://github.com/microsoft/vscode-cmake-tools/issues/1487)
- Duplicate compiler flags should not be removed. [PR #1497](https://github.com/microsoft/vscode-cmake-tools/issues/1497)
- Hide "Unknown Language" for CUDA source files. [PR #1502](https://github.com/microsoft/vscode-cmake-tools/issues/1502) [@Synxis](https://github.com/Synxis)
- Ensure immediate effect of settings for communication mode and all generator related. [PR #1500](https://github.com/microsoft/vscode-cmake-tools/issues/1500)
- Fix shell script and vcvars devbat when TEMP folder has a space in the middle. [#1492](https://github.com/microsoft/vscode-cmake-tools/issues/1492)

## 1.4.2
Improvements:
- Added new variable substitution command: `${command:cmake.launchTargetFilename}`. [#632](https://github.com/microsoft/vscode-cmake-tools/issues/632) [@ebai101](https://github.com/ebai101)
- Add output parser for Wind River Diab compiler. [PR #1267](https://github.com/microsoft/vscode-cmake-tools/pull/1267) [@ce3a](https://github.com/ce3a)
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
