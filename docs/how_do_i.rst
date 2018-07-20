.. _how-do-i:

How Do I...
###########

This page talks about and links to documentation concerning common tasks and
processes.

Create a New Project?
*********************

- Run the *CMake: Quick Start* command in a directory with no ``CMakeLists.txt``.

Check out :ref:`gs.quickstart`.

Configure a Project?
********************

- Run the *CMake: Configure* command.

Check out the :ref:`Getting Started - Configuring <gs.configuring>` section,
or the more in-depth :ref:`configuring` documentation.

Build a Project?
****************

- Run the *CMake: Build* command, press :kbd:`F7`, or press the *Build* button
  in the status bar.

See the :ref:`Getting Started - Building <gs.building>` section, or the
in-depth :ref:`building` documentation.

Debug a Project?
****************

- Run the *CMake: Debug Target* command, press :kbd:`Ctrl+F5`, or press the
  *Debug* button in the status bar.

There's a lot to this one. Check out the :ref:`debugging` page for more
information.

Pass Command Line Argument to the Debugger?
*******************************************

See the :ref:`debugging.launch-json` documentation.

.. _hdi.intellisense:

Set Up Include Paths for C++ IntelliSense?
******************************************

CMake Tools currently supports Microsoft's cpptools extension.
If the cpptools extension is installed and enabled, then configuring your
project will attempt this integration automatically.

The first time this integration is attempted, cpptools will show a prompt
confirming that you wish to use CMake Tools to provide the configuration
information for your project. Accepting this prompt is all you need to do to
activate the integration. From then on, CMake Tools will provide and
automatically update cpptools' configuration information for each source file
in your project.

Happy IntelliSense-ing!
