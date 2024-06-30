# Troubleshoot CMake Tools

## Common Issues and Resolutions

### Error: CMake Tools is unable to provide IntelliSense configuration

If you see a message that CMake Tools can't provide IntelliSense configuration, or see that #include directives are not resolving in the editor (the #include directive has a green underline), this means that the relevant source file is not attached to a CMake target.

If the file that receives this message is outside of your project, it is safe to ignore it.

If you are receiving this message for files within your project, you probably need to add the source file to a target.

This issue is most common with header files in a project. Header files should be included in the source list of a target. Even though CMake will not try to compile or process these headers in any special way, CMake Tools uses this information to provide a better user experience.

### Green squiggles beneath #include directives

See above.

### Debugging ignores launch.json

If the **Debug** button and Debug target features are ignoring your `launch.json` file, refer to [Debug using a launch.json file](debug-launch.md#debug-using-a-launchjson-file).

> **Important:** The target debugging feature is restricted to launching target executables with a default configuration in the `ms-vscode.cpptools` debugging engine.

### Reset CMake Tools extension state

CMake Tools persists workspace settings for things like the active target and variant. If this state is corrupted or inconsistent, open the VS Code command pallette and reset it by running the **CMake: Reset CMake Tools extension state** command.

Resetting the state will automatically reload the current workspace.

### Increase the logging level

CMake Tools provides optional logging that isn't enabled by default. Use the [cmake.loggingLevel](cmake-settings.md) setting to increase the amount of output written to the _CMake/Build_ output channel.

### Check the log file

Regardless of the user-visible log level, CMake Tools writes all log entries, for all levels, to a user-local log file. Open the VS Code command pallette and run the *CMake: Open the CMake Tools log file* command to view this log file.

This file is user-local, not workspace-local. This file includes all log entries since the extension was installed and may be very large.

## Get help

Check the [CMake Tools issue tracker](https://github.com/microsoft/vscode-cmake-tools/issues) and [What's New](../CHANGELOG.md) to see if your issue is already known/solved before submitting a question or bug report. Feel free to open an issue if your problem hasn't been reported.

Please visit [the support chat](https://gitter.im/vscode-cmake-tools/support). This is a community chat. Microsoft does not monitor it.