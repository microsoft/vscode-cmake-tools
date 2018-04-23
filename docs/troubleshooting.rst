.. _troubleshooting:

Troubleshooting CMake Tools
###########################

CMake Tools, like any piece of software, may misbehave. There are several things
to do to check what is going wrong.

.. note::
    Should any of the below actions be necessary for any reason **be aware that
    you have encountered a bug**.

    If CMake Tools hasn't given you a useful help or error message, or has
    behaved in a counter-intuitive way without being otherwise documented, then
    the behavior can *and should* be considered a bug.

    Please visit
    `the support chat <https://gitter.im/vscode-cmake-tools/support>`_, and/or
    check for or open a relevant
    `GitHub issue <https://github.com/vector-of-bool/vscode-cmake-tools/issues>`_.


Reset the Extension State
*************************

CMake Tools persists certain workspace settings in an internal *memento* that is
opaque to the user. This includes things like the active target and variant.
If this state were to somehow be corrupted or inconsistent, this state can be
reset via the *CMake: Reset CMake Tools extension state* command.

.. warning::
    Resetting the state will automatically reload the current workspace!

Increasing the Log Level
************************

CMake Tools exposes a lot of optional logging that isn't enabled by default.
The :ref:`conf-cmake.loggingLevel` setting can be used to increase the amount of
output written to the *CMake/Build* output channel.

Checking the Log File
*********************

Regardless of the user-visible log level, CMake Tools writes all log entries for
all levels to a user-local log file. This file can be opened with the
*CMake: Open the CMake Tools log file* command.

.. note::
    This file is user-local, *not* workspace-local. This file includes all log
    entries since the extension was installed. It may be very large.

Check for a GitHub Issue
************************

It is possible that other users have encountered the same problem before.
`Check the GitHub issues list for others encountering the same problem that
you have <https://github.com/vector-of-bool/vscode-cmake-tools/issues>`_.

Ask Around the Support Chat
***************************

CMake Tools has `a Gitter chat room for end-user support <https://gitter.im/vscode-cmake-tools/support>`_.

.. note::
    People in this chat are volunteers and may not be available at all times of
    the day. Please be patient.

Open a GitHub Issue
*******************

Issue reports are very welcome! CMake Tools is developed and maintained entirely
by volunteer work, so there is no rigorous QA process. End-user issue reports
are all we have to go on!

**And remember:** If your question isn't answered in this documentation,
**that's a documentation bug**!
