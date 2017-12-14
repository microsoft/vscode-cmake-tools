.. _settings:

Configuring CMake Tools
#######################

CMake Tools supports a variety of settings that can be set at the user or
workspace level via VSCode's ``settings.json`` file. This page talks about
the available options and how they are used.

Options marked with *Supports substitution* allow variable references to appear
in their strings. See the :ref:`var-subs` section

Available Settings
==================

``cmake.buildDirectory``
************************

Specify the build directory (The root directory where ``CMakeCache.txt`` will
be generated).

- Default: ``${workspaceRoot}/build``.
- *Supports substitution*

``cmake.installPrefix``
***********************

If specified, sets a value for ``CMAKE_INSTALL_PREFIX`` when running CMake
configure. If not, no value will be passed.

- Default: ``null`` (Unspecified)

``cmake.sourceDirectory``
*************************

Directory where the root ``CMakeLists.txt`` will be found.

- Default: ``${workspaceRoot}``
- *Supports substitution*

``cmake.saveBeforeBuild``
*************************

If ``true`` (the default), saves open text documents when build or configure is
invoked before running CMake.

- Default: ``true``

.. _var-subs:

Variable Substitution
=====================

Some options support the replacement of variable values in their string value
using ``${variable}`` syntax.