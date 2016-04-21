# VSCode CMake Tools

This is a simple Visual Studio Code extension that offers CMake integration. This extension
itself *does not* provide language support. For that I recommend
[this extension](https://marketplace.visualstudio.com/items?itemName=twxs.cmake).

This extension can be installed with ``ext install cmake-tools``.

### Issues? Questions? Feature requests?

Create an issue on [the github page](https://github.com/vector-of-bool/vscode-cmake-tools).

## Getting Started

CMake Tools provides several pieces of functionality to make it easier to work
with CMake-based projects within Visual Studio Code. For example, it adds a
"CMake: Build" command to the command palette, which is bound to the ``F7``
key.

By default, CMake Tools assumes that you place your CMake build tree in a
subdirectory of the source tree called ``build``. This can be configured with
the ``cmake.buildDirectory`` configuration option, which can be set globally or
on a per-project basis. If you try to build but do not yet have a build
directory, CMake Tools will prompt you to configure the project.

CMake Tools uses a configuration setting ``cmake.configureSettings`` to define
options to pass to CMake when configuring the project. In this way, build
settings can be stored as part of the project in ``settings.json`` in the
``.vscode`` directory.

## Change History

### Version 0.2.1

- Fix failure to run on Windows due to line-endings issues

### Version 0.2.0

- Added a status bar with some useful controls:
  - Change build type/configuration
  - Start and stop the build with a single click
- Better support for multi-configuration generators
- Fix some issues when building on Windows

### Version 0.1.2

- Fix bug when building before configuring.

### Version 0.1.1

- Fix issue where we fail to detect the presence of Ninja when the command is
  ``ninja-build``.
- Fix failure to build when configured with a Visual Studio generator.

### Version 0.1.0

- First useful release

## Features

- Configure and build CMake-based projects within Visual Studio Code with a
  single keypress (Default is ``F7``).
- Command to quickly generate a very basic CMakeLists.txt and C++ source file.
- Set CMake configuration values in ``settings.json``.
- Provides diagnostics for CMake scripts.
- Quickly jump into CMakeCache.txt
- Run CTest.

## Command Listing:

- CMake: Configure
- CMake: Build
- CMake: Build a target [Builds a target by name]
- CMake: Set build type [Change the build type, ie "Debug", "Release", etc.]
- CMake: Delete cached build settings and reconfigure
- CMake: Clean
- CMake: Clean rebuild
- CMake: Edit the cache file
- CTest: Run tests
- CMake: Quickstart [Quickly generate a very simple CMakeLists.txt]