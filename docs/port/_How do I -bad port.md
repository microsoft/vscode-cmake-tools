
[Source](https://vector-of-bool.github.io/docs/vscode-cmake-tools/how_do_i.html "Permalink to How Do I… — CMake Tools 1.4.0 documentation")

# How Do I… — CMake Tools 1.4.0 documentation

This page talks about and links to documentation concerning common tasks and processes.

## Set Up Include Paths for C++ IntelliSense?

CMake Tools currently supports Microsoft's cpptools extension. If the cpptools extension is installed and enabled, then configuring your project will attempt this integration automatically.

The first time this integration is attempted, cpptools will show a prompt confirming that you wish to use CMake Tools to provide the configuration information for your project. Accepting this prompt is all you need to do to activate the integration. From then on, CMake Tools will provide and automatically update cpptools' configuration information for each source file in your project.

Happy IntelliSense-ing!

  