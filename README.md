# VSCode CMake Tools

This is a simple Visual Studio Code extension that offers CMake integration. This extension
itself *does not* provide language support. For that I recommend
[this extension](https://marketplace.visualstudio.com/items?itemName=twxs.cmake).

This extension can be installed with ``ext install cmake-tools``.

Issues? Questions? Feature requests? Create an issue on
[the github page](https://github.com/vector-of-bool/vscode-cmake-tools).

## Features

- Configure and build CMake-based projects within Visual Studio Code.
- Set CMake configuration values in ``settings.json``.
- Provides diagnostics for CMake scripts.
- Quickly jump the CMakeCache.txt
- Run CTest.

## Command Listing:

- CMake: Configure
- CMake: Build
- CMake: Build a target [Builds a target by name]
- CMake: Set build type [Change the build type, ie "Debug", "Release", etc.]
- CMake: Delete cached build settings and reconfigure
- CMake: Clean
- CMake: Clean rebuild
- CMake: Edit the cache fiel
- CTest: Run tests
- CMake: Quickstart [Quickly generate a very simple CMakeLists.txt]