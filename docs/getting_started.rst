Getting Started
###############

Assuming you already have a CMake project to configure, skip to the
:ref:`configuring` section.

.. _configuring:

Configuring Your Project
************************

Configuring a project is simple, but has two steps before configuration can take
place.

Pre-Configure Steps
===================

Selecting a Kit
---------------

Before we can configure, you must select a *Kit*.

What are kits?
    Kits represent a *toolchain*: A set of compilers, linkers, or other tools
    that will be used to build a project. If you have no Kit selected, CMake
    Tools will start by asking you to select a Kit.

When first opening a project, a status bar item will read **No Kit Selected**:

.. image:: res/no_kits.png
    :align: center

To select a kit, click this statusbar button, or run the *Select a Kit* command
from the command palette. A quick-pick will appear:

.. image:: res/kit_selector.png
    :align: center

Upon choosing a kit, the statusbar button will display the name of the active
kit:

.. image:: res/kit_selected.png
    :align: center

The chosen kit will be remembered between sessions. Should the availability of
the kit change, the statusbar item may revert and you will be required to select
a kit again.

.. note::
    If you try to configure your project without an active Kit selected, you
    will be prompted to choose one before configuring can proceed.

CMake Tools will use the compilers/toolchain from the kit when building your
project.

Find out more on the :ref:`kits` page.