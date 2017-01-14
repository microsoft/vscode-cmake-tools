# CMake Tools and CMake Server

## What is `cmake-server`?

Version 3.7.0 of CMake introduced `cmake-server`, a mode in which CMake is able
to be used as a service such that it can integrate with other tools that wish to
obtain information about a CMake project. This is specifically aimed towards
development environments and code editors that wish to integrate well with
CMake-based projects.

## CMake Server in Visual Studio Code

CMake Tools now has experimental support for CMake Server. For the time being,
this doesn't have a large effect on the user experience, but it does have a few
notable effects on the user experience:

- `CMakeToolsHelpers` is no longer necessary for target debugging! Now CMake
  Tools is able to query CMake directly for information on the project.
- More reliable target discovery. Instead of trying to parse the `help` target
  listing, CMake Tools has 100% accuracy on the list of available targets.
- More accurate reconfigure checking. This means that CMake Tools will know with
  certainty when it must run a reconfigure. No more false positives when
  reconfiguring.

CMake Server is still very new and experimental. If you find issues when using
CMake Tools with CMake Server, please feel free to open a GitHub issue.