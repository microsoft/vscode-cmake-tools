.. _variants:

CMake Variants
##############

CMake Tools introduces the concept of *CMake Variants*, a way to group together
and combine a common set of build options and give them a useful name. The main
interface for creating and building variants is ``cmake-variants.json``, or
``cmake-variants.yaml``.

The idea of "variants" are separate from the concept of toolchains/toolsets,
which are handled via :ref:`Kits <kits>`.

By default, if no variants file is present, CMake Tools will load four variants,
each corresponding to a default CMake build type: *Release*, *Debug*,
*MinSizeRel*, and *RelWithDebInfo*. Selecting one of these variants will
configure and build with that build type.

.. note::
    CMake Tools does not presently respect ``CMAKE_CONFIGURATION_TYPES``. Only
    the default four will be present. A custom variant file is required to load
    these build types.

For smaller or simple projects, providing a custom ``cmake-variants.yaml`` is
unnecessary, and the default CMake build types will work just fine. Large
projects with more complex configuration options make want to specify
additional build variants.

The variants file can be placed in the root of the project directory, or in the
``.vscode`` subdirectory for the project.

.. note::

    CMake Tools provides a YAML validation schema, which is only checked in the
    editor when using the *YAML Support by Red Hat* extension.

    You can use either ``cmake-variants.json`` or ``cmake-variants.yaml``. Both
    will have the same end result.

    The examples in this page will use the YAML format, but everything can be
    done in the JSON format as well.

What does it look like?
=======================

A simple two-setting ``cmake-variants.yaml`` might look like this:

.. image:: res/variants_yaml.png
    :align: center

This file defines two variant **settings**: *buildType* and *useOpenGL*. They
each have two **options** defined by the ``choices`` key.

In total, the number of possible variants is defined by the cartesian product
of the possible choices. Two **settings** each with two **options** creates
*four* variants. When we ask to change the build type, CMake Tools will present
each possible combination in a quickpick:

.. image:: res/custom_variant_selector.png
    :align: center

When a ``cmake-variants.json`` or ``cmake-variants.yaml`` file is present, the
options defined therein will replace the default set of variants CMake Tools
would otherwise present. This allows a project owner to define their own set of
common build configurations that can be distributed downstream.

The Variant Schema
==================

The root of the variants must be an object, where each key represents a
tweakable variant option. In the example above, we expose a ``buildType`` option
for what kind of ``CMAKE_BUILD_TYPE`` we want. We also expose a ``useOpenGL``
that controls the ``ENABLE_OPENGL`` CMake option.

Variant Settings
****************

Each *setting* in the variant is an object with the following keys:

``default``
    A string to set as the default value for the variant option. The string here
    must correspond to an option from ``choices``.

``description``
    An optional string to describe what the option controls. CMake Tools ignores
    this string.

``choices``
    A mapping of possible options for the setting. A variant setting can have an
    arbitrary number of possible options. See the section below on options.

.. _variants.opts:

Variant Options
***************

Variant options appear under the ``choices`` key for a variant setting. Each is
required to have an unique name, but the name itself is unimportant to CMake
Tools.

The option is itself a map with the following keys:

``short``
    A short human-readable string to describe the option.

``long`` (Optional)
    A lengthier human-readable string to describe the option.

``buildType`` (Optional)
    An optional string to set for ``CMAKE_BUILD_TYPE`` when the option is
    active.

``linkage`` (Optional)
    Either ``static`` or ``shared``. Sets the value of
    ``CMAKE_BUILD_SHARED_LIBS``. This value is optional.

``settings`` (Optional)
    A map of arbitrary CMake cache options to pass via the CMake command line
    with ``-D``. Similar to the ``cmake.configureSettings`` in
    ``settings.json``.

``env`` (Optional)
    A map of key-value string pairs specifying additional environment variables
    to set during CMake *configure* (not build). These environment variables
    take precedence over environment variables from ``settings.json``, the
    currently set :ref:`kit <kits>`, and environment variables set by the
    system.

How Variants Are Applied
========================

A variant is a specific combination of one *option* from each of the defined
*settings*. When CMake Tools executes the configure step, it will use the
values from the currently active variant to determine the values to pass to the
CMake process:

#. Properties from all active options are merged. For ``env`` and ``settings``,
   the objects themselves are merged. The merge order is unspecified, so
   conflicting properties in options will result in unspecified behavior.
#. All ``settings`` from the chosen options are passed as ``-D`` arguments to
   the CMake process.
#. The ``buildType`` is used for ``CMAKE_BUILD_TYPE``, the ``--config``
   parameter to the build (For multi-conf generators), and for the CTest
   ``--config`` flag.
#. If ``linkage`` is ``true``, ``BUILD_SHARED_LIBS`` is set to ``ON``. If
   ``linkage`` is ``false``, ``BUILD_SHARED_LIBS`` is set to ``OFF``. If not
   specified, ``BUILD_SHARED_LIBS`` will not be set on the CMake command line.
#. The environment variables from ``env`` are set for the CMake process.

A Big Example
=============

Suppose the following variants file:

.. code-block:: yaml

    buildType:
      default: debug
      choices:
        debug:
          short: Debug
          long: Emit debug information
          buildType: Debug
        release:
          short: Release
          long: Optimize generated code
          buildType: Release
        asan:
          short: Asan
          long: Instrument with Address Sanitizer
          buildType: Asan
        tsan:
          short: Tsan
          long: Instrument with Thread Sanitizer
          buildType: Tsan

    linkage:
      default: static
      choices:
        static:
          short: Static
          long: Create static libraries
          linkage: static
        shared:
          short: Shared
          long: Create shared libraries/DLLs
          linkage: shared

    engine:
      default: ogl
      choices:
        ogl:
          short: OpenGL
          long: OpenGL rendering
          settings:
            ENGINE: OpenGL
        d3d:
          short: Direct3D
          long: Direct3D rendering
          settings:
            ENGINE: Direct3D
        vulkan:
          short: Vulkan
          long: Vulkan rendering
          setting:
            ENGINE: Vulkan
        software:
          short: Software
          long: Software rendering
          setting:
            ENGINE: Software

    network:
      default: boost
      choices:
        boost:
          short: Boost.Asio
          long: Use Boost.Asio for networking
          setting:
            NETWORK: Boost
        asio:
          short: Asio
          long: Use standalone-Asio for networking
          setting:
            NETWORK: Asio
        net-ts:
          short: NetTS
          long: Use the C++ Networking TS for networking
          setting:
            NETWORK: net-ts

CMake Tools will present the cartesian product of all options, meaning the
above will produce 4 × 2 × 4 × 3 = *ninety-six* different variants:

.. image:: res/many_variants.png
    :align: center

Of course this is quite a lot of possible variants, but such is the way with
some complex software. CMake Tools will readily any helpfully show all
combinations, and persist the selection between sessions.