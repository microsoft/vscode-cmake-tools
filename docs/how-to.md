# How To

This page links to documentation for common tasks.

## Create a new project

* From the command palette in VS Code, run the **CMake: Quick Start** command in a directory that doesn't have a `CMakeLists.txt` file.
* See the [CMake Tools on Linux tutorial](https://code.visualstudio.com/docs/cpp/cmake-linux#_create-a-cmake-hello-world-project)

## Configure a project

* From the command palette in VS Code, run the **CMake: Configure** command.
* See the *Configure Hello World* section of the [CMake Tools on Linux tutorial](https://code.visualstudio.com/docs/cpp/cmake-linux#_configure-hello-world), or the more in-depth [CMake Tools configure step](configure.md#the-cmake-tools-configure-step) documentation.

## Build a project

* From the command palette in VS Code, run the **CMake: Build** command, press the keyboard shortcut **F7**, or select the **Build** button in the status bar.
* See the *Build hello world* section of the [CMake Tools on Linux tutorial](https://code.visualstudio.com/docs/cpp/cmake-linux#_build-hello-world), or the more in-depth  [Build with CMake Tools](build.md) documentation.

## Debug a project

* From the command palette in VS Code, run the **CMake: Debug Target** command, press the keyboard shortcut **Ctrl+F5**, or press the **Debug** button in the status bar.
* See the [CMake:Target debugging and launching](debug-launch.md) page for more information.

## Pass command-line arguments to the debugger

See [Debug using a launch.json file](debug-launch.md#debug-using-a-launchjson-file).

## Set up include paths for C++ IntelliSense

CMake Tools currently supports Microsoft's ms-vscode.cpptools extension. If the ms-vscode.cpptools extension is installed and enabled, then configuring your project will provide this integration automatically.

ms-vscode.cpptools will show a prompt confirming that you wish to use CMake Tools to provide the configuration information for your project. Accept this prompt to activate the integration. Subsequently, CMake Tools will provide and automatically update cpptools configuration information for each source file in your project.

## Next steps

- Explore the [CMake Tools documentation](README.md)