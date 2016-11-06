
## Change History

### Version 0.7.0

- **NEW** Greater CTest integration! Test output now has a dedicated output
  channel and statusbar entry. Pressing the statusbar entry will execute tests
  and show the number of failing/passing tests. Additionally, [Catch](https://github.com/philsquared/Catch) test
  output is now parsed and generates inline decorations to mark failing
  assertions along with failure information.*
- Updated to new vscode/Node APIs for TypeScript 2.0.
- Various bug fixes and tweaks.
- **0.7.1**: Bug fixes and tweaks.
- **0.7.2**:
  - Support for error message parsing for the Green Hills Compilers, special
    thanks goes to [bbosnjak](https://github.com/bbosnjak)!
  - Various fixes and tweaks.

### Version 0.6.0

**NEW** Build variants. This makes working with complex projects simpler while
simple projects remain simple. [Read about it here](https://github.com/vector-of-bool/vscode-cmake-tools/blob/develop/docs/build_variants.md).
**Please Remember:** If you find an issue or have a question/request,
feel free to open an issue on [the GitHub page](https://github.com/vector-of-bool/vscode-cmake-tools). Thanks!

### Version 0.5.0

- Target Debugging! This feature is still experimental, and
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
- **0.5.6**: Tweaks to diagnostic parsing:
  - Now parses for GNU ld-style linker errors
  - Recognizes "fatal error" in addition to regular errors.
- **0.5.7**:
  - Fix issues with filepath normalization
  - Fix the helper script generating many errors when using VS generator
  - Fix for the initial default target being 'all' for VS generators

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