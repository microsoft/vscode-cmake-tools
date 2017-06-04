# CMake Tools and CMake Server

## What is `cmake-server`?

Version 3.7.0 of CMake introduced `cmake-server`, a mode in which CMake is able
to be used as a service such that it can integrate with other tools that wish to
obtain information about a CMake project. This is specifically aimed towards
development environments and code editors that wish to integrate well with
CMake-based projects.

## CMake Server in Visual Studio Code

CMake Tools now has support for CMake Server. For the time being, this doesn't
have a large effect on the user experience, but it does have a few notable
effects:

- `CMakeToolsHelpers` is no longer necessary for target debugging! Now CMake
  Tools is able to query CMake directly for information on the project.
- More reliable target discovery. Instead of trying to parse the `help` target
  listing, CMake Tools has 100% accuracy on the list of available targets.
- More accurate reconfigure checking. This means that CMake Tools will know with
  certainty when it must run a reconfigure. No more false positives when
  reconfiguring.

## How to Enable CMake Server Support

To use CMake Server in Visual Studio Code with CMake Tools, the following
requirements must be met:

1. You must be using CMake 3.7.2 or newer. Older 3.7 releases have bugs that
   severely harm the user experience. Versions prior to CMake 3.7 do not have
   CMake Server support.
2. The configuration setting `cmake.useCMakeServer` must be set to
   `true` (the default).
3. After enabling, Visual Studio Code must be restarted for the changes to take
   effect.

Once these things have been done, CMake Tools will use CMake Server to manage
your project configuration.

# Remember!

CMake Server is still very new and experimental. If you find issues when using
CMake Tools with CMake Server, please open a GitHub issue, including relevant
information such as CMake version, operating system, and Visual Studio Code
version.

If a bug is inhibitting your workflow, `cmake.useCMakeServer` can
be reset back to `false` to disable the CMake Server backend.