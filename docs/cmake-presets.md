# Configure and build with CMake Presets 

CMake supports two files, `CMakePresets.json` and `CMakeUserPresets.json`, that allow users to specify common configure, build, and test options and share them with others.

` `CMakePresets.json`` and `CMakeUserPresets.json` can be used to drive CMake in Visual Studio and Visual Studio Code, in a Continuous Integration (CI) pipeline, and from the command line. `CMakePresets.json` is intended to save project-wide builds, and `CMakeUserPresets.json` is intended for developers to save their own local builds.

This article contains information about `CMakePresets.json` integration in the CMake Tools extension for Visual Studio Code. For more information on the format of `CMakePresets.json`, see the official [CMake Tools documentation](README.md).  For more information on the Microsoft vendor maps and macro expansion, see <JTW `CMakePresets.json` Microsoft vendor maps>. For more information on how to use `CMakePresets.json` in Visual Studio, see <JTW `CMakePresets.json` in Visual Studio>.

`CMakePresets.json` is a recommended alternative to kits and variants files. See <JTW Enable `CMakePresets.json` in the CMake Tools extension> to enable or disable `CMakePresets.json` integration in the CMake Tools extension.

## Supported CMake and `CMakePresets.json` versions

The CMake Tools extension supports `CMakePresets.json` and `CMakeUserPresets.json` files version 2 or higher. You can update your file version by incrementing the version field in the root object. For an example and more information, see [`CMakePresets.json`](https://cmake.org/cmake/help/latest/manual/cmake-presets.7.html#format).

CMake version 3.20 or higher is required when invoking CMake with `CMakePresets.json` (version 2 or higher) from the command line. CMake Tools reads and evaluates `CMakePresets.json` and `CMakeUserPresets.json`, and does not invoke CMake directly with the `--preset` option. This means CMake version 3.20 or higher is not strictly required when building with `CMakePresets.json` inside Visual Studio Code. We recommend using at least CMake version 3.14 or higher.  

## Enable `CMakePresets.json` in the CMake Tools extension

A new setting, `cmake.useCMakePresets`, has been added to `settings.json`:

|Setting  |Description  |Accepted values  | Default value |
|---------|---------|---------|---------|
|`cmake.useCMakePresets` |  Drive CMake configure, build, and test | `true`, `false`, `auto` | `auto` |

`auto` : evaluates to `true` if there's a `CMakePresets.json` file in the `cmake.sourceDirectory` in the active folder. It evaluates to `false` if there isn't a `CMakePresets.json` file in the `cmake.sourceDirectory` in the active folder. Set `cmake.useCMakePresets` to `true` or `false` to explicitly enable or disable `CMakePresets.json` integration for all CMake projects.

## Configure and build

You can configure and build your CMake project with a series of commands. Open the command palette in Visual Studio Code with `Ctrl+Shift+P`:

![Command pallette: Select Configure Preset](images/command-palette.png)

**CMake: Select Configure Preset** lists the union of non-hidden Configure Presets defined in `CMakePresets.json` and `CMakeUserPresets.json`. Select a Configure Preset to make it the active Configure Preset. This is the `configurePreset` used when CMake is invoked to generate the project build system. The active Configure Preset is displayed in the status bar.

CMake Tools uses the value of `hostOS` in the Microsoft Visual Studio Settings vendor map to hide Configure Presets that don't apply to your platform. See the <JTW Visual Studio Settings vendor map> for more information.

## CMake: Configure

To configure the project, run **CMake: Configure** from the command palette. This is the same as running `cmake --preset <configurePreset>` from the command line, where `<configurePreset>` is the name of the active Configure Preset.

## CMake: Select Build Preset

**CMake: Select Build Preset** lists the Default Build Preset and the union of non-hidden Build Presets defined in `CMakePresets.json` and `CMakeUserPresets.json`. The Default Build Preset is equivalent to passing `cmake --build` with no additional arguments from the command line. Select a Build Preset to make it the active Build Preset. This is the `buildPreset` used when CMake is invoked to build the project. The active Build Preset is displayed in the status bar.

All Build Presets are required to specify an associated configurePreset. CMake Tools will hide Build Presets that do not apply to the active Configure Preset. For more information, see [Build Presets](https://cmake.org/cmake/help/latest/manual/cmake-presets.7.html#build-preset) for more information.

## CMake: Build

Run **CMake: Build** from the command palette to build the entire project. This is the same as running `cmake --build --preset <buildPreset>` from the command line, where `<buildPreset>` should be replaced by the name of the active Build Preset.

Run **CMake: Build Target** from the command palette to build a single target. You can switch the active build target with **CMake: Set Build Target**.

> [!NOTE]
> CMake Tools doesn't yet support the **buildPresets.targets** option to build a subset of targets specified in `CMakePresets.json`.

## Test

CTest is the CMake test driver program and is integrated with the CMake Tools extension. For more information, see the [CTest documentation](https://cmake.org/cmake/help/latest/manual/ctest.1.html#ctest-1) for more information.

## CMake: Select Test Preset

**CMake: Select Test Preset** lists the Default Test Preset and the union of non-hidden Test Presets defined in `CMakePresets.json` and `CMakeUserPresets.json`. The Default Test Preset is the same as invoking `ctest` with no additional arguments from the command line.

Select a Test Preset to make it the active Test Preset. This is the `testPreset` that will be used when CTest is invoked to run tests. The active Test Preset is displayed in the status bar.

All Test Presets are required to specify an associated `configurePreset`. CMake Tools will hide Test Presets that do not apply to the active Configure Preset. For more information, see [Test Presets](https://cmake.org/cmake/help/latest/manual/cmake-presets.7.html#test-preset).

## CMake: Run Tests

To show or hide individual status bar icons, modify `cmake.statusbar.advanced` in `settings.json`.

## Add new presets

All commands and preset templates modify `CMakePresets.json`. You can add new user-level presets by directly editing `CMakeUserPresets.json`
We recommend using forward slashes (`/`) for paths in `CMakePresets.json` and `CMakeUserPresets.json`.

## Add new Configure Presets

To add a new Configure Preset to `CMakePresets.json`, run the **CMake: Add Configure Preset** command. This lists several Configure Preset templates, and an option to **[Scan for Compilers]** in the command palette. **[Scan for Compilers]** returns all of the GCC and Clang compilers on your `PATH`, all compilers found in `cmake.mingwSearchDir` and `cmake.emscriptenSearchDirs`, and the latest instances of `cl.exe` installed with Visual Studio.

![Add a configure preset](images/add-configure-preset-vscode.png)

* Select **Inherit from Configure Preset** to inherit from an existing Configure Preset. For more information about inheritance, see [Configure Presets](https://cmake.org/cmake/help/latest/manual/cmake-presets.7.html#configure-preset).
* Select the **Toolchain File** template to configure your CMake project with a CMake toolchain file.
* Select the **Custom** template to configure an empty Configure Preset.
* Select **[Scan for Compilers]** to search for C/C++ compilers on your machine.

The selected template will be added to `CMakePresets.json` if `CMakePresets.json` exists. Otherwise, the template will be copied into a new `CMakePresets.json`. See <JTW Edit presets> for more information on editing Configure Presets.

> [!Note] Windows developers: CMake Tools selects the most recent version of `cl.exe` installed by default. You can specify a specific compiler version with the toolset option in `CMakePresets.json`. See JTW [Configure Presets and Toolset Selection]() for more information. If CMake and your generator are not installed with Visual Studio, then they will need to be on your `PATH` or in the default installation folder.

## Add new Build Presets

To add a new Test Preset to `CMakePresets.json`, run the **CMake: Add Test Preset** command. This lists several Test Preset templates in the command palette.
* Select **Create from Configure Preset** to display a list of `configurePresets` defined in `CMakePresets.json`. Once you select a Configure Preset, an empty Test Preset associated with the selected Configure Preset will be created. 
* Select **Inherit from Test Preset** to display a list of testPresets defined in `CMakePresets.json`. Once you select a Test Preset, a new Test Preset that inherits from the selected Test Preset will be created.
* Select the **Custom** template to configure an empty Test Preset.
For more information about editing Test Presets, see [Test Presets](https://cmake.org/cmake/help/latest/manual/cmake-presets.7.html#test-preset).

## Edit presets

The official [CMake documentation](https://cmake.org/cmake/help/latest/manual/cmake-presets.7.html#id1) is the best resource for editing Configure Presets, Build Presets, and Test Presets. The following information is a subset of the CMake documentation that covers common actions.

**Select your compilers**
C and C++ compilers can be set with `cacheVariables.CMAKE_C_COMPILER` and `cacheVariables.CMAKE_CXX_COMPILER` in a Configure Preset. This is equivalent to passing `-D CMAKE_C_COMPILER=<value> and -D CMAKE_CXX_COMPILER=<value>` to CMake from the command line. For more information, see [CMAKE_<LANG>_COMPILER](https://cmake.org/cmake/help/latest/variable/CMAKE_LANG_COMPILER.html#cmake-lang-compiler). You can specify the name of a compiler on your `PATH` or an environment variable that evaluates to the full path of a compiler. Full paths are discouraged so that the file will remain shareable.

When you build with the Visual C++ toolset, CMake Tools automatically sources the environment from the latest version of the Visual Studio Build Tools installed on your system. You can specify a specific compiler version with the `toolset` option in `CMakePresets.json`. For more information, see [Configure Presets and Toolset Selection](https://cmake.org/cmake/help/latest/manual/cmake-toolchains.7.html).

A preset that builds for 64-bit Windows with cl.exe and a Visual Studio generator might look like this.

```json
"architecture": {
   "value": "x64",
   "strategy": "set"
},
"cacheVariables": {
   "CMAKE_BUILD_TYPE": "Debug",
   "CMAKE_C_COMPILER": "cl",
   "CMAKE_CXX_COMPILER": "cl",
   "CMAKE_INSTALL_PREFIX": "${sourceDir}/out/install/${presetName}"
 },
 ```

A preset that builds with GCC version 8 on Linux or macOS might look like this.

```json
"cacheVariables": {
    "CMAKE_BUILD_TYPE": "Debug",
    "CMAKE_INSTALL_PREFIX": "${sourceDir}/out/install/${presetName}",
    "CMAKE_C_COMPILER": "gcc-8",
    "CMAKE_CXX_COMPILER": "g++-8"
}
```

You can also set compilers with a CMake toolchain file. Toolchain files can be set with `cacheVariables.CMAKE_TOOLCHAIN_FILE`, which is equivalent to passing `-D CMAKE_TOOLCHAIN_FILE=<value>` to CMake from the command line. A CMake toolchain file is most often used for cross-compilation. See [CMake toolchains](https://cmake.org/cmake/help/latest/manual/cmake-toolchains.7.html) for more information on authoring CMake toolchain files.

## Select your generator

Configure Preset templates default to the Visual Studio generator on Windows, and Ninja on Linux and macOS. You can specify a new generator with the generator option in a Configure Preset. This is equivalent to passing `-G` to CMake from the command line. See [CMake generators](https://cmake.org/cmake/help/latest/manual/cmake-generators.7.html#:~:text=A%20CMake%20Generator%20is%20responsible%20for%20writing%20the,what%20native%20build%20system%20is%20to%20be%20used) for more information.

> [!Note] Windows developers: If Ninja is not installed with Visual Studio, then it will need to be on your `PATH`. Make sure to set `architecture.strategy` and `toolset.strategy` to external when building with a command line generator like Ninja on Windows.

## Set and reference environment variables

You can set environment variables using the environment map. Environment variables are inherited through the inherits field, but you can override them as desired. A preset’s environment will be the union of its own environment and the environment from all its parents. If multiple `inherits` presets provide conflicting values for the same variable, the earlier preset in the `inherits` list will be preferred. You can unset a variable inherited from another preset by setting it to `null`.

Environment variables set in a Configure Preset also automatically flow through to associated Build Presets and Test Presets unless `inheritConfigureEnvironment` is set to `false`. See [Configure Presets](https://cmake.org/cmake/help/latest/manual/cmake-generators.7.html#:~:text=A%20CMake%20Generator%20is%20responsible%20for%20writing%20the,what%20native%20build%20system%20is%20to%20be%20used) for more information.

You can reference environment variables using the `$env{<variable-name>}` and `$penv{<variable-name>}` syntax. See [Macro Expansion](https://cmake.org/cmake/help/latest/manual/cmake-presets.7.html#macro-expansion) for more information.

Select your target and host architecture when building with the Visual C++ toolset
The target architecture (x64, Win32, ARM64, or ARM) can be set with `architecture.value`. This is equivalent to passing `-A` to CMake from the command line. See [Platform Selection](https://cmake.org/cmake/help/latest/generator/Visual Studio 16 2019.html#platform-selection) for more information.

> [!Note] Currently Visual Studio Generators expect the Win32 syntax and command line generators (like Ninja) expect the x86 syntax when building for x86.

The host architecture (x64 or x86) and toolset can be set with `toolset.value`. This is equivalent to passing `-T` to CMake from the command line. See [Toolset Selection](https://cmake.org/cmake/help/latest/generator/Visual Studio 16 2019.html#toolset-selection) for more information.

`architecture.strategy` and `toolset.strategy` tell CMake how to handle the architecture and toolset fields. `set` means CMake will set the respective value. `external` means CMake will not set the respective value. `set` should be used with IDE generators like the Visual Studio Generator. `external` should be used with command line generators like Ninja. This allows vendors like Visual Studio to source the required environment before CMake is invoked. See [Configure Presets](https://cmake.org/cmake/help/latest/manual/cmake-presets.7.html#configure-preset) for more information about the `architecture` and `toolset` fields.

For a full list of IDE generators that support the `architecture` field, see [CMAKE_GENERATOR_PLATFORM](https://cmake.org/cmake/help/latest/variable/CMAKE_GENERATOR_PLATFORM.html). For a full list of IDE generators that support the toolset field, see [CMAKE_GENERATOR_TOOLSET](https://cmake.org/cmake/help/latest/variable/CMAKE_GENERATOR_TOOLSET.html).

## Vcpkg integration

Vcpkg helps you manage C and C++ libraries on Windows, Linux, and macOS. A vcpkg toolchain file (`vcpkg.cmake`) must be passed to CMake to enable vcpkg integration. See the [vcpkg documentation](https://github.com/microsoft/vcpkg#vcpkg-overview) for more information. We recommend setting the path to `vcpkg.cmake` with the `VCPKG_ROOT` environment variable in `CMakePresets.json`:

```json
"cacheVariables": {
   "CMAKE_TOOLCHAIN_FILE": {
      "value": "$env{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake",
       "type": "FILEPATH"
    }
 },
```

`VCPKG_ROOT` should be set to the root of your vcpkg installation. See [vcpkg environment variables](https://github.com/microsoft/vcpkg/blob/master/docs/users/config-environment.md) for more information.

If you are already using a CMake toolchain file and want to enable vcpkg integration, then see [Using multiple toolchain files](https://github.com/microsoft/vcpkg/blob/master/docs/users/integration.md#using-multiple-toolchain-files) and follow those instructions to use an external toolchain file with a project using vcpkg.

## Command substitution in launch.json and settings.json

CMake Tools supports command substitution for launch commands when `CMakePresets.json` integration is enabled. See [Command substitution](https://github.com/microsoft/vscode-cmake-tools/blob/develop/docs/cmake-settings.md#command-substitution) for more information.

## Ignored settings

`CMakePresets.json` should be the source of truth for all setting related to configure, build, and test. This eliminates behavior specific to Visual Studio Code and ensures that your CMake and CTest invocations can be reproduced from the command line. The following settings in settings.json either duplicate options in `CMakePresets.json`, or no longer apply. 

The following settings will be ignored when `CMakePresets.json` integration is enabled. Ignored settings will be logged to the Output Window when you run **CMake: Configure**.


| Ignored setting in settings.json | `CMakePresets.json` equivalent |
|--|--|
| 'cmake.buildArgs` | Various options in `buildPreset` |
| 'cmake.buildDirectory` | `configurePresets.binaryDir` |
| 'cmake.buildEnvironment` | `buildPresets.environment` |
| 'cmake.buildToolsArgs` | `buildPresets.nativeToolOptions` |
| 'cmake.cmakePath` | `configurePresets.cmakeExecutable` |
| 'cmake.configureArgs` | Various options in a `configurePreset` |
| 'cmake.configureEnvironment` | `configurePresets.environment` |
| 'cmake.configureSettings` | `configurePresets.cacheVariables` |
| 'cmake.ctestParallelJobs` | `testPresets.execution.jobs` |
| 'cmake.ctestArgs` | Various options in a `testPreset` |
| 'cmake.defaultVariants` | Doesn't apply |
| 'cmake.environment` | `configurePresets.environment` |
| 'cmake.generator` | `configurePresets.generator` |
| 'cmake.ignoreKitEnv` | Doesn't apply |
| 'cmake.installPrefix` | `configurePresets.cacheVariables.CMAKE_INSTALL_PREFIX` |
| 'cmake.parallelJobs` | buildPresets.jobs |
| 'cmake.platform` | 'configurePresets.architecture` |
| 'cmake.preferredGenerators` | `configurePresets.generator` |
| 'cmake.setBuildTypeOnMultiConfig` | 'configurePresets.cacheVariables.CMAKE_BUILD_TYPE` |
| 'cmake.testEnvironment` | `testPresets.environment` |
| `cmake.toolset` | `configurePresets.toolset` |

## Unsupported commands

The following commands are not supported when `CMakePresets.json` integration is enabled:
* **CMake: Quick Start**
* **CMake: Select Variant**
* **CMake: Scan for Kits**
* **CMake: Select a Kit**
* **CMake: Edit User-Local CMake Kits**

## Troubleshooting

If things aren’t working as expected, there are a few troubleshooting steps that you can take.

If either `CMakePresets.json` or `CMakeUserPresets.json` is invalid, then none of the presets in the invalid file will be available for selection. CMake Tools IntelliSense can help you catch many of these JSON errors, but it won’t know if you are referencing a preset with `inherits` or `configurePreset` by the wrong name. To check if your preset files are valid, run `cmake --list-presets` from the command line at the root of your project directory (CMake 3.20 or higher is required). If either file is invalid, then you will see the following error:

```DOS
CMake Error: Could not read presets from
C:/Users/<user>/source/repos/<project-name>: JSON parse error
```

If you are working on Windows then CMake must be on the `PATH`.
Other troubleshooting steps include:
* Confirm cmake.exe and your generator are installed and on the `PATH`.
* Delete the cache and reconfigure the project (**CMake: Delete Ca* and Reconfigure**)
* Reset the CMake Tools extension state (**CMake: Reset CMake Tool* Extension State**)
* Increase the logging level (`cmake.loggingLevel` in `settings.json`) and/or check the log file (**CMake: Open the CMake Tools Log File**)

If you have identified a problem, the best way to report it is by submitting an issue to the [CMake Tools extension repository](https://github.com/microsoft/vscode-cmake-tools).

## Run CMake from the command line or a Continuous Integration (CI) pipeline

You can use the same `CMakePresets.json` and `CMakeUserPresets.json` files to invoke CMake in Visual Studio Code and from the command line. The CMake and CTest documentation are the best resources for invoking [CMake](https://cmake.org/cmake/help/latest/manual/cmake.1.html) and [CTest](https://cmake.org/cmake/help/latest/manual/ctest.1.html) with `--preset`. CMake version 3.20 or higher is required.

The following commands can be run from the directory where your `CMakePresets.json` is located:

```DOS
cmake --list-presets=all .
cmake --preset <configurePreset-name>
cmake --build --preset <buildPreset-name> 
ctest --preset <testPreset-name>
```

## Sourcing the environment when building with command line generators on Windows

See the JTW <`CMakePresets.json` in Visual Studio> documentation for more information on building with a command line generator on Windows.

## Example `CMakePresets.json` file

See the `CMakePresets.json` file checked in the [box2d-lite](https://github.com/esweet431/box2d-lite/blob/main/`CMakePresets.json`) code sample. It contains examples of Configure Presets, Build Presets, and Test Presets.

## Next steps

- Review [How CMake Tools builds](build.md#how-cmake-tools-builds)
- Explore the [CMake Tools documentation](README.md)