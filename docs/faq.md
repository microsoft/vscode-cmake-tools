# Frequently asked questions — CMake Tools 1.4.0 documentation

## How can I get help?

Explore the [CMake Tools documentation](README.md)

Look in the [Troubleshooting guide](troubleshoot.md).

Check the [CMake Tools issue tracker](https://github.com/microsoft/vscode-cmake-tools/issues) and [What's New](../CHANGELOG.md) to see if your issue is already known/solved before submitting a question or bug report. Feel free to [Open a Github issue](https://github.com/microsoft/vscode-cmake-tools/issues) if your problem hasn't been reported.

Please visit [the end-user support chat](https://gitter.im/vscode-cmake-tools/support). This is a community chat. Microsoft does not actively monitor it.

If you're having issues with CMake itself, view the [Kitware CMake Forum](https://gitlab.kitware.com/cmake/community) or [Kitware CMake issues](https://gitlab.kitware.com/cmake/cmake/-/issues)

## How can I detect when CMake is run from VS Code?

CMake Tools automatically sets the `VSCODE_CMAKE_TOOLS` environment variable to `1` for all subprocesses that it spawns, including configure, build, and test commands. You can check for this variable in your `CMakeLists.txt` to detect if the current CMake invocation is being run from the CMake Tools extension:

```cmake
if(DEFINED ENV{VSCODE_CMAKE_TOOLS})
    message(STATUS "CMake is being run from VS Code CMake Tools extension")
endif()
```

> **Note:** To see `message()` output from your CMakeLists.txt in the CMake Tools output channel, set [`cmake.loggingLevel`](cmake-settings.md) to `"debug"` in your VS Code settings.

## How do I learn about CMake?

CMake Tools is not the same as CMake. There are many great resources around to learn how to use CMake.

- Jason Turner's [C++ Weekly - Intro to CMake](https://www.youtube.com/watch?v=HPMvU64RUTY) is a good introduction.
- [CMake's documentation](https://cmake.org/cmake/help/latest/)
- [CMake's "Mastering CMake" book](https://cmake.org/cmake/help/book/mastering-cmake/)
- ["Professional CMake"](https://crascit.com/professional-cmake/)- a $30 book by Craig Scott (one of the maintainers of CMake).

## How do I perform common tasks

See the [How To](how-to.md).
