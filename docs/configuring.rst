.. _configuring:

CMake Configuring
#################

CMake Tools wraps the CMake *configure* process separately from the *build*
process.

.. seealso::
    - :ref:`getting-started`

A Crash-Course on CMake's Configuration Process
***********************************************

For those new to CMake, *Configure* refers to the process of detecting
requirements and generating the build files that will produce the final
compiled artifacts.

To understand how CMake Tools interacts with CMake's configure process, a few
things must be discussed:

- The *CMake Cache* is a list of key-value pairs that persist between
  executions of the configure process. It contains a few different types of
  values:

  - Values that are often heavy or slow to compute, such as whether a ``-flag``
    or ``#include`` file is supported by the compiler.
  - Values that rarely change, such as the path to a header/library.
  - Values that offer control to the developer, such as ``BUILD_TESTING``
    to determine whether or not to build test libraries/executables.

- *Cache initializer arguments* are the arguments passed to CMake that set
  values in the cache before any CMake scripts are executed. This lets one
  control build settings. On the CMake command line, these appear as ``-D``
  arguments [#cache-init]_.

- Unless overwritten or deleted, values in the CMake Cache will persist between
  executions of CMake.

- The result of a *configure* depends on the CMake *Generator*. The *Generator*
  tells CMake what kind of tool will be used to compile and generate the results
  of the build, since CMake doesn't do the build itself. There are several
  families of generators available:

  - *Ninja* - Emits files for the `Ninja build tool <https://ninja-build.org/>`_.
    This is the generator CMake Tools will always try first, unless configured
    otherwise. (See :ref:`conf-cmake.preferredGenerators`).
  - *Makefile* - Emits a ``Makefile`` for the project that can be built via
    ``make``.
  - *Visual Studio* - Emits visual studio solutions and project files. There are
    many different Visual Studio generators, so it is recommended to let CMake
    Tools automatically determine the appropriate generator.

  Regardless of generator, CMake Tools will always support building from within
  Visual Studio Code. Choosing a particular generator is unimportant
  [#use-ninja]_.

.. Check if this still applies in the future:

.. [#cache-init]
    CMake also supports a ``-C`` argument, but this isn't used by or
    configurable from CMake Tools.

.. [#use-ninja]
    But you should use `Ninja <https://ninja-build.org/>`_.

.. _configuring.how:

How CMake Tools Configures
**************************

CMake Tools speaks to CMake over *CMake Server*, an execution mode of CMake
wherein a persistent connection is held open to query information and get
project information.

When CMake Tools runs the configure step, it takes a few things into
consideration to run the configuration:

#. *The active kit* - :ref:`CMake Tools' Kits <kits>` tell CMake Tools about the
   toolchains available on your system that can be used with CMake to build
   your projects.

   -  For :ref:`kits.types.toolchain`, CMake Tools sets the CMake cache variable
      ``CMAKE_TOOLCHAIN_FILE`` to the path to the file specified by the kit.
   -  For :ref:`kits.types.compiler`, CMake Tools sets the ``CMAKE_<LANG>_COMPILER``
      cache variable to point to the path for each ``<LANG>`` defined in the
      kit.
   -  For :ref:`kits.types.vs`, CMake Tools starts the CMake Server process with the
      environment variables necessary to use the selected Visual Studio
      installation. It also sets ``CC`` and ``CXX`` to ``cl.exe`` to force
      CMake to detect the Visual C++ compiler as the primary compiler, even if
      other compilers like GCC are present on the ``$PATH``.

   Each kit may also define additional cache variable settings requires for the
   kit to operate. A kit may also define a ``preferredGenerator``.

   .. seealso::
      - :ref:`kits` - Describes how Kits work
      - :ref:`kits.types` - The different types of kits

#. *The generator to use* - CMake Tools tries not to let CMake decide implicitly
   on which generator to use. Instead it tries to detect a "preferred" generator
   from a variety of sources, stopping when it finds a valid generator:

   #. The config setting :ref:`conf-cmake.generator`.
   #. The config setting :ref:`conf-cmake.preferredGenerators` - Each element
      in this list is checked for validity, and if one matches, it is chosen.
      The list has a reasonable default that will work for most environments.
   #. The kit's :ref:`preferredGenerator <kits.common.preferredGenerator>`
      attribute. Automatically generated Visual Studio kits will set this
      attribute to the Visual Studio generator matching their version.
   #. If no generator is found, CMake Tools produces an error.

#. *The configuration options* - CMake Tools has a variety of locations where
   configuration options can be defined. They are searched in order and merged
   together, with later searches taking precedence in case of overlapping keys:

   #. The :ref:`conf-cmake.configureSettings` option from ``settings.json``.
   #. The ``settings`` value from the active :ref:`variants.opts`.
   #. ``BUILD_SHARED_LIBS`` is set based on :ref:`variants.opts`.
   #. ``CMAKE_BUILD_TYPE`` is set based on :ref:`variants.opts`.
   #. ``CMAKE_INSTALL_PREFIX`` is set based on :ref:`conf-cmake.installPrefix`.
   #. ``CMAKE_TOOLCHAIN_FILE`` is set for :ref:`kits.types.toolchain`.
   #. The :ref:`cmakeSettings <kits.common.cmakeSettings>` attribute on the
      active kit.

   Additionally, :ref:`conf-cmake.configureArgs` are passed *before* any of
   the above.

#. *The configure environment* - CMake Tools sets environment variables for the
   child process it runs for CMake. Like the configuration options, values are
   merged from different sources, with later sources taking precedence:

   #. The environment variables required by the active :ref:`kit <kits>`.
   #. The value of :ref:`conf-cmake.environment`.
   #. The value of :ref:`conf-cmake.configureEnvironment`.
   #. The environment variables required by the active :ref:`variant <variants>`.

All of the above are taken into account to perform the configure. Once finished,
CMake Tools will load project information from CMake and generate diagnostics
based on CMake's output. :ref:`You are now ready to build! <building>`

Configuring Outside of CMake Tools
**********************************

CMake Tools is built to play nicely with an external CMake process. If you
choose to run CMake from another command line or other IDE/tool, all should
work successfully (provided the host environment is set up properly).

Nevertheless, be aware: CMake Tools will be unaware of any changes made by an
external CMake process, and you will need to re-run the CMake configure within
CMake Tools to have up-to-date project information.

A "Clean" Configure
*******************

CMake Tools also has the concept of a "clean configure," executed by running
*CMake: Delete cached built settings and reconfigure*. The process consists
simply of deleting the ``CMakeCache.txt`` file and ``CMakeFiles`` directory
from the build directory. This is enough to reset all of CMake's default state.
Should additional cleaning be necessary, it must be done by hand.

This process is required for certain build system changes, but may be convenient
as a "reset" if you have tweaked any configuration settings outside of CMake
Tools.

CMake Tools will also do this *automatically* if you change the active
:ref:`kit <kits>`. CMake can't yet properly handle changing the toolchain
without deleting the configuration data.
