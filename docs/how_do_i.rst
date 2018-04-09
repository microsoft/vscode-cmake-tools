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

CMake Tool's won't do this on its own, but you can `use compile_commands.json
in conjunction with Microsoft's cpptools extension.
<https://github.com/Microsoft/vscode-cpptools/blob/f5b2d3018253447b462aa5eb73c2099c68ebb24e/Documentation/Getting%20started%20with%20IntelliSense%20configuration.md>`_.

Set the value of ``compileCommands`` to point to ``<build-dir>/compile_commands.json``,
where ``<build-dir>`` is the build directory used by CMake Tools. The default
build directory is ``${workspaceRoot}/build``, so the default value of
``compileCommands`` would be ``${workspaceRoot}/build/compile_commands.json``.