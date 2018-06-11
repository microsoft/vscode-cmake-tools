# What's New?

[See the full changelog in the end-user documentation](https://vector-of-bool.github.io/docs/vscode-cmake-tools/changelog.html).

**1.0.0** features several fixes and tweaks over 0.11.1. Highlights include:

- Kits are now optional. Opting-out of a kit will use default CMake detection.
- LLVM for Windows is supported as a kit.
- Cache-init files are supported (The CMake `-C` argument).
- GCC cross-compilers are now detected in kit scans.

**1.0.1** finishes up some work that didn't get into 1.0.0:

- Automatically detect when a kit specifies a path to a non-existent compiler
  and ask what to do with that kit (remove or keep).
- New option `cmake.copyCompileCommands`: Set a path to which
  `compile_commands.json` will be copied after a configure run.
- Fix failing when CMake executable has a different name than `cmake`.
- Fixed edits to the kits file not applying immediately.
- Fixed issue where CTest is not on the `PATH` and it fails to detect tests.
