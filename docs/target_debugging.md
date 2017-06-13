# Target Debugging

Most C and C++ development environments offer some integration with project
configuration that requires awareness of the build system, including the
presence of targets and build artifacts. The experimental Target Debugging
feature offers some such integration with Visual Studio Code for CMake projects
that produce executable targets (including executables used just for testing).

The Target Debugging is meant to make it far simpler for CMake-based projects to
manage their debugging setup within VS Code. There is no need to write a
``launch.json`` file for Target Debugging, and no need to manually specify
the path/architecture/debugger for an executable. All this is determined
automatically by CMake Tools when a target-based debug is invoked.

## Selecting a Debug Target
Once project is configured and generated CMake Tools uses metadata from CMake
to automatically discover your executables and the paths that they are written to.
As executable targets are added to the project,
CMake Tools will discover them each time you re-configure the project. CMake
Tools will also rebuild the target associated with the executables when
that target is about to be debugged, so there is no need to worry about ensuring
the target is built before debugging.

There are multiple ways to select debug target.

### Using status bar

Once a CMake project is opened, the following new entries should appear on the status bar:

![Target Debugging](../images/target_debugging_marked.png)

The left-hand button will launch the selected executable target in the debugger.
Initially, the text entry may read ``[No target selected for debugging]``. In
this case, the project may need to be configured again to generate the metadata.
Clicking this entry will launch a dialog to select a target.

### Using command palette

Another option is to bring Command Palette (``Ctrl+Shift+P``) and
select ``Select a Target to Debug``:
![Select a Target to Debug](../images/target_debugging_palette.png)

Once target is selected you may also use commands to start it with
or without debugging:

 * ``Execute the current target without a debugger``
 * ``Debug Target``

## Advanced usage

### Configuring the debugger

CMake Tools generates a debugging configuration object on-the-fly, when
debugging is requested. To set some additional parameters to this debug
configuration, use the ``cmake.debugConfig``. Under the hood, CMake Tools
delegates to Microsoft's C and C++ extension to do debugging, so all options
listed [here](https://github.com/Microsoft/vscode-cpptools/blob/master/launch.md)
are available. CMake Tools will fill all required options for you, so you don't
need to specify any of the required options outlined in the help document.

### Running program from ``launch.json``
In some cases debugging support provided by CMake Tools may be limited or incorrect.
Then it is possible to use CMake Tools from ``launch.json`` for information about
executables and their paths.

Basic ``launch.json`` configuration may look like this:
~~~json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Launch CMake-built program",
            "type": "cppdbg",
            "request": "launch",
            "program": "${command:cmake.launchTargetProgramPath}",
            "stopAtEntry": true,
            "cwd": "${workspaceRoot}"
        }
    ]
}
~~~
It will start currently selected Debug Target, as if using similar command from CMake Tools.

 * Use ``"type": "cppvsdbg"`` if you use Visual Studio compiler.
 * Use ``"program": "${command:cmake.selectLaunchTarget}"`` to pick target every time in popup.

Please refer to VS Code documentation for more information about debugging.

**NOTE:** Due to current limitations of VS Code it is not possible to specify ``preLaunchTask``
which invokes build via CMake Tools commands, so don't forget to build project manually.

# Enabling Target Debugging for CMake versions < 3.7.2
Modern CMake versions provide support for querying information about project
begin configured without any modifications to the project itself.

To achieve this for older versions CMake Tools will emit a CMake
module which can be easily included in any CMake project by adding the following
line at the top of the ``CMakeLists.txt`` file, before calling any
``add_library`` or ``add_executable``:

~~~cmake
include(CMakeToolsHelpers OPTIONAL)
~~~

The keyword ``OPTIONAL`` here means that CMake won't complain if it fails to
find the module. This is very useful, as the script itself isn't important to
the build system. As such, this line can be committed to the project and no
users will ever have to care about its presence.

## Troubleshooting

### Q: CMake isn't finding the `CMakeToolsHelpers` script! Why is this?

**A:** There are a few primary reasons why CMake might not find it. CMake Tools
sets `CMAKE_MODULE_PATH` such that CMake will be able to find the generated
helper module. This means that A) CMake will only find this module if it was
invoked using CMake Tools within Visual Studio Code and B) destructive
modifications of `CMAKE_MODULE_PATH` before the `include` line can cause CMake
to not find the module. In the **B** case, instead of using writing:

~~~cmake
set(CMAKE_MODULE_PATH foo)
~~~

instead write:

~~~cmake
list(APPEND CMAKE_MODULE_PATH foo)
~~~

This will append a directory to the module path instead of wiping it out
completely.

### Q: When I `include(CMakeToolsHelpers)`, `add_executable` makes CMake crash!

**A:** If you run into this issue, you probably know exactly why this happens.
This is a known issue with the way CMake provides command hook functionality.
Unfortunately, there's no good way to work around it until CMake server mode
with the CMake 3.7 update. Once CMake Tools is upgraded to support CMake server
mode, including this script manually won't be necessary. Until then, you can try
moving the `include` command below the `add_executable` and `add_library`
override that you've defined in your project.