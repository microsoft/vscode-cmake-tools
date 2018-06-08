# Configuration

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
- ``cmake.parseBuildDiagnostics`` enables/disables the parsing of build diagnostics
  from the compiler. Default is enabled. You may want to disable this if another
  tool provides live diagnostics.
- ``cmake.sourceDirectory`` tells CMake Tools where the root ``CMakeLists.txt``
  file is. The default is ``${workspaceRoot}``.
- ``cmake.saveBeforeBuild`` tells CMake Tools to save all open text documents
  after the build command is invoked, but before performing the build. This
  defaults to being _enabled_.
- ``cmake.buildBeforeRun`` Always build the target before running.
- ``cmake.preferredGenerator`` tells CMake Tools what CMake genertors to prefer.
  The first supported generator in this list is used when configuring a project
  for the first time. If a project is already configured, the generator will not
  be overriden by CMake Tools unless a _Clean rebuild/reconfigure_ is invoked.
- ``cmake.generator`` tells CMake to skip the
  ``preferredGenerator`` logic and forcibly use the named generator.
- ``cmake.{configure,build,buildTool}Args`` allows passing of arbitrary strings
  as command line arguments to the respective configure/build step. *Please* do
  not use this option if another one of CMake Tools' options is sufficient.
  CMake Tools is better able to integrate with your build system when it can
  easily understand your project and its settings.
- ``cmake.toolset`` tells CMake to set the toolset
  argument when configuring the first time. (Not to be confused with *toolchain* files!)
- ``cmake.platform`` tells CMake to set the platform argument when configuring.
- ``cmake.clearOutputBeforeBuild`` clears the _CMake/Build_ output channel before
  running the CMake build command. Default is _enabled_
- ``cmake.cmakePath`` allows you to specify a different CMake executable to use,
  rather than the default system one.
- ``cmake.experimental.enableTargetDebugging`` enables the experimental
  [Target Debugging](https://github.com/vector-of-bool/vscode-cmake-tools/blob/develop/docs/target_debugging.md)
  features
- ``cmake.debugConfig`` allows tweaking the options for debugging when using
  the Target Debugging feature.
- ``cmake.environment`` sets environment variables to be passed to cmake/build
  processes invoked by CMake Tools. These can be further refined:
- ``cmake.configureEnvironment`` sets environment for CMake configure
- ``cmake.buildEnvironment`` sets environment for build execution
- ``cmake.testEnvironment`` sets environment variables when running CTest
- ``cmake.mingwSearchDirs`` is a list of directories where CMake Tools will
  search for an installed MinGW environment. A search directory will match if it
  contains the `bin/`, `include/`, etc. directories with the MinGW binaries,
  headers, and libraries. There is currently one default search directory,
  `C:\MinGW`. If more than one directory in this list matches, each matching
  directory will be an available MinGW environment.