.. _changelog:

Changelog and History
#####################

.. _changes-1.1.2:

1.1.2
*****

Fixes and tweaks upon 1.1.2:

- Fix silent failure when a build directory appears at a different path than is
  encoded in its ``CMakeCache.txt``.
- Improved logic in path normalization, but could be better.
- Improve documentation on using ``launch.json``.
- Fix shell splitting preventing certain command lines from being parsed
  correctly.
- Display a more helpful message when using a toolchain file and we fail to find
  the C and/or C++ compiler because it is not stored in the CMake cache.

Full list of fixes are `these issues <https://github.com/vector-of-bool/vscode-cmake-tools/milestone/13?closed=1>`.

.. _changes-1.1.1:

1.1.1
*****

Fixes and tweaks upon 1.1.0:

- Fix "Unable to automatically determine compiler" when using VS generators.
- Fix failure to provide IntelliSense information for header files even after
  adding them to a target.
- "Unexpected stderr/stdout..." no longer appears. This output is now logged as
  regular CMake status messages.

**BREAKING CHANGE**: Variant substitutions follow a new `${variant:var-key}`
syntax to match the special namespacing of substitutions. See :ref:`variant-sub`.

Full list of fixes are `these issues <https://github.com/vector-of-bool/vscode-cmake-tools/milestone/12?closed=1>`.

.. _changes-1.1.0:

1.1.0
*****

1.1.0 is the most exciting release yet! It includes several long-awaited
features, including but not limited to:

- *A project outline view*. CMake Tools will now render a tree representation of
  your CMake project, including all targets and source files.

  - Individual targets can be built/run using the context menu in the outline.
  - Individual source files can be compiled using the outline context menu.
  - The debugger can be started by right-clicking on the desired executable.

- Update progress and cancellation notifications. Now uses the official VSCode
  progress APIs. A proper *Cancel* button is visible on the progress
  notification for cancelling the build.
- Progress for the *Configure/Generate* phase. It is up to CMake to generate
  reliable progress values, though.
- Automatically configure a project when it is opened. CMake Tools will ask you
  the first time, and this preference can be persisted.
- Will automatically ask you for a debug target if you try to debug but haven't
  yet set one.

``cpptools`` Integration!
=========================

The highest-demand feature of all has finally landed!

Recent versions of Microsoft's C and C++ extension now export an extensibility
API that gives external sources the opportunity to provide project configuration
information on a file-by-file basis.

CMake Tools 1.1.0+ will utilize this API to provide per-file compilation and
configuration information to support the C++ extension. This means that a
properly set up CMake project need not manually set configuration information
to receive the benefits of cpptools' IntelliSense engine.

Check :ref:`the updated How-Do-I page <hdi.intellisense>`.

.. _changes-1.0.1:

1.0.1
*****

Resolves a few issues/enhancements that didn't make it into 1.0.0.

- Automatically detect when a kit specifies a path to a non-existent compiler
  and ask what to do with that kit (remove or keep).
- New option :ref:`conf-cmake.copyCompileCommands`: Set a path to which
  ``compile_commands.json`` will be copied after a configure run.
- Fix failing when CMake executable has a different name than ``cmake``.
- Fixed edits to the kits file not applying immediately.
- Fixed issue where CTest is not on the ``$PATH`` and it fails to detect tests.

.. _changes-1.0.0:

1.0.0
*****

CMake Tools 1.0.0 is a minor change over 0.11.x, but marks the first "stable"
release. It is now a developer-ready tool that is suitable for everyday work!
[#counter]_

1.0.0 contains the following improvements and fixes over 0.11.x:

- Option to build on ``cmake.launchTargetPath`` (Launch-before-debug).
  See :ref:`conf-cmake.buildBeforeRun`.
- `LLVM for Windows <https://llvm.org/builds/>`_ is now supported as an
  auto-detected Kit type.
- To support LLVM for Windows, kit options can now be freely mixed-and-matched,
  eg. setting a toolchain file along with a Visual Studio environment.
- Cache initialization files are now supported in ``settings.json``. See
  :ref:`conf-cmake.cacheInit`.
- Kits are now **optional**. If no kit is active, CMake Tools will ask you if
  you want to scan, select a kit, or opt-out of kits. If no kit is chosen, CMake
  Tools will let CMake decide what to do.
- GCC cross-compilers are now detected as regular compilers for compiler kits.
- Setting :ref:`conf-cmake.defaultVariants` is respected again.
- Setting :ref:`conf-cmake.mingwSearchDirs` is respected again.
- CMake Tools will attempt to set the path to the debugger (``gdb`` or ``lldb``)
  during Quick Debugging.
- Fix for intermittent "Not yet configured" errors.

A few issues slated for 1.0.0 fell through as the schedule slipped. If you
expected a feature in 1.0.0 that isn't listed above, it will be available in
1.0.1.

.. [#counter] If you don't agree, please open a bug report!

.. _changes-0.11.0:

0.11.1
******

Several bugfixes and tweaks:

- Attempted fix for "No build system was generated yet" by implementing more
  reliable dirty-checks when running a build/configure.
  (`#385 <https://github.com/vector-of-bool/vscode-cmake-tools/issues/385>`_)
- Fix handling spaces in filepaths when running ``vswhere.exe``.
  (`#381 <https://github.com/vector-of-bool/vscode-cmake-tools/pull/381>`_)
- Fix environment variables from ``settings.json`` being ignored when using
  legacy (non-cmake-server) mode.
  (`#384 <https://github.com/vector-of-bool/vscode-cmake-tools/issues/384>`_)
- Do not case-normalize diagnostics on Windows. This prevents VSCode from
  considering two equivalent paths to be different when opening them from the
  problems panel.
  (`#395 <https://github.com/vector-of-bool/vscode-cmake-tools/pull/395>`_)
- Reset progress when build finishes. Stops a flash of "%100" when starting a
  new build.
  (`#394 <https://github.com/vector-of-bool/vscode-cmake-tools/pull/394>`_)
- Better error message when trying to use debugging on non-cmake-server.
  (`#388 <https://github.com/vector-of-bool/vscode-cmake-tools/issues/388>`_)

0.11.0
******

0.11.0 is the biggest change so far to CMake Tools. It brings not just new
functionality, but new infrastructure and maintainers behind the extension.

It began with an `overly-ceremonious blog post <https://vector-of-bool.github.io/2017/12/15/cmt-1.0-and-beta.html>`_,
followed by months of beta (when it should have been a few weeks).

Here's a quick summary:

- :ref:`"Kits" provide a new way to encapsulate the toolset used to build a
  project. <kits>`
- Opt-in automatic error reporting.
- Lots of stability and backend cleanup.
- All new documentation!

0.10.x and Older
****************

The old (pre-0.11.0) changelog can be found in `here <https://github.com/vector-of-bool/vscode-cmake-tools/blob/develop/CHANGELOG.pre-0.11.0.md>`_.
