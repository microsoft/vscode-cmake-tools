# CMake Tools

[![Gitter chat](https://badges.gitter.im/vscode-cmake-tools/Lobby.png)](https://gitter.im/vscode-cmake-tools/Lobby)

[CMake Tools](https://marketplace.visualstudio.com/items?itemName=vector-of-bool.cmake-tools) provides the native developer a full-featured, convenient, and
powerful configure+build workflow for CMake-based projects within the
Visual Studio Code editor.

[Read the online documentation](https://vector-of-bool.github.io/docs/vscode-cmake-tools/index.html).

# What's New?

[Also check the changelog in the end-user documentation](https://vector-of-bool.github.io/docs/vscode-cmake-tools/changelog.html).

**0.11.1** includes several [fixes and tweaks](https://github.com/vector-of-bool/vscode-cmake-tools/milestone/7?closed=1).

The **0.11.0** release marks a monumental change for this project. Besides
overhauling the development and testing process, three particular things are
most notable to users:

- [Thorough end-user documentation](https://vector-of-bool.github.io/docs/vscode-cmake-tools/)
  is now available.
- CMake Tools includes automated opt-in error-report sending. The first time
  you load CMake Tools it will ask your permission to send error and exception
  data to Rollbar for cataloging and triage.
- CMake Tools now has the concept of *Kits* to represent how to build your
  project. [Read more in the new documentation](https://vector-of-bool.github.io/docs/vscode-cmake-tools/kits.html).

The 0.11.0 release has been months in the making, and there are several people
that I need to thank:

- *Thank you* to those that went out of your way to download and test the beta
  release packages.
- *Thank you* to those that opened up and commented/reacted on GitHub issues for
  the beta releases.
- A special thanks to my three new collaborators, who helped me finally get this
  release done:
  - [KoeMai](https://github.com/KoeMai)
  - [Randshot](https://github.com/Randshot)
  - [Yuri Timenkov](https://github.com/Randshot)

## Issues? Questions? Feature requests?

**PLEASE**, if you experience any problems, have any questions, or have an idea
for a new feature, create an issue on [the GitHub page](https://github.com/vector-of-bool/vscode-cmake-tools)!

This extension itself *does not* provide language support for the CMake
scripting language. For that I recommend [this extension](https://marketplace.visualstudio.com/items?itemName=twxs.cmake).
