# CMake Tools for Visual Studio Code documentation

CMake Tools is an extension designed to make it easy to work with CMake-based projects.

 If you are new, try the [CMake Tools quick start](https://code.visualstudio.com/docs/cpp/CMake-linux) and see the [frequently asked questions](faq.md).

[How to](how-to.md)

* [Create a new project](how-to.md#create-a-new-project)
* [Configure a project](how-to.md#configure-a-project)
* [Build a project](how-to.md#build-a-project)
* [Debug a project](how-to.md#debug-a-project)
* [Pass command-line arguments to the debugger](debug-launch.md#debug-using-a-launchjson-file)
* [Set up include paths for C++ IntelliSense](how-to.md#set-up-include-paths-for-c-intellisense)

[Use CMakePresets](cmake-presets.md)

* [Configure and build with CMake Presets](cmake-presets.md#configure-and-build-with-cmake-presets)
* [Supported CMake and CMakePresets.json versions](cmake-presets.md#supported-cmake-and-cmakepresetsjson-versions)
* [Enable CMakePresets.json in the CMake Tools extension](cmake-presets.md#enable-cmakepresetsjson-in-the-cmake-tools-extension)
* [Configure and build](cmake-presets.md#configure-and-build)
* [CMake: Configure](cmake-presets.md#cmake-configure)
* [CMake: Select Build Preset](cmake-presets.md#cmake-select-build-preset)
* [CMake: Build](cmake-presets.md#cmake-build)
* [Test](cmake-presets.md#test)
* [CMake: Select Test Preset](cmake-presets.md#cmake-select-test-preset)
* [CMake: Run Tests](cmake-presets.md#cmake-run-tests)
* [Add new presets](cmake-presets.md#add-new-presets)
* [Add new Configure Presets](cmake-presets.md#add-new-configure-presets)
* [Add new Build Presets](cmake-presets.md#add-new-build-presets)
* [Edit presets](cmake-presets.md#edit-presets)
* [Select your generator](cmake-presets.md#select-your-generator)
* [Set and reference environment variables](cmake-presets.md#set-and-reference-environment-variables)
* [Vcpkg integration](cmake-presets.md#vcpkg-integration)
* [Command substitution in launch.json and settings.json](cmake-presets.md#command-substitution-in-launchjson-and-settingsjson)
* [Ignored settings](cmake-presets.md#ignored-settings)
* [Unsupported commands](cmake-presets.md#unsupported-commands)
* [Troubleshooting](cmake-presets.md#troubleshooting)
* [Run CMake from the command line or a Continuous Integration (CI) pipeline](cmake-presets.md#run-cmake-from-the-command-line-or-a-continuous-integration-ci-pipeline)
* [Sourcing the environment when building with command line generators on Windows](cmake-presets.md#sourcing-the-environment-when-building-with-command-line-generators-on-windows)
* [Example CMakePresets.json file](cmake-presets.md#example-cmakepresetsjson-file)

[Configure](configure.md)

* [CMake configuration process overview](configure.md#cmake-configuration-process-overview)
* [The CMake tools configure step](configure.md#the-cmake-tools-configure-step)
* [The configure step outside of CMake Tools](configure.md#the-configure-step-outside-of-cmake-tools)
* [Clean configure](configure.md#clean-configure)

[Build](build.md)

* [Build the default target](build.md#build-the-default-target)
* [Build a single target](build.md#build-a-single-target)
* [How CMake tools builds your project](build.md#how-cmake-tools-builds)
* [Clean build](build.md#clean-build)

[Debug and launch](debug-launch.md)

* [Select a launch target](debug-launch.md#select-a-launch-target)
* [Quick debugging](debug-launch.md#quick-debugging)
* [Debug using a launch.json file](debug-launch.md#debug-using-a-launchjson-file)
* [Run without debugging](debug-launch.md#run-without-debugging)
* [Debugging CMake](debug.md)

[Configure CMake Tools settings](cmake-settings.md)

* [CMake Tools settings](cmake-settings.md#cmake-settings)
* [Variable substitution](cmake-settings.md#variable-substitution)

[Kits](kits.md)

* [How kits are found and defined](kits.md#how-kits-are-found-and-defined)
* [Kit options](kits.md#kit-options)

[Variants](variants.md)

* [Variant YAML example](variants.md#example-yaml-variants-file)
* [Variant schema](variants.md#variant-schema)
* [Variant settings](variants.md#variant-settings)
* [Variant options](variants.md#variant-options)
* [How variants are applied](variants.md#how-variants-are-applied)
* [Large variant file example](variants.md#large-variant-file-example)

[Troubleshoot CMake Tools](troubleshoot.md#troubleshoot-cmake-tools)

* [Common issues and resolutions](troubleshoot.md#common-issues-and-resolutions)
* [CMake Tools is unable to provide IntelliSense configuration](troubleshoot.md#error-cmake-tools-is-unable-to-provide-intellisense-configuration)
* [Green squiggles beneath #include directives](troubleshoot.md#green-squiggles-beneath-include-directives)
* [Debugging ignores launch.json](troubleshoot.md#debugging-ignores-launchjson)
* [Reset CMake Tools extension state](troubleshoot.md#reset-cmake-tools-extension-state)
* [Increase the logging level](troubleshoot.md#increase-the-logging-level)
* [Check the log file](troubleshoot.md#check-the-log-file)
* [Get help](troubleshoot.md#get-help)

[Frequently asked questions](faq.md)

* [How can I get help?](faq.md#how-can-i-get-help)
* [What about CMake language support?](faq.md#what-about-cmake-language-support)
* [How do I learn about CMake?](faq.md#how-do-i-learn-about-cmake)
* [How does CMake Tools work with C and C++ IntelliSense?](faq.md#how-does-cmake-tools-work-with-c-and-c-intellisense)
* [How do I perform common tasks](faq.md#how-do-i-perform-common-tasks)

[How to contribute](../CONTRIBUTING.md)

* [Developer Reference](../CONTRIBUTING.md#developer-reference)
* [Build the CMake Tools extension](../CONTRIBUTING.md#build-the-cmake-tools-extension)
* [Coding guidelines](../CONTRIBUTING.md#coding-guidelines)
