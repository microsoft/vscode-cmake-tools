# CMake Options Visibility Configuration

Starting in CMake Tools 1.16, we will provide users the ability to customize their status bar with related CMake items like presets, kits, variants, build, configure, and launch to allow for users to de-clutter this global status bar as much as they would like to, while also having quick access to commonly performed CMake actions. By default, only `Build`, `Debug`, and `Run` will persist in the status bar. All of the CMake actions for configuring your project will now be available in the CMake Tools side bar under **Project Status** View.

![Screenshot of the CMake Tools side bar to the left in VS Code with the Project Status View open](images/cmake-tools-sidebar.png)

Users can specify what is shown in the status bar through their `settings.json` file.

The default settings will be set to the following:

## Default Settings Json
```json
"cmake.options.statusBarVisibility": "hidden"
"cmake.options.advanced": {
    "build": {
        "statusBarVisibility": "inherit"
    },
    "launch": {
        "statusBarVisibility": "inherit"
    },
    "debug": {
        "statusBarVisibility": "inherit"
    }
}
```

These settings mean that by default all settings will be hidden from the status bar, except for Build, Launch, and Debug actions.

To revert to the prior experience and have all of your presets display in the status bar, set your `Cmake > Options: Status Bar Visibility` setting to `visible`. This setting is overwritten by `Cmake > Options: Advanced`, so if you had added to have some options hidden through this, these options will still remain hidden. 

![Screenshot of the VS Code Settings view, with the CMake > Status Bar Visibility options. You can set these to visible, hidden, compact, or icon](images/cmake-statusbar-setting.png)

## Configuring your CMake Status Bar and Project Status View

You can configure settings for each of the following CMake actions in your settings.json to either be `visible` or `hidden` in the status bar through the `statusBarVisibility` variable.  Settings that are available to be hidden from the project status view side bar can be configured to be `visible` or `hidden` through the `projectStatusVisibility` variable.
 
To make options visible in the status bar take up less space, you can configure certain options to be only the respective icon through the `icon` option in `statusBarVisibility`, inherit the more general `Cmake > Options : Status Bar Visibility` setting or the `inheritDefault` setting through the `inherit` option in `statusBarVisibility`, or specify a given character length through the `compact` option in `statusBarVisibility`. 

If a `statusBarVisibility` option is set to `inherit`, it will inherit the more general `Cmake > Options : Status Bar Visibility` setting if it is not set to `hidden`. If the more general `Cmake > Options : Status Bar Visibility` setting is set to `hidden`, then the `inherit` option will default to what is set in the `inheritDefault` setting. The default option for `inheritDefault` is `visible`. 

If a `statusBarVisibility` option is set to `compact` you can then specify an integer length for how many characters you want an option to take up through the `statusBarLength` option. It will truncate your existing status bar option to that specified character length. The default option for `statusBarLength` is 20 characters. Note, if the `statusBarVisibility` option is set specifically for `variant`, `compact` will remove the status message completely instead of truncating (there is no corresponding `statusBarLength` setting).

You can also configure options to be `visible` or `hidden` in the Project Status View in the CMake Tools sidebar. The options that allow for this customization are:
*`folder`
*`configure`
*`build`
*`ctest`
*`debug`
*`launch`
Note: if you set one of these to hidden, the parent node and it's children will entirely be hidden. For example, if you set `build` to `hidden` in `projectStatusVisibility`, the option to select your build preset will also be hidden
 
The full level of options for the CMake status can be seen below:

### CMake Status Bar and Project Status View Configuration Options in your Settings Json
```json
"cmake.options.statusBarVisibility": "visible", "icon", "compact", "hidden" 
"cmake.options.advanced": { 

        "folder": { 
            "statusBarVisibility": "visible", "icon", "compact", "hidden", "inherit", 
            "inheritDefault": "visible", "icon", "compact", "hidden", 
            "statusBarLength": 20,
            "projectStatusVisibility": "visible", "hidden" 
        }, 
        "configure": { 
            "projectStatusVisibility": "visible", "hidden" 
        }, 
        "configurePreset": { 
            "statusBarVisibility": "visible", "icon", "compact", "hidden", "inherit", 
            "inheritDefault": "visible", "icon", "compact", "hidden", 
            "statusBarLength": 20
        }, 
        "kit": { 
            "statusBarVisibility": "visible", "icon", "compact", "hidden", "inherit", 
            "inheritDefault": "visible", "icon", "compact", "hidden", 
            "statusBarLength": 20 
        }, 
        "variant": { 
            "statusBarVisibility": "visible", "icon", "compact", "hidden", "inherit", 
            "inheritDefault": "visible", "icon", "compact", "hidden", 
        }, 
        "build": { 
            "statusBarVisibility": "visible", "icon", "hidden", "inherit", 
            "inheritDefault": "visible", "icon", "hidden", 
            "projectStatusVisibility": "visible", "hidden" 
        }, 
        "buildPreset": { 
            "statusBarVisibility": "visible", "icon", "compact", "hidden", "inherit", 
            "inheritDefault": "visible", "icon", "compact", "hidden", 
            "statusBarLength": 20 
        }, 
        "buildTarget": { 
            "statusBarVisibility": "visible", "compact", "hidden", "inherit", 
            "inheritDefault": "visible", "compact", "hidden", 
            "statusBarLength": 20 
        }, 
        "ctest": { 
            "statusBarVisibility": "visible", "icon", "compact", "hidden", "inherit", 
            "inheritDefault": "visible", "icon", "compact", "hidden", 
            "statusBarLength": 20, 
            "color": true, false, 
            "projectStatusVisibility": "visible", "hidden" 
        }, 
        "testPreset": { 
            "statusBarVisibility": "visible", "icon", "compact", "hidden", "inherit", 
            "inheritDefault": "visible", "icon", "compact", "hidden", 
            "statusBarLength": 20
        },
        "launchTarget": { 
            "statusBarVisibility": "visible", "compact", "hidden", "inherit", 
            "inheritDefault": "visible", "icon", "compact", "hidden", 
            "statusBarLength": 20 
        }, 
        "debug": { 
            "statusBarVisibility": "visible", "hidden", "inherit", 
            "inheritDefault": "visible", "icon", "compact", "hidden", 
            "projectStatusVisibility": "visible", "hidden" 
        },
        "launch": {
            "statusBarVisibility": "visible", "hidden", "inherit", 
            "inheritDefault": "visible", "icon", "compact", "hidden", 
            "projectStatusVisibility": "visible", "hidden" 
        },
        "workflow": {
            "statusBarVisibility": "visible", "hidden", "inherit", 
            "inheritDefault": "visible", "icon", "compact", "hidden", 
            "projectStatusVisibility": "visible", "hidden" 
        },
        "workflowPreset": {
            "statusBarVisibility": "visible", "hidden", "inherit", 
            "inheritDefault": "visible", "icon", "compact", "hidden", 
            "projectStatusVisibility": "visible", "hidden" 
        },
        "packagePreset": {
            "statusBarVisibility": "visible", "hidden", "inherit", 
            "inheritDefault": "visible", "icon", "compact", "hidden", 
            "projectStatusVisibility": "visible", "hidden" 
        }
}
```

* `folder` is the active folder in your workspace. This is where the project is scoped to.
* `configure` is associated with the CMake Configure action. It can only be found in the Project Status View and can't be seen in the status bar, hence no `statusBarVisibility` property value.
* `configurePreset` is associated with the CMake Configure Preset. When selected, the user can modify their active CMake Configure Preset from the list detected in their CMakePresets.json and CMakeUserPresets.json (if found in project).
* `kit` is associated with the active kit selected (when CMake Presets aren't present). When selected, the user can modify their active kit. To learn more about kits, please see [our kit documentation](kits.md).
* `variant` is associated with the active variant (when CMake Presets aren't present). When selected, the user can modify their active variant. Variant status does not show on the Project Status View, but will show in the status bar when set to `visible`. To learn more about variants, please see [our variant documentation](variants.md).
* `build` is associated with the CMake Build action. It invokes a CMake build on your build target using your build preset or variant.
* `buildPreset` is associated with your active CMake Build Preset. When selected, the user can modify their active CMake Build Preset from the list detected in their CMakePresets.json and CMakeUserPresets.json (if found in project).
* `buildTarget` is associated with your active CMake Build Target. When selected, the user can specify their active Build Target. This will be the target invoked when the user presses the `Build` icon in the status bar (if not hidden) or runs `CMake: Build Target` from the Command Palette.
* `ctest` is associated with running CTest. When selected, it will invoke CTest on the test preset specified. If there is no test preset specified, it will run all your tests by default.
* `testPreset` is associated with selecting your active CMake Test Preset. When selected, the user can modify their active CMake Test Preset from the list detected in their CMakePresets.json and CMakeUserPresets.json (if found in project).
* `launchTarget` is associated with selecting your active launch target. When selected, you can specify the active launch target.
* `debug` is associated with the CMake Debug action. It invokes a debugger on the active launch target.
* `launch` is associated with launching the target. It will run the specified target application in the terminal.
* `workflow` is associated with CMake Run Workflow action. It will run the specified CMake workflow based on the workflow preset.
* `workflowPreset` is associated with your active CMake Workflow Preset. When selected, the user can modify their active CMake Workflow Preset from the list detected in their CMakePresets.json and CMakeUserPresets.json (if found in project).
* `packagePreset` is associated with your active CMake Package Preset.  When selected, the user can modify their active CMake Workflow Preset from the list detected in their CMakePresets.json and CMakeUserPresets.json (if found in project).
  
To reset your CMake options back to the default, hover over your `Cmake > Options: Status Bar Visibility` and `Cmake > Options: Advanced` settings and select the gear icons that appear for more options. From there, select `Reset Setting` on both options.
![Screenshot of the VS Code Setting option to Reset Setting to the left of Cmake > Options: Status Bar Visibility](images/cmake-setting-2.png)
![Screenshot of the VS Code Setting option to Reset Setting to the left of Cmake > Options: Advanced visibility](images/cmake-setting-1.png)
