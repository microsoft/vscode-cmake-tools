# The CMake configure process

In CMake, _configure_ refers to detecting requirements and generating the build files that will produce the final compiled artifacts.

The following concepts will help you understand how CMake Tools interacts with CMake's configure process:

* The _CMake Cache_ is a list of key-value pairs that persist between runs of the configure process. It contains the following:

  * Values that are expensive to determine, such as whether a `-flag` or `#include` file is supported by the compiler.
  * Values that rarely change, such as the path to a header/library.
  * Values that offer control to the developer, such as `BUILD_TESTING` to determine whether or not to build test libraries/executables.
* _Cache initializer arguments_ are the arguments passed to CMake that set values in the cache before any CMake scripts are run. These allow you to control the build settings. On the CMake command line, these appear as `-D` arguments. (CMake Tools doesn't use CMake's `-C` argument).
* Unless overwritten or deleted, values in the CMake Cache persist between CMake runs.
* CMake doesn't do the build itself, it relies on build tools installed on your system. The result of a _configure_ depends on the CMake _Generator_. The _Generator_ tells CMake what kind of tool will be used to compile and generate the results of the build. There are several families of generators available:

    |Generator |Description|
    |---------|---------|
    |Ninja | Emits files for the [Ninja build tool](https://ninja-build.org). This is the generator CMake Tools tries first, unless configured otherwise. See [cmake.preferredGenerators](cmake-settings.md#cmake-settings). |
    |Makefile |  Emits a `Makefile` for the project that can be built via `make`.|
    |Visual Studio     | Emits visual studio solutions and project files. There are many different Visual Studio generators, so it is recommended to let CMake Tools automatically determine the appropriate generator.|

Regardless of generator, CMake Tools always supports building from within Visual Studio Code. If you are building from within Visual Studio Code, we recommend you use the [Ninja build tool](https://ninja-build.org/).

## The CMake Tools configure step

CMake Tools drives CMake via the cmake-file-api which provides project info via a file on disk.

When CMake Tools runs the configure step, it takes the following into consideration:

1. **The selected preset**

    [CMake Presets](cmake-presets.md) provide information about how to properly utilize CMake Presets.

    * For [toolchain and compilers](cmake-presets.md#select-your-compilers), you can utilize the `cacheVariables` field of the CMakePresets.json.
    * Generator: This is specified in the `generator` field in the CMakePresets.json.
    * Environment: This is specified in the `environment` field in the CMakePresets.json. If we detect that you are using a cl.exe or Ninja, we attempt to add the Visual Studio Developer Environment, based on the setting defined in `cmake.useVsDeveloperEnvironment`

    See [CMake Presets](cmake-presets.md) for more information about how kits work.

All of the above are taken into account to perform the configure. Once finished, CMake Tools loads project information from CMake and generates diagnostics based on CMake's output. You are now ready to [build with CMake Tools](build.md).

## The configure step outside of CMake Tools

CMake Tools is designed to work well with an external CMake process. If you choose to run CMake from another command line, or other IDE/tool, it should work provided the host environment is set up properly.

> **Important:**
> CMake Tools is unaware of any changes made by an external CMake process, and you will need to re-run the CMake configure within CMake Tools to have up-to-date project information.

## Clean configure

To get CMake Tools to do a clean configure, run **CMake: Delete Cache and Reconfigure** from the command palette in VS Code.

A clean configure deletes the `CMakeCache.txt` file and `CMakeFiles` directory from the build directory. This resets all of CMake's default state.

A clean configure is required for certain build system changes, such as when the active kit changes, but may also be convenient as a reset if you have changed configuration settings outside of CMake Tools.

CMake Tools will do a clean configure automatically if you change the active kit.

## Configure with CMake Debugger

In order to investigate errors with Configuring your CMake project, you can add breakpoints in your CMakeLists.txt and .cmake files and run **CMake: Configure with CMake Debugger** from the command palette in VS Code.

This will attach a debugger to the configure process and you can view things like the Call Stack as well as Local CacheVariables and more.

## Next steps

* Explore how to build at [Build with CMake Tools](build.md)
* Learn how kits work at [CMake Kits](kits.md)
* Explore the [CMake Tools documentation](README.md)
