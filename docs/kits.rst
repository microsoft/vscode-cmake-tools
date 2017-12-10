.. _kits:

CMake Kits
##########

**Kits** define the tools used to configure and build a project.

.. note::
    If you change the active Kit while a project is configured, the project
    configuration will be re-generated with the chosen kit.

How Are Kits Found and Defined?
===============================

Upon first startup, CMake Tools will scan the system for available toolchains.
It looks in certain directories for the presence of compilers or Visual Studio
installations (using ``vswhere``) to populate the initial list of Kits.

The list of kits is stored in a user-local file, which you can edit by invoking
*Edit CMake Kits* from the command palette. It will open the ``cmake-kits.json``
file:

.. image:: res/kits_json.png
    :align: center

Scanning Process
****************

The contents of this file can be updated by running *Scan for Kits* in the
command palette. The following steps are taken to find available kits:

#. **Search the current PATH for compilers**

    CMake tools will use the ``PATH`` environment variable for a list of
    directories where compilers can be found.

    CMake Tools looks for ``gcc`` and ``clang`` binaries and asks each
    executable for version information.

    For gcc, if a corresponding ``g++`` executable resides in the same
    directory it is added to the kit as the corresponding C++ compiler. The
    same applies for a ``clang++`` binary in the directory of a ``clang``
    executable.

    .. note::
        At the moment, CMake Tools will automatically detect *Clang* and
        *GCC* only. If you'd like auto-detection for more tools,
        please open an issue on the GitHub page with information about the
        compiler binary names and how to parse its version information.

#. **Ask VSWhere about Visual Studio installations**

    CMake tools will search for an installed ``vswhere.exe`` executable and
    invoke it to ask about existing Visual Studio instances installed on
    the system.

    For each of ``x86``, ``amd64``, ``x86_amd64``, ``x86_arm``, ``amd64_arm``,
    and ``amd64_x86``, CMake Tools will check for installed Visual C++
    environments. A kit is generated for each existing MSVC toolchain.

#. **Save results to cmake-kits.json**

    When finished, the ``cmake-kits.json`` file will be updated with the new
    kit information.

    .. warning::

        The ``name`` of each kit is generated from the kit compiler
        and version information, and kits with the same name will be
        overwritten in the file.

        To prevent custom kits from being overwritten, give them unique names.
        CMake Tools will not delete entries from ``cmake-kits.json``, only add
        and update existing ones.

Kit Types
=========

CMake defines three types of kits: *compiler kits*, *Visual Studio kits*, and
*toolchain file kits*. They are distinguished by the properties present in
their definition in ``cmake-kits.json``.

Compiler Kits
*************

A compiler kit simply lists the paths to compilers for CMake languages.

The most common CMake languages are ``C`` and ``CXX``, and CMake Tools has
built-in support for finding these, but any language can be specified:

.. code:: json

    {
        "name": "My Compiler Kit",
        "compilers": {
            "C": "/usr/bin/gcc",
            "CXX": "/usr/bin/g++",
            "Fortran": "/usr/bin/gfortran"
        }
    }

Toolchain Kits
**************

CMake Tools will not automatically detect them, but you can also specify a
CMake toolchain file as a kit:

.. code:: json

    {
        "name": "Emscripten",
        "toolchainFile": "/path/to/emscripten/toolchain.cmake"
    }

CMake Tools will pass this path for ``CMAKE_TOOLCHAIN_FILE`` during configure.

Visual Studio Kits
******************

CMake Tools will automatically setup the environment for working with Visual C++
when you use a Visual Studio code. It is advised to let CMake Tools
generate the kits first, then duplicate them and modify them.

.. code:: json

    {
        "name": "A Visual Studio",
        "visualStudio": "Visual Studio Build Tools 2017",
        "visualStudioArchitecture": "amd64"
    }

The ``visualStudio`` key corresponds to a name of a Visual Studio installation
obtained from VSWhere. The ``visualStudioArchitecture`` key corresponds to a
Visual Studio target architecture that would be passed to the ``vcvarsall.bat``
file when entering the VS dev environment.

Common Options
**************

All kit types also support some additional options:

``preferredGenerator``
    The CMake generator that should be used with this kit if not the default.
    CMake Tools will still search in ``cmake.preferredGenerators`` from
    ``settings.json``, but will fall back to this option if no generator
    from the user settings is available

``cmakeSettings``
    A JSON object that will be passed as a list of cache settings when running
    CMake configure. Don't use this for project-specific settings and options:
    Prefer to use the ``settings.json`` for that purpose.

    This setting is most useful when the toolchain file respects additional
    options that can be passed as cache variables.