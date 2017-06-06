# CMake Tools

[CMake Tools](https://marketplace.visualstudio.com/items?itemName=vector-of-bool.cmake-tools) provides the native developer a full-featured, convenient, and
powerful configure+build workflow for CMake-based projects within the
Visual Studio Code editor.

Make sure you have [this dependency](https://marketplace.visualstudio.com/items?itemName=twxs.cmake) installed before using CMake Tools.

## Calling All Users:

One of the number-one most important things I need help with is _documentation_.
The changelog may mention all important changes and features, but it's hard for
a new user to get acclimated and find all the features and options.

If you'd like to help, please head on over to the GitHub project's wiki, or
add a PR for relevant information in the `docs/` subdirectory.

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
- **0.9.3**: Various bugfixes. Shiny new icon.
- **0.9.4**:
  - Fix issues with GCC template error parsing
  - Do not forcibly set `BUILD_SHARED_LIBS`
  - Fix issues with incorrect debug paths with cmake-server
  - `cmake.platform` setting for controlling the `-A` CMake option.
  - New command `cmake.launchTargetProgramPath` for usage in `launch.json`:
    - This means that other debuggers can be used with CMake Tools just
      by setting them up with `launch.json`, using `${command.cmake.launchTargetProgramPath}` as the path to the program. VSCode
      will replace that with the path from CMake Tools. This makes setting up
      permanent debugging configurations easier than before. Also, the `Debug`
      button in the status bar is *only* visible if the Microsoft C/C++ extension
      is installed, since that button is currently hard-coded to use it.
- **0.9.5**:
  - Launching targets without a debugger (default bound to `shift+f5`).
  - The path to CTest is more intelligent. Can also be manually overridden with
    `cmake.ctestPath`.
  - CMake Server is now enabled by default for new-enough CMake versions. It
    can still be disabled in the user settings.
  - Fixes for using Xcode
  - Many smaller fixes and tweaks after the long hiatus in development.
- **0.9.6**: Fix startup issue on Windows

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
