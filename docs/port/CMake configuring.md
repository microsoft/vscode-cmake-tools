
[Source](https://vector-of-bool.github.io/docs/vscode-cmake-tools/configuring.html "Permalink to CMake Configuring — CMake Tools 1.4.0 documentation")

# CMake Configuring — CMake Tools 1.4.0 documentation

CMake Tools wraps the CMake _configure_ process separately from the _build_ process.

## A Crash-Course on CMake's Configuration Process

For those new to CMake, _Configure_ refers to the process of detecting requirements and generating the build files that will produce the final compiled artifacts.

To understand how CMake Tools interacts with CMake's configure process, a few things must be discussed:

* The _CMake Cache_ is a list of key-value pairs that persist between executions of the configure process. It contains a few different types of values:

    * Values that are often heavy or slow to compute, such as whether a `-flag` or `#include` file is supported by the compiler.

    * Values that rarely change, such as the path to a header/library.

    * Values that offer control to the developer, such as `BUILD_TESTING` to determine whether or not to build test libraries/executables.
* _Cache initializer arguments_ are the arguments passed to CMake that set values in the cache before any CMake scripts are executed. This lets one control build settings. On the CMake command line, these appear as `-D` arguments .
* Unless overwritten or deleted, values in the CMake Cache will persist between executions of CMake.
* The result of a _configure_ depends on the CMake _Generator_. The _Generator_ tells CMake what kind of tool will be used to compile and generate the results of the build, since CMake doesn't do the build itself. There are several families of generators available:

    * _Ninja_ \- Emits files for the [Ninja build tool][1]. This is the generator CMake Tools will always try first, unless configured otherwise. (See [cmake.preferredGenerators][2]).

    * _Makefile_ \- Emits a `Makefile` for the project that can be built via `make`.

    * _Visual Studio_ \- Emits visual studio solutions and project files. There are many different Visual Studio generators, so it is recommended to let CMake Tools automatically determine the appropriate generator.

Regardless of generator, CMake Tools will always support building from within Visual Studio Code. Choosing a particular generator is unimportant .

## A "Clean" Configure

CMake Tools also has the concept of a "clean configure," executed by running _CMake: Delete cached built settings and reconfigure_. The process consists simply of deleting the `CMakeCache.txt` file and `CMakeFiles` directory from the build directory. This is enough to reset all of CMake's default state. Should additional cleaning be necessary, it must be done by hand.

This process is required for certain build system changes, but may be convenient as a "reset" if you have tweaked any configuration settings outside of CMake Tools.

CMake Tools will also do this _automatically_ if you change the active [kit][3]. CMake can't yet properly handle changing the toolchain without deleting the configuration data.

[1]: https://ninja-build.org/
[2]: https://vector-of-bool.github.io/settings.html#conf-cmake-preferredgenerators
[3]: https://vector-of-bool.github.io/kits.html#kits

  