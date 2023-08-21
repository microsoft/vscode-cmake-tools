# CMake Debugging

Starting with CMake 3.27, debugging CMake is supported in CMake Tools.

The following documentation will help you understand the various ways you can debug CMake scripts and cache generation.

## Debugging from CMake Tools UI entry points

The most common reason to debug CMake scripts and cache generation is to debug CMake cache generation. There are many ways that you can accomplish this:

* Commands
  * CMake: Configure with CMake Debugger
  * CMake: Delete Cache and Reconfigure with CMake Debugger
* Folder Explorer
  * Right click on CMakeLists.txt -> Configure All Projects with CMake Debugger.
* Project Outline
  * Right click on CMakeLists.txt -> Configure All Projects with CMake Debugger.
  * Expand the "..." in the project outline. There is an entry to use the Debugger.

## Debugging from launch.json

CMake Tools provides a new debug type `cmake`.

The `cmake` debug type supports three different types of `cmakeDebugType`: `configure`, `external`, `script`. They each come with their own settings that can be used to modify and control the debug session.

### Example launch.json

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "cmake",
            "request": "launch",
            "name": "CMake script debugging",
            "cmakeDebugType": "script",
            "scriptPath": "${workspaceFolder}/<script>.cmake"
        },
        {
            "type": "cmake",
            "request": "launch",
            "name": "Debug externally launched CMake process",
            "cmakeDebugType": "external",
            "pipeName": "<insert-pipe-name>"
        }
    ]
}
```

Listed below are the settings that are available for each configuration based on `cmakeDebugType`:

* `configure`
  * required: none
  * optional
    * `pipeName` - Name of the pipe (on Windows) or domain socket (on Unix) to use for debugger communication.
    * `clean` - Clean prior to configuring.
    * `configureAll` - Configure for all projects.
    * `dapLog` - Where the debug adapter protocol (DAP) communication should be logged. If omitted, DAP communication is not logged.
* `external`
  * required
    * `pipeName` - Name of the pipe (on Windows) or domain socket (on Unix) to use for debugger communication.
  * optional
* `script`
  * required
    * `scriptPath` - The path to the CMake script to debug.
  * optional
    * `scriptArgs` - Arguments for the CMake script to debug.
    * `scriptEnv` - Environment for the CMake script to use.
    * `pipeName` - Name of the pipe (on Windows) or domain socket (on Unix) to use for debugger communication.
    * `dapLog` - Where the debug adapter protocol (DAP) communication should be logged. If omitted, DAP communication is not logged.

The `cmake` debug type only supports the `request` type: `launch`.
