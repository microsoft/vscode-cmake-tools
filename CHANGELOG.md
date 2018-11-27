# What's New?

[See the full changelog in the end-user documentation](https://vector-of-bool.github.io/docs/vscode-cmake-tools/changelog.html).

## 1.1.3

Many thanks to [Yonggang Luo](https://github.com/lygstate) for several changes
in this version.

Removal:

- The visual CMake cache editor GUI is gone. The API with which it was drawn is
  being removed from a future version of VS Code, and the feature had many
  issues. A future CMake GUI will be introduced with more features and greater
  stability.

Features and Tweaks:

- On Linux, will detect old CMake versions and offer to do an automatic
  upgrade. Windows support is pending. If you have a macOS devices and would
  like to contribute, please open a pull request!
- Smarter parsing of GCC and Clang compile errors to fold `note:` and
  `required from:` blocks into their main diagnostic. This permits the
  folding and browsing of template and macro instantiation errors in a nicer
  fashion. MSVC error parsing pending. (**NOTE**: There is an upstream issue
  with the sort order of diagnostic information, so `required from`
  tracebacks may appear out-of-order).

Fixes:

- On Windows, "Launch target in terminal" will use `cmd.exe` unconditionally.
  This works around issues with command quoting in PowerShell
- "Debug target" will prefer `lldb-mi` to `lldb`. Fixes issues where `cpptools`
  is unable to launch the debugger.
- Document the `environmentVariables` field on kits.
- Fix legacy CMake mode not setting the CMake generator.
- Permit limited variable expansion for `cmake.cmakePath` in `settings.json`
  (refer to documentation for more details).

## 1.1.2

A bugfix release for [these issues](https://github.com/vector-of-bool/vscode-cmake-tools/milestone/13?closed=1).

## 1.1.1

A bugfix release for [these issues](https://github.com/vector-of-bool/vscode-cmake-tools/milestone/12?closed=1).

**BREAKING CHANGE**: Variant substitutions follow a new `${variant:var-key}`
syntax to match the special namespacing of substitutions.

## 1.1.0

1.1.0 includes a few new major features:

- `cpptools` integration for IntelliSense
- A Project Outline view as a custom explorer
- Building individual source files from the editor menus
- New UI for progress and cancellation

See the changelog in the official documentation for more information.
