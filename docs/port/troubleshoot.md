
[Source](https://vector-of-bool.github.io/docs/vscode-cmake-tools/troubleshooting.html "Permalink to Troubleshooting CMake Tools — CMake Tools 1.4.0 documentation")

# Troubleshoot CMake Tools

CMake Tools, like any piece of software, may misbehave. There are several things to do to check what is going wrong.

Note

Should any of the below actions be necessary for any reason **be aware that you have encountered a bug**.

If CMake Tools hasn't given you a useful help or error message, or has behaved in a counter-intuitive way without being otherwise documented, then the behavior can _and should_ be considered a bug.

Please visit [the support chat][1], and/or check for or open a relevant [GitHub issue][2].

## Reset the Extension State[¶][3]

CMake Tools persists certain workspace settings in an internal _memento_ that is opaque to the user. This includes things like the active target and variant. If this state were to somehow be corrupted or inconsistent, this state can be reset via the _CMake: Reset CMake Tools extension state_ command.

Warning

Resetting the state will automatically reload the current workspace!

## Increasing the Log Level[¶][4]

CMake Tools exposes a lot of optional logging that isn't enabled by default. The [cmake.loggingLevel][5] setting can be used to increase the amount of output written to the _CMake/Build_ output channel.

## Checking the Log File[¶][6]

Regardless of the user-visible log level, CMake Tools writes all log entries for all levels to a user-local log file. This file can be opened with the _CMake: Open the CMake Tools log file_ command.

Note

This file is user-local, _not_ workspace-local. This file includes all log entries since the extension was installed. It may be very large.

## Open a GitHub Issue[¶][7]

Issue reports are very welcome! CMake Tools is developed and maintained entirely by volunteer work, so there is no rigorous QA process. End-user issue reports are all we have to go on!

**And remember:** If your question isn't answered in this documentation, **that's a documentation bug**!

[1]: https://gitter.im/vscode-cmake-tools/support
[2]: https://github.com/vector-of-bool/vscode-cmake-tools/issues
[3]: https://vector-of-bool.github.io#reset-the-extension-state "Permalink to this headline"
[4]: https://vector-of-bool.github.io#increasing-the-log-level "Permalink to this headline"
[5]: https://vector-of-bool.github.io/settings.html#conf-cmake-logginglevel
[6]: https://vector-of-bool.github.io#checking-the-log-file "Permalink to this headline"
[7]: https://vector-of-bool.github.io#open-a-github-issue "Permalink to this headline"

  