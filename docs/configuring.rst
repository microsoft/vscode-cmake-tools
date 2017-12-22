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

Some options support the replacement of special values in their string value
using ``${variable}`` syntax. The following built-in variables are expanded:

``${workspaceRoot}``
    The full path to the workspace root directory

``${workspaceRootFolderName}``
    The name of the leaf directory in the workspace directory path

``${buildType}``
    The current CMake build type, eg. ``Debug``, ``Release``, ``MinSizeRel``

``${generator}``
    The name of the CMake generator, eg. ``Ninja``

``${projectName}``
    The name of the CMake project. Isn't expanded fully until project has been
    configured once. Before configuring, expands to "Unknown Project".

``${userHome}``
    The full path to the current user's home directory

Environment Variables
*********************

Additionally, environment variables may be substituted with ``${env:VARNAME}``
syntax, where the string for the ``VARNAME`` environment variable will be
replaced. If the named environment variable is undefined, an empty string
will be expanded instead.

Command Substitution
********************

CMake Tools also supports expanding of VSCode commands, similar to
``launch.json``. Running a command ``${command:foo.bar}`` will execute the
``foo.bar`` VSCode command and replace the string value. Beware of long-running
commands! It is unspecified when and how many times CMake Tools will execute a
command for a given expansion.