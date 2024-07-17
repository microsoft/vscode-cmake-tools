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

1. **The active kit**

    [CMake kits](kits.md) provide information about the toolchains available on your system that can be used with CMake to build your projects.

    * For [toolchain](kits.md#specify-a-toolchain), CMake Tools sets the CMake cache variable `CMAKE_TOOLCHAIN_FILE` to the path to the file specified by the kit.

    * For [compilers](kits.md#specify-a-compiler), CMake Tools sets the `CMAKE_<LANG>_COMPILER` cache variable to point to the path for each `<LANG>` defined in the kit.

    * For [Visual Studio](kits.md#visual-studio), CMake Tools sets environment variables necessary to use the selected Visual Studio installation, and sets `CC` and `CXX` to `cl.exe` so that CMake will detect the Visual C++ compiler as the primary compiler, even if other compilers like GCC are present on `$Path`.

    Each kit may also define additional cache variable settings required for the kit to operate. A kit may also define a `preferredGenerator`.

    See [CMake kits](kits.md) for more information about how kits work.\
    See [Kit options](kits.md#kit-options) for more information about the different types of kits.

1. **Which generator to use**

    CMake Tools tries not to let CMake decide implicitly which generator to use. Instead, it tries to detect a preferred generator from a variety of sources, stopping when it finds a valid generator. The sources it checks are:

    1. The config setting [cmake.generator](cmake-settings.md#cmake-settings).
    1. The config setting [cmake.preferredGenerators](cmake-settings.md#cmake-settings). Each element in this list is checked for validity, and if one matches, it is chosen. The list has a reasonable default that works for most environments.
    1. The kit's [preferredGenerator](cmake-settings.md#cmake-settings) attribute. Automatically generated Visual Studio kits set this attribute to the Visual Studio generator matching their version.
    1. If no generator is found, CMake Tools produces an error.

1. **The configuration options**

    CMake Tools has a variety of locations where configuration options can be defined. They are searched in order and merged together. When keys have the same name, the most recent value found during the search is used. The search locations are:

    1. The [cmake.configureSettings](cmake-settings.md#cmake-settings) option from `settings.json`.
    2. The `settings` value from the active [variant options](variants.md#variants-options).
    3. `BUILD_SHARED_LIBS` is set based on [variant options](variants.md#variants-options).
    4. `CMAKE_BUILD_TYPE` is set based on [variant options](variants.md#variants-options).
    5. `CMAKE_INSTALL_PREFIX` is set based on [cmake.installPrefix](cmake-settings.md#cmake-settings).
    6. `CMAKE_TOOLCHAIN_FILE` is set for [toolchain](kits.md#specify-a-toolchain).
    7. The [cmakeSettings](kits.md#general-options) attribute on the active kit.

    Additionally, [cmake.configureArgs](cmake-settings.md#cmake-settings) are passed before any of the above.

1. **The configure environment**

    CMake Tools sets environment variables for the child process it runs for CMake. Like the configuration options, values are merged from different sources, with later sources taking precedence. The sources are:

    1. The environment variables required by the active [kit](kits.md).
    2. The value of [cmake.environment](cmake-settings.md#cmake-settings).
    3. The value of [cmake.configureEnvironment](cmake-settings.md#cmake-settings).
    4. The environment variables required by the active [variant](variants.md).

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

## Next steps

- Explore how to build at [Build with CMake Tools](build.md)
- Learn how kits work at [CMake Kits](kits.md)
- Explore the [CMake Tools documentation](README.md)
