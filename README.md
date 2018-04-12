# CMake Tools

[![Gitter chat](https://badges.gitter.im/vscode-cmake-tools/Lobby.png)](https://gitter.im/vscode-cmake-tools/Lobby)

[CMake Tools](https://marketplace.visualstudio.com/items?itemName=vector-of-bool.cmake-tools) provides the native developer a full-featured, convenient, and
powerful configure+build workflow for CMake-based projects within the
Visual Studio Code editor.

This extension itself *does not* provide language support for the CMake
scripting language. For that I recommend [this extension](https://marketplace.visualstudio.com/items?itemName=twxs.cmake).

# CALLING ALL USERS:

I need *your* help! I've been working the past few months on the final pre-1.0
release version. It includes a large rewrite and refactor along with some new
features and stability improvements, but I want to get some proper user-testing
done before pushing out changes to all users.

This is where you come in: If you are willing to give the beta release a try,
Head over to the [releases](https://github.com/vector-of-bool/vscode-cmake-tools/releases)
page, download the `.vsix` package, and give it a test drive.

The 0.11.0 beta includes [new documentation](https://vector-of-bool.github.io/docs/vscode-cmake-tools/index.html) as well, so feel free to give it a look and provide feedback.

For more information, see [this issue](https://github.com/vector-of-bool/vscode-cmake-tools/issues/274) and/or read
[this blog post](https://vector-of-bool.github.io/2017/12/15/cmt-1.0-and-beta.html).

# What's New?

### **0.10.0**
- VS 2017 environment detection! Finally! **Note:** We use `vswhere` to find the
  local Visual Studio installation, and this program is only bundled with
  Visual Studio 2017 Update 2 (or newer). Please install (at least) update 2
  for automatic detection to work
- Lots of small bugfixes and tweaks, and debugging documentation updates. Many thanks to [Yuri Timenkov](https://github.com/ytimenkov)!
- **0.10.1**:
  - Option `cmake.buildBeforeRun` to enable/disable building of a target before
    running/debugging it. (Default is *enabled*)
  - Changes in the way Visual Studio generators are loaded and detected. Now,
    generators for detected build environments are added to the `preferred`
    list. (Thanks to [Yuri Timenkov](https://github.com/ytimenkov)!)
  - Fix issue where cmake-server could be restarted too quickly and break
    itself.
  - `${variable}` substitution is now supported in the `cmake.*Environment`
    settings. (Thanks to [Damien Courtois](https://github.com/dcourtois)!)
- **0.10.2**:
  - Support for Emscripten environment detection. Set the
    `cmake.emscriptenSearchDirs` setting or the `EMSCRIPTEN` environment
    variable to the root path of the Emscripten SDK
    (Contains `cmake/Modules/Platform/Emscripten.cmake`)
  - Fix environment variables not passing from `settings.json` to configuration.
- **0.10.3**:
  - Bugfixes:
    - Debugging works again in the VSCode October update
    - Various
- **0.10.4**:
  - Tweaks:
    - VSWhere is now bundled with the extension, so it isn't required to be
      installed at a specific version. Fixes #254 and #235.
  - Request for feedback and beta testing.

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
4.  The Target Debugging launcher (must be explicitly enabled, see below).
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
