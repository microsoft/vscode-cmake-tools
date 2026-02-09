# CMake: Debug and launch

CMake Tools makes it easier to set up debugging. Because C and C++ projects may define multiple (sometimes dozens or even hundreds) of executables, creating a `launch.json` may be difficult.

If you define any executable targets via CMake, CMake Tools will be aware of them and allow you to start debugging them.

> **Note:**
> Debugging is supported when CMake is using either _CMake Server_ or the cmake-file-api. These modes are enabled automatically for CMake versions 3.7.2 and above. Debugging is not available on older versions.

If you are running an older version of CMake and want to use target debugging, update your CMake version to version 3.7.2 or higher.

By default, launching or debugging an executable target causes it to be built first. This can be disabled with the [cmake.buildBeforeRun](cmake-settings.md#cmake-settings) setting.

## Select a launch target

The first time you run target debugging, CMake Tools asks for you to specify a target, which will be persisted between sessions.

The active launch target is shown in the CMake Tools sidebar Project Status View under the `Launch` node:

![Image of launch target to the right of the debug and run button](images/launch-debugv2.png)

Selecting the active launch target button will show the launch target selector so that you can change the active launch target.

From there, you can press the play button by the `Launch` node to run it in terminal.

![Image of running in terminal when you hover over the Launch node](images/launch-target.png)

## Debugging without a launch.json

CMake Tools lets you start a debugger on a target without creating a `launch.json`.

> **Note:**
> Only the debugger from Microsoft's `vscode-ms-vscode.cpptools` extension supports quick-debugging. See [Debug using a launch.json file](#debug-using-a-launchjson-file), below, for information about `launch.json` and using other debuggers.

Start a debugging session on the active target by running the *CMake: Debug* command from the VS Code command palette, by selecting the Debug button in the status bar or CMake Tools sidebar Project Status View, or by pressing the keyboard shortcut (the default is **Shift+F5**).

![Image of launching the debugger for the selected target](images/debug-targetv2.png)

> **Note:**
> Quick-debugging does not let you specify program arguments or other debugging options. See the next section for more options.

## Debug using a launch.json file

You can specify the working directory or command line arguments for debugging, or use another debugger than the one included with Microsoft's `vscode-ms-vscode.cpptools`, by creating a `launch.json` file.

You'll need to know the path to the executable binary, which may be difficult to know in advance. CMake Tools can help by using [command substitution](cmake-settings.md#command-substitution) in the `launch.json` file. This is already used by things like process selection when attaching to a running process. It works by specifying a command-based substitution in the appropriate field of `launch.json`.

Here are minimal examples of a `launch.json` file that uses `cmake.launchTargetPath` and `cmake.getLaunchTargetDirectory` to start a debugger on the active launch target:

### gdb

```jsonc
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
            "environment": [
                {
                    // add the directory where our target was built to the PATHs
                    // it gets resolved by CMake Tools:
                    "name": "PATH",
                    "value": "${env:PATH}:${command:cmake.getLaunchTargetDirectory}"
                },
                {
                    "name": "OTHER_VALUE",
                    "value": "Something something"
                }
            ],
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
```
### lldb
```jsonc
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "(lldb) Launch",
            "type": "cppdbg",
            "request": "launch",
            // Resolved by CMake Tools:
            "program": "${command:cmake.launchTargetPath}",
            "args": [],
            "stopAtEntry": false,
            "cwd": "${workspaceFolder}",
            "environment": [
                {
                    // add the directory where our target was built to the PATHs
                    // it gets resolved by CMake Tools:
                    "name": "PATH",
                    "value": "${env:PATH}:${command:cmake.getLaunchTargetDirectory}"
                },
                {
                    "name": "OTHER_VALUE",
                    "value": "Something something"
                }
            ],
            "externalConsole": true,
            "MIMode": "lldb"
        }
    ]
}
```
### msvc
```jsonc
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "(msvc) Launch",
            "type": "cppvsdbg",
            "request": "launch",
            // Resolved by CMake Tools:
            "program": "${command:cmake.launchTargetPath}",
            "args": [],
            "stopAtEntry": false,
            "cwd": "${workspaceFolder}",
            "environment": [
                {
                    // add the directory where our target was built to the PATHs
                    // it gets resolved by CMake Tools:
                    "name": "PATH",
                    "value": "${env:PATH}:${command:cmake.getLaunchTargetDirectory}"
                },
                {
                    "name": "OTHER_VALUE",
                    "value": "Something something"
                }
            ],
            "externalConsole": true
        }
    ]
}

```
### ctest
```jsonc
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "(ctest) Launch",
            "type": "cppvsdbg",
            "request": "launch",
            // Resolved by CMake Tools:
            "program": "${command:cmake.launchTargetPath}",
            "args": [],
            "stopAtEntry": false,
            "cwd": "${workspaceFolder}",
            "environment": [
                {
                    // add the directory where our target was built to the PATHs
                    // it gets resolved by CMake Tools:
                    "name": "PATH",
                    "value": "${env:PATH}:${command:cmake.getLaunchTargetDirectory}"
                },
                {
                    "name": "OTHER_VALUE",
                    "value": "Something something"
                }
            ],
            "externalConsole": true
        }
    ]
}

```

The value of the `program` attribute is expanded by CMake Tools to be the absolute path of the program to run.

### Cache variable substitution

You can substitute the value of any variable in the CMake cache by adding a `command`-type input for the `cmake.cacheVariable` command to the `inputs` section of `launch.json` with `args.name` as the name of the cache variable. That input can then be used with input variable substitution of values in the `configuration` section of `launch.json`. The optional `args.default` can provide a default value if the named variable isn't found in the CMake cache.

```jsonc
{
    "version": "0.2.0",
    "inputs": [
        {
            "id": "cmakeCache.TOOLCHAIN_FILE",
            "type": "command",
            "command": "cmake.cacheVariable",
            "args": {
                "name": "CMAKE_TOOLCHAIN_FILE"
            }
        }
    ]
}
```

> **Note:**
> You must successfully [configure](configure.md) before `cmake.launchTargetPath`, `cmake.getLaunchTargetDirectory` and `cmake.cacheVariable` will resolve correctly.

## Debugging tests

You can also construct launch.json configurations that allow you to debug tests in the Test Explorer.

There are two forms of these variables:
- `${command:cmake.testProgram}`, `${command:cmake.testArgs}`, `${command:cmake.testWorkingDirectory}` — These are resolved as VS Code command substitutions and work both from the **Test Explorer** and the **Run and Debug** panel. When launched from Run and Debug, you will be prompted to select a test.
- `${cmake.testProgram}`, `${cmake.testArgs}`, `${cmake.testWorkingDirectory}` — These are only resolved when launching from the **Test Explorer** UI. If used from the Run and Debug panel, they will not be substituted.

The easiest way to do this is to construct the debug configuration using `cmake.testProgram` for the `program` field, `cmake.testArgs` for 
the `args` field, and `cmake.testWorkingDirectory` for the `cwd` field.

A couple of examples:

### gdb
```jsonc
{
    "name": "(ctest) Launch",
    "type": "cppdbg",
    "request": "launch",
    // Resolved by CMake Tools:
    "cwd": "${command:cmake.testWorkingDirectory}",
    "program": "${command:cmake.testProgram}",
    "args": [ "${command:cmake.testArgs}"],
}
```
### msvc
```jsonc
{
    "name": "(ctest) Launch",
    "type": "cppvsdbg",
    "request": "launch",
    // Resolved by CMake Tools:
    "program": "${command:cmake.testProgram}",
    "args": [ "${command:cmake.testArgs}"],
}
```

Depending on your configuration or your settings, there may need to be additional configuration options set.

To use a specific launch configuration when debugging tests, set `cmake.ctest.debugLaunchTarget` to the desired name of the configuration (e.g. `(ctest) Launch`).

## Run without debugging

You can run a target without debugging it, by running the *CMake: Run Without Debugging* from VS Code's command palette, by selecting the play button in the status bar or the play button to the left of the Launch node, or by pressing the keyboard shortcut (**Shift+Ctrl+F5**).

![Image of launching the selected target in the terminal window](images/launch-target.png)

The output of the target will be shown in an integrated terminal.

## Next steps

- See how to [troubleshoot CMake Tools](troubleshoot.md)
- Explore the [CMake Tools documentation](README.md)
