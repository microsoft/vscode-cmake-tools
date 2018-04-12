.. _debugging:

Target Debugging and Launching
##############################

CMake Tools removes some of the friction required in setting up debugging.
Because C and C++ projects may define multiple (sometimes dozens or even
hundreds) of executables, creating a ``launch.json`` may be difficult, tedious,
and error-prone.

If you define any executable targets via CMake, CMake Tools will be aware of
them and allow you to start a debugger on them.

Selecting a Launch Target
*************************

The "launch target" or "debug target" is initially unset. The first time you try
to run target debugging, CMake Tools will ask you to specify a target, which
will be persisted between sessions.

The active launch target is shown in the status bar to the right of the *Debug*
button:

.. image:: res/launch_target.png
    :align: center

Pressing this button will show the launch target selector and lets one change
the active launch target.

Quick Debugging
***************

Quick-debugging lets you start a debugger on a target without ever creating
a ``launch.json``.

.. note::
    At the moment, only the debugger from Microsoft's ``vscode-cpptools``
    extension is supported with quick-debugging. See :ref:`debugging.launch-json`
    below for using ``launch.json`` and other debuggers.

Quick debugging can be started using the *CMake: Debug Target* command from
the command pallette, or by pressing the associated hotkey (the default is
:kbd:`Ctrl+F5`).

.. note::
    Quick-debugging does not let you specify program arguments or other
    debugging options. See :ref:`debugging.launch-json` for more options.

.. _debugging.launch-json:

Debugging with CMake Tools and ``launch.json``
**********************************************

Sometimes, more flexibility is needed for debugging, including setting things
like the working directory or command line arguments. In addition, one may want
to use a debugger other than the one included with Microsoft's
``vscode-cpptools``.

All these things can be done using ``launch.json``. The primary obstacle to
using ``launch.json`` is that the path to the executable binary might be
difficult to know in advance. CMake Tools can help by using
*Command substitution* in ``launch.json``. This is already used by things like
the process selection when attaching to a running process. It works by simply
specifying a a command-based substitution in the appropriate field of
``launch.json``.

Here is a minimal example of a ``launch.json`` that uses the
``cmake.launchTargetPath`` to start a debugger on the active selected launch
target:

.. code:: javascript

    {
        "version": "0.2.0",
        "configurations": [
            {
                "name": "(gdb) Launch",
                "type": "cppdbg",
                "request": "launch",
                // Resolved by CMake Tools:
                "program": "${command:cmake.launchTargetPath}",
                "args": [],
                "stopAtEntry": false,
                "cwd": "${workspaceFolder}",
                "environment": [],
                "externalConsole": true,
                "MIMode": "gdb",
                "setupCommands": [
                    {
                        "description": "Enable pretty-printing for gdb",
                        "text": "-enable-pretty-printing",
                        "ignoreFailures": true
                    }
                ]
            }
        ]
    }

The value of the ``program`` attribute is resolved by CMake Tools to the
absolute path to the program to run.

.. note::
    A successful :ref:`configure <configuring>` must be executed before
    ``cmake.launchTargetPath`` will resolve correctly.

Running Targets Without a Debugger
**********************************

Sometimes one will want to just run a target and see its output. This can
be done with the *CMake: Execute the current target without a debugger* command,
or the associated keybinding (the default is :kbd:`Shift+F5`).

The output of the target will be shown in an integrated terminal.
