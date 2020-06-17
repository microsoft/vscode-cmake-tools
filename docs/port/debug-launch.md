
[Source](https://vector-of-bool.github.io/docs/vscode-cmake-tools/debugging.html "Permalink to Target Debugging and Launching — CMake Tools 1.4.0 documentation")

# Target Debugging and Launching — CMake Tools 1.4.0 documentation

CMake Tools removes some of the friction required in setting up debugging. Because C and C++ projects may define multiple (sometimes dozens or even hundreds) of executables, creating a `launch.json` may be difficult, tedious, and error-prone.

If you define any executable targets via CMake, CMake Tools will be aware of them and allow you to start a debugger on them.

Note

Debugging is only supported when using _CMake Server_ mode. This mode will be enabled automatically on CMake versions at least as new as 3.7.2, but is completely unavailable on older CMake versions.

Target debugging used to be supported on prior versions, but was difficult and error-prone, creating more problems than it solved. If you are running an older CMake version and wish to use target debugging, you'll have to update your CMake version.

By default, the launch or debug of an executable target will cause it to be built.

## Selecting a Launch Target

The "launch target" or "debug target" is initially unset. The first time you try to run target debugging, CMake Tools will ask you to specify a target, which will be persisted between sessions.

The active launch target is shown in the status bar to the right of the _Debug_ button:

![_images/launch_target.png][1]

Pressing this button will show the launch target selector and lets one change the active launch target.

## Quick Debugging

Quick-debugging lets you start a debugger on a target without ever creating a `launch.json`.

Note

At the moment, only the debugger from Microsoft's `vscode-cpptools` extension is supported with quick-debugging. See [Debugging with CMake Tools and launch.json][2] below for using `launch.json` and other debuggers.

Quick debugging can be started using the _CMake: Debug Target_ command from the command pallette, or by pressing the associated hotkey (the default is Ctrl+F5).

## Running Targets Without a Debugger

Sometimes one will want to just run a target and see its output. This can be done with the _CMake: Execute the current target without a debugger_ command, or the associated keybinding (the default is Shift+F5).

The output of the target will be shown in an integrated terminal.

[1]: https://vector-of-bool.github.io/_images/launch_target.png
[2]: https://vector-of-bool.github.io#debugging-launch-json

  