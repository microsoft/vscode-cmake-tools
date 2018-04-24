.. _changelog:

Changelog and History
#####################

.. _change-0.11.0:

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
