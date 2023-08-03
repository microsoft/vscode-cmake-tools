# CMake Debugging

Starting with CMake 3.27, debugging CMake is now supported in CMake Tools!

The following documentation will help you understand the various ways you can debug CMake.

## Debugging from CMake Tools UI entry points

The most common reason to debug CMake is to debug CMake Configuration! There are many ways that you can accomplish this:

* Commands
  * CMake: Configure with CMake Debugger
  * CMake: Delete Cache and Reconfigure with CMake Debugger
* Folder Explorer
  * Right click on CMakeLists.txt context menu entry.
* Project Outline
  * Right click on CMakeLists.txt context menu entry.
  * Expand the "..." in the project outline. There is an entry to use the Debugger!

## Debugging from CMake Tools launch.json

CMake Tools now provides a new debug type `cmake`!

The `cmake` debug type supports three different types of `cmakeDebugType`: `configure`, `external`, `script`. They each come with their own settings that can be used to modify and control the debug session!

Listed below are the settings that are available for each configuration based on `cmakeDebugType`:

* `configure`
  * required
  * optional
    * `pipeName` - Name of the pipe (on Windows) or domain socket (on Unix) to use for debugger communication.
    * `clean` - Clean prior to configuring.
    * `configureAll` - Configure for all projects.
    * `dapLog` - Where the debugger DAP log should be logged.
* `external`
  * required
    * `pipeName` - Name of the pipe (on Windows) or domain socket (on Unix) to use for debugger communication.
  * optional
* `script`
  * required
    * `scriptPath` - The path to the script to debug.
  * optional
    * `scriptArgs` - Arguments for the script to debug.
    * `scriptEnv` - Environment for the script to use.
    * `pipeName` - Name of the pipe (on Windows) or domain socket (on Unix) to use for debugger communication.
    * `dapLog` - Where the debugger DAP log should be logged.

The `cmake` debug type only supports the `request` type: `launch`.
