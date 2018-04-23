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

.. _conf-cmake.buildDirectory:

``cmake.buildDirectory``
************************

Specify the build directory (The root directory where ``CMakeCache.txt`` will
be generated).

- Default: ``${workspaceRoot}/build``.
- *Supports substitution*

.. _conf-cmake.installPrefix:

``cmake.installPrefix``
***********************

If specified, sets a value for ``CMAKE_INSTALL_PREFIX`` when running CMake
configure. If not, no value will be passed.

- Default: ``null`` (Unspecified)
- *Supports substitution*

.. note::
    If ``CMAKE_INSTALL_PREFIX`` is set via ``cmake.configureArgs`` or
    ``cmake.configureSettings``, ``cmake.installPrefix`` will be ignored.

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

.. _conf-cmake.configureSettings:

``cmake.configureSettings``
***************************

An object containing ``key : value`` pairs, which will be
passed onto CMake when configuring.
It does the same thing as passing ``-DVAR_NAME=ON`` via
``cmake.configureArgs``.

- Default: ``null`` (Unspecified)
- *Supports substitution*

.. _conf-cmake.configureArgs:

``cmake.configureArgs``
***********************

Arguments to CMake that will be passed during the configure process.

- Default: ``[]`` (Empty array, no arguments)
- *Supports substitution*

.. warning::
    **Always** prefer to use ``cmake.configureSettings`` or :ref:`variants`.
    *Never* pass ``-D`` arguments using this setting.

.. _conf-cmake.environment:

``cmake.environment``
*********************

An object containing ``key : value`` pairs of environment variables,
which will be passed onto CMake when configuring and to the compiler.

- Default: ``null`` (Unspecified)
- *Supports substitution*

.. _conf-cmake.configureEnvironment:

``cmake.configureEnvironment``
******************************

An object containing ``key : value`` pairs of environment variables,
which will be passed onto CMake *ONLY* when configuring.

- Default: ``null`` (Unspecified)
- *Supports substitution*

.. _conf-cmake.buildEnvironment:

``cmake.buildEnvironment``
***************************

An object containing ``key : value`` pairs of environment variables,
which will be passed *ONLY* onto the compiler.

- Default: ``null`` (Unspecified)
- *Supports substitution*

.. _conf-cmake.buildArgs:

``cmake.buildArgs``
*******************

An array of additional arguments to pass to ``cmake --build``.

- Default: ``[]`` (Empty array, no additional arguments)
- *Supports substitution*

.. seealso::
    - :ref:`building.how`

.. _conf-cmake.buildToolArgs:

``cmake.buildToolArgs``
***********************

An array of additional arguments to pass to *the underlying build tool*.

- Default: ``[]`` (Empty array, no additional arguments)
- *Supports substitution*

.. seealso::
    - :ref:`building.how`

.. _conf-cmake.preferredGenerators:

``cmake.preferredGenerators``
*****************************

A list of strings of generator names to try in order when configuring a CMake
project for the first time.

.. _conf-cmake.generator:

``cmake.generator``
*******************

Set to a string to override CMake Tools' *preferred generator* logic. If this is
set, CMake will unconditionally use it as the ``-G`` CMake generator command
line argument.

.. _conf-cmake.loggingLevel:

``cmake.loggingLevel``
**********************

An enumerated string setting to change the amount of output CMake Tools
produces in its output channel. Set to one of "trace", "debug", "info", "note",
"warning", "error", or "fatal", with "trace" being the most verbose.

- Default: ``info``

.. note::
    Regardless of the logging level, CMake Tools writes *all* levels of logging
    to the CMake Tools log file. This file is useful for
    :ref:`troubleshooting <troubleshooting>`.

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

``${variant_identifier}``
    *Replace ``variant_identifier`` with your variant identifier.*
    The currently selected choice of the given variant identifier.

Environment Variables
*********************

Additionally, environment variables may be substituted with ``${env:VARNAME}``
and ``${env.VARNAME}`` syntax, where the string for the ``VARNAME`` environment
variable will be replaced. If the named environment variable is undefined, an empty
string will be expanded instead.

Command Substitution
********************

CMake Tools also supports expanding of VSCode commands, similar to
``launch.json``. Running a command ``${command:foo.bar}`` will execute the
``foo.bar`` VSCode command and replace the string value. Beware of long-running
commands! It is unspecified when and how many times CMake Tools will execute a
command for a given expansion.
