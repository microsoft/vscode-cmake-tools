# VSCode CMake Tools

This extension provides project build and configuration tooling for CMake users
within Visual Studio Code. This extension itself *does not* provide language
support for the CMake scripting language.  For that I recommend
[this extension](https://marketplace.visualstudio.com/items?itemName=twxs.cmake).

## What's New?

### Version 0.5.0

- **NEW** Target Debugging feature. This feature is still experimental, and
  is disabled by default. [Click here to learn about how to enable and use
  this new feature](https://github.com/vector-of-bool/vscode-cmake-tools/blob/develop/docs/target_debugging.md),
  and [click here to provide feedback.](https://github.com/vector-of-bool/vscode-cmake-tools/issues/37).
- Updated to use TypeScript 2.0, which brings more stability and code simplicity
  behind the scenes.
- **0.5.5**:
  - Generator can be forced using the ``cmake.generator.<platform>`` settings, or
    ``cmake.generator.all`` to apply one generator to all platforms.
  - The CMake toolset (the ``-T`` option) can be set using the ``cmake.toolset.<platform.`` settings.
  - Arbitrary arguments can be passed to CMake during configure, build, and to the
    underlying build tool using the ``cmake.{configureArgs,buildArgs,buildToolArgs}``
    set of configuration options.

## Issues? Questions? Feature requests?

**PLEASE**, if you experience any issues, create an issue on
[the GitHub page](https://github.com/vector-of-bool/vscode-cmake-tools)!
I'm only one person with no QA team, so I can't test all the different possible
configurations you may have, but I'll gladly help anyone fix issues relating to
this extension.

## Getting Started

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

## Configuration

CMake tools has a good set of defaults for its configuration options. Here is a
quick summary of options that can be tweaked, should you wish to do so:

- ``cmake.configureSettings`` sets additional options to be passed to the CMake
  command line when configuring the project. This should just be a mapping between
  keys and values. Each entry will correspond to a ``-D`` argument to CMake. Arrays
  will automatically be joined as semicolon-serperated strings.
- ``cmake.buildDirectory`` allows you to specify where CMake should generate its
  metadata and build files. The default, ``${workspaceRoot}/build`` tells CMake
  Tools to configure into the ``build`` subdirectory of your projet. Use
  ``${buildType}`` to set the build directory based on the CMake build type. For
  example, ``${workspaceroot}/build/${buildType}`` will create subdirectories
  ``build/Debug``, ``build/Release``, etc. when you configure using those build
  types.
- ``cmake.installPrefix`` tells CMake Tools what to set for your
  ``CMAKE_INSTALL_PREFIX`` when you configure. This also supports variable
  substitutions. By default, CMake Tools will not specify a
  ``CMAKE_INSTALL_PREFIX``.
- ``cmake.parallelJobs`` tells CMake Tools how many jobs to pass to the command
  line of build tools and CTest. The default, zero, tells CMake Tools to automatically
  pick a good number based on the hardware parallelism available on the machine.
- ``cmake.ctest.parallelJobs`` allows you to override the parallelism _just_ for
  running CTest. The default, zero, tells CMake Tools to use the same value as
  ``cmake.parallelJobs``.
- ``cmake.sourceDirectory`` tells CMake Tools where the root ``CMakeLists.txt``
  file is. The default is ``${workspaceRoot}``.
- ``cmake.saveBeforeBuild`` tells CMake Tools to save all open text documents
  after the build command is invoked, but before performing the build. This
  defaults to being _enabled_.
- ``cmake.initialBuildType`` tells CMake Tools what to set the initial build type
  to if it detects that the project has not yet been configured.
- ``cmake.preferredGenerator`` tells CMake Tools what CMake genertors to prefer.
  The first supported generator in this list is used when configuring a project
  for the first time. If a project is already configured, the generator will not
  be overriden by CMake Tools unless a _Clean rebuild/reconfigure_ is invoked.
- ``cmake.clearOutputBeforeBuild`` clears the _CMake/Build_ output channel before
  running the CMake build command. Default is _enabled_
- ``cmake.cmakePath`` allows you to specify a different CMake executable to use,
  rather than the default system one.

## The Status bar

![CMake Status Bar Items](images/statusbar_marked.png)

CMake Tools provides three buttons on the statusbar:

1.  The name of the current project, the current build type (Debug, Release, etc.),
    and the current status of CMake Tools.
2.  A build button. Click this button to build the default target. Quickly invoking
    a build is also bound to the ``F7`` key by default. While building, this button
    changes into a _stop_ button. Clicking the stop button will cancel the
    currently running build/configure process.
3.  The default/active target. This is the target that will be invoked if run
    the build command. Clicking on this button will let you select a different
    target to be built by default.

CMake Tools will also show the most recent line of CMake output as a status message
to the right of the buttons. Invoking a command will open the CMake/Build output
channel, where the progress and output of the build/configure commands can be
seen.

## Target Debugging

An experimental, *Target Debugging*, allows developers to easily use the Visual
Studio Code Debugger with their CMake targets without having to write a
``launch.json``. [Read about enabling and using the feature here](https://github.com/vector-of-bool/vscode-cmake-tools/blob/develop/docs/target_debugging.md).

## Other Features

CMake Tools also parses the compiler output of GCC, Clang, and MSVC looking for
diagnostics. It will populate the diagnostics for files which produce any warnings
or errors.

CMake Tools also provides a command for running CTest tests.

## Change History

### Version 0.5.0

- **NEW** Target Debugging feature. This feature is still experimental, and
  is disabled by default. [Click here to learn about how to enable and use
  this new feature](https://github.com/vector-of-bool/vscode-cmake-tools/blob/develop/docs/target_debugging.md),
  and [click here to provide feedback.](https://github.com/vector-of-bool/vscode-cmake-tools/issues/37).
- Updated to use TypeScript 2.0, which brings more stability and code simplicity
  behind the scenes.

### Version 0.4.1

- Ability to disable compiler diagnostic parsing, in the case of some better
  diagnostic providers being present.
- No longer prompt to configure before invoking the build command, just
  configure and build.
- Various fixes and tweaks.

### Version 0.4.0

- Huge refactor of code. **If you find that something has broken for you, PLEASE
  feel free to open an issue on GitHub! I really appreciate it, thanks!**

- New stuff!
  - Now parses list of targets and shows them when selecting a target to build.
  - Tweak the default target with a single button in the status bar.
  - Command to invoke the ``install`` target*
  - Dedicated configuration setting for ``CMAKE_INSTALL_PREFIX``*
  - Certain configuration options can now be parameterized on the selected build
    type.*

\* Thanks to [rtbo](https://github.com/vector-of-bool/vscode-cmake-tools/commits/develop?author=rtbo)!

### Version 0.3.2

- Option ``cmake.ctest.parallelJobs``.

### Version 0.3.1

- Option to configure number of parallel jobs to run when building.
- Fix issue with the ``clean`` target when using the Ninja generator.

### Version 0.3.0

- Build output is now parsed for diagnostics, so errors can be jumped to quickly
  and easily. [Thanks to twxs!](https://github.com/vector-of-bool/vscode-cmake-tools/issues/2)

### Version 0.2.5

- Option to set the path of the CMake executable via the ``cmake.cmakePath``
  setting. ([Thanks, stanionascu!](https://github.com/vector-of-bool/vscode-cmake-tools/pull/9))
- Support for using a Visual Studio generator as a ``preferredGenerator``. [Thanks again, stanionascu!](https://github.com/vector-of-bool/vscode-cmake-tools/pull/10)

### Version 0.2.4

- Set a target to be built by default when invoking the ``build`` command. This
  option only persists for a single session, so must be set each time Visual
  Studio Code is opened.
- MSBuild building now outputs full paths, enabling jumping to error locations.

### Version 0.2.3

- New option: ``cmake.clearOutputBeforeBuild`` enables clearing the contents of
  the *CMake/Build* output channel before configuring/building the project each
  time.
- New option: ``cmake.saveBeforeBuild`` enables the extension to automatically
  save any unsaved documents when the build command is invoked.
- Makefile and MSBuild generators now build in parallel with the number of cores
  on the system plus two.

### Version 0.2.2

- Properly detect when a reconfigure is required based on changes to workspace
  settings.
- Improve automatic extension loading.
- Tweak appearance of the status bar item.

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
- CMake: Build [default keybinding is ``F7``]
- CMake: Install
- CMake: Build a target [Builds a target by name]
- CMake: Set build type [Change the build type, ie "Debug", "Release", etc.]
- CMake: Set the default build target
- CMake: Delete cached build settings and reconfigure
- CMake: Clean
- CMake: Clean rebuild
- CMake: Run tests
- CMake: Edit the cache file
- CMake: Run tests
- CMake: Quickstart [Quickly generate a very simple CMakeLists.txt]
