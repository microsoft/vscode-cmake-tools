
[Source](https://vector-of-bool.github.io/docs/vscode-cmake-tools/getting_started.html "Permalink to Getting Started — CMake Tools 1.4.0 documentation")

# Getting Started — CMake Tools 1.4.0 documentation

Assuming you already have a CMake project to configure, skip to the [Configuring Your Project][1] section.

## Configuring Your Project

Configuring a project is simple, but has two steps before configuration can take place.

### Pre-Configure Steps

#### Selecting a Kit

Before we can configure, you must select a _Kit_. [(Read more about kits)][2].

What are kits?
: 

Kits represent a _toolchain_: A set of compilers, linkers, or other tools that will be used to build a project. If you have no Kit selected, CMake Tools will start by asking you to select a Kit.

When first opening a project, a status bar item will read **No Kit Selected**:

![_images/no_kits.png][3]

To select a kit, click this statusbar button, or run the _Select a Kit_ command from the command palette. A quick pick list will appear:

![_images/kit_selector.png][4]

Upon choosing a kit, the statusbar button will display the name of the active kit:

![_images/kit_selected.png][5]

The chosen kit will be remembered between sessions. Should the availability of the kit change, the statusbar item may revert and you will be required to select a kit again.

Note

If you try to configure your project without an active Kit selected, you will be prompted to choose one before configuring can proceed.

CMake Tools will use the compilers/toolchain from the kit when building your project.

Find out more on the [CMake Kits][2] page.

#### Selecting a Variant

Similar to selecting a kit, we must select a _Variant_. [(Read more about variants)][6].

Before selecting a variant, the variant slot on the statusbar will read _Unknown_:

![_images/no_variant.png][7]

To select a variant, click this statusbar button, or run the _Set build type_ command from the command palette. A quick pick list will appear:

![_images/variant_selector.png][8]

The active build variant will be displayed on the same statusbar button, along with the project name and extension status.

Note

Just like with kits, CMake Tools will ask you which variant to build if you haven't already made a selection.

Variants can be customized to a wide variety of purposes. Find out more on the [CMake Variants][6] page.

### Running Configuration

Configuration can be run by clicking the project button in the statusbar and changing the build type, by running the _CMake: Configure_ command from the command palette, or by running a build when configuration has not yet taken place.

When configuration runs, the _CMake/Build_ output panel will reveal and show the live output from CMake as configuration runs:

![_images/configure_output.png][9]

At this point, CMake Tools has loaded information about your project and you are free to roam about the cabin.

## Building Your Project

More important than just configuring, you probably want to _build_ your project as well.

Building is simple: Run the _CMake: Build_ command from the command palette:

![_images/build_command.png][10]

Note

The default keybinding for this command is `F7`.

You can also press the _Build_ button in the statusbar:

![_images/build_button.png][11]

While the the build is running, the _Build_ button will be replaced with a build progress bar:

![_images/build_progress.png][12]

The build can be stopped by clicking the _Stop_ button.

## Accessing Build Results

By default, CMake Tools writes build output to the `build/` subdirectory of your source tree, so build results are visible from the file explorer within Visual Studio Code. This can be changed by changing the [cmake.buildDirectory][13] setting.

[1]: https://vector-of-bool.github.io#gs-configuring
[2]: https://vector-of-bool.github.io/kits.html#kits
[3]: https://vector-of-bool.github.io/_images/no_kits.png
[4]: https://vector-of-bool.github.io/_images/kit_selector.png
[5]: https://vector-of-bool.github.io/_images/kit_selected.png
[6]: https://vector-of-bool.github.io/variants.html#variants
[7]: https://vector-of-bool.github.io/_images/no_variant.png
[8]: https://vector-of-bool.github.io/_images/variant_selector.png
[9]: https://vector-of-bool.github.io/_images/configure_output.png
[10]: https://vector-of-bool.github.io/_images/build_command.png
[11]: https://vector-of-bool.github.io/_images/build_button.png
[12]: https://vector-of-bool.github.io/_images/build_progress.png
[13]: https://vector-of-bool.github.io/settings.html#conf-cmake-builddirectory

  