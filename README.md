# CMake Tools

[CMake Tools](https://marketplace.visualstudio.com/items?itemName=vector-of-bool.cmake-tools) provides the native developer a full-featured, convenient, and
powerful configure+build workflow for CMake-based projects within the
Visual Studio Code editor.

This extension itself *does not* provide language support for the CMake
scripting language. For that I recommend [this extension](https://marketplace.visualstudio.com/items?itemName=twxs.cmake).

## What's New?

### **0.9.0**

- Experimental CMake Server support has landed. [Read more here.](docs/cmake_server.md)
- Experimental graphical CMake cache editor. The `Edit the CMake Cache` command
  now opens up a dedicated UI within VS Code for viewing and modifying values
  stored in the CMake cache. [Read more here.](docs/cache_editor.md)
- CTest coverage! Now code coverage can be viewed inline after it has been
  collected by CTest. This requires that CTest be executed with `-T Coverage`
  from the command line (CMake Tools does not yet do this automatically).
- **0.9.1**: Fix issues with CMake Server and cache editor.
- **0.9.2**: Fix issues with environment variables on Windows.
- **0.9.3**: Various bugfixes

As always: Please report any issues, questions, or comments to the GitHub
project issues list!

## Issues? Questions? Feature requests?

**PLEASE**, if you experience any problems, have any questions, or have an idea
for a new feature, create an issue on [the GitHub page](https://github.com/vector-of-bool/vscode-cmake-tools)!

I'm only one person with no QA team, so I can't test all the different possible
configurations you may have, but I'll gladly help anyone fix issues relating to
this extension.

# Getting Started

CMake Tools provides several pieces of functionality to make it easier to work
with CMake-based projects within Visual Studio Code. For example, it adds a
"CMake: Build" command to the command palette, which is bound to the ``F7``
key by default.

By default, CMake Tools assumes that you place your CMake build tree in a
subdirectory of the source tree called ``build``. This can be configured with
the ``cmake.buildDirectory`` configuration option, which can be set globally or
on a per-project basis. If you try to build but do not yet have a build
directory, CMake Tools will prompt you to configure the project.

CMake Tools uses a configuration setting ``cmake.configureSettings`` to define
options to pass to CMake when configuring the project. In this way, build
settings can be stored as part of the project in ``settings.json`` in the
``.vscode`` directory.

## The Status bar

![CMake Status Bar Items](images/statusbar_marked.png)

CMake Tools provides a few buttons on the statusbar:

1.  The name of the current project, the current build type (Debug, Release, etc.),
    and the current status of CMake Tools. Click this button to change the active
    configuration.
2.  A build button. Click this button to build the default target. Quickly invoking
    a build is also bound to the ``F7`` key by default. While building, this button
    changes into a _stop_ button. Clicking the stop button will cancel the
    currently running build/configure process.
3.  The default/active target. This is the target that will be invoked if run
    the build command. Clicking on this button will let you select a different
    target to be built by default.
4.  The Target Debugging launcher (must be explicitly enabled, se below).
5.  The active debug target (must be explicitly enabled).
6.  The CTest results button. Click this button to rebuild and run CTest tests.

CMake Tools will also show the most recent line of CMake output as a status message
to the right of the buttons. Invoking a command will open the CMake/Build output
channel, where the progress and output of the build/configure commands can be
seen.

## Target Debugging

*Target Debugging*, allows developers to easily use the Visual
Studio Code Debugger with their CMake targets without having to write a
``launch.json``. [Read about enabling and using the feature here](https://github.com/vector-of-bool/vscode-cmake-tools/blob/develop/docs/target_debugging.md).

## Compiler Diagnostics

CMake Tools also parses the compiler output of GCC, Clang, and MSVC looking for
diagnostics. It will populate the diagnostics for files which produce any warnings
or errors.

## CTest Tests

CMake Tools also features integration with CTest, both executing and displaying
results, even inline in the editor:

![Failing Check](images/failed_check.png)

(Currently, only Catch test output is supported)

## Other Features

- Command to quickly generate a very basic CMakeLists.txt and C++ source file.
- Set CMake configuration values in ``settings.json``.
- Provides diagnostics for CMake scripts.
- Quickly jump into CMakeCache.txt
