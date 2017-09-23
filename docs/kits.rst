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

.. image:: kits-json.png
    :align: center
