# CMake Project Outline View

Starting in CMake Tools 1.16, we will provide users the ability to customize their status bar with related CMake items like presets, kits, variants, build, configure, and launch to allow for users to de-clutter this global status bar as much as they would like to, while also having quick access to commonly performed CMake actions.

Users can specify what is shown in the status bar through their `settings.json` file.

The default settings will be set to the following:
## Default Settings Json
```json
"cmake.status.statusBarVisibility": "hidden"

"cmake.status.advanced": {
    "build": {
        "statusBarVisibility": "visible"
    },

    "launch": {
        "statusBarVisibility": "visible"
    },

    "debug": {
        "statusBarVisibility" :"visible"
    }
}
```

These settings mean that by default all settings will be hidden from the status bar, except for Build, Launch, and Debug actions.

To revert to the prior experience and have all of your presets display in the status bar, set your `Cmake > StatusBar: Visibility` setting to `Visible`
![Screenshot of the Visaul Studio Code Settings view, with the CMake Statusbar: Visibility options. You can set these to visible, hidden, compact, or icon](images/cmake-statusbar-setting.png)

## Configuring your CMake Status Bar

 You can configure settings for each of the following CMake actions in your settings.json to either be `visible` or `hidden` in the status bar. The full level of options for the cmake status can be seen below:

```json
"cmake.status.statusBarVisibility": "default", "icon", "compact", "hidden" 
"cmake.status.advanced": { 

        "folder": { 
        	"statusBarVisibility": "default", "icon", "compact", "hidden" 
            	"statusBarLength": <integer> 
            	"projectStatusVisibility": "default", "hidden" 
        }, 
        "configure": { 
            	"projectStatusVisibility": "default", "hidden" 
        }, 
        "configurePreset": { 
            	"statusBarVisibility": "default", "icon", "compact", "hidden" 
            	"statusBarLength": <integer> 
        }, 
        "kit": { 
            	"statusBarVisibility": "default", "icon", "compact", "hidden" 
            	"statusBarLength": <integer> 
        }, 
        "variantStatus": { 
            	"statusBarVisibility": "default", "icon", "compact", "hidden" 
        }, 
        "build": { 
            	"statusBarVisibility": "default", "icon", "hidden" 
            	"projectStatusVisibility": "default", "hidden" 
        }, 
        "buildPreset": { 
            	"statusBarVisibility": "default", "icon", "compact", "hidden" 
            	"statusBarLength": <integer> 
        }, 
        "buildTarget": { 
            	"statusBarVisibility": "default", "compact", "hidden" 
            	"statusBarLength": <integer> 
        }, 
        "ctest": { 
            	"statusBarVisibility": "default", "icon", "compact", "hidden" 
            	"statusBarLength": <integer> 
            	"color": true, false 
            	"projectStatusVisibility": "default", "hidden" 
        }, 
        "testPreset": { 
            	"statusBarVisibility": "default", "icon", "compact", "hidden" 
            	"statusBarLength": <integer>, 
        },
        "launchTarget": { 
            	"statusBarVisibility": "default", "compact", "hidden" 
            	"statusBarLength": <integer> 
        }, 
        "debug": { 
            	"statusBarVisibility": "default", "hidden" 
            	"projectStatusVisibility": "default", "hidden" 
        },
        "launch": { 
            	"statusBarVisibility": "default", "hidden" 
            	"projectStatusVisibility": "default", "hidden" 
        }
}
```

* `folder` means <TODO: what does folder mean>
* `configure` is associated with the CMake Configure action. It can only be found in the Project Status View and can't be seen in the status bar, hence no `statusBarVisibility` property value
* `configurePreset` is associated with the CMake Configure Preset. When selected, the user can modify their active CMake Configure Preset from the list detected in their CMakePresets.json and CMakeUserPresets.json (if found in project)
* `kit` is associated with the active kit selected (when CMake Presets aren't present). When selected, the user can modify their active kit. To learn more about kits, please see [our kit documentation](https://github.com/microsoft/vscode-cmake-tools/blob/sinemakinci/CMakeProjectViewDocs/docs/kits.md)
* `variantStatus` is associated with the active variant status (when CMake Presets aren't present). When selected, the user can modify their active variant. To learn more about variants, please see [our variant documentation](https://github.com/microsoft/vscode-cmake-tools/blob/sinemakinci/CMakeProjectViewDocs/docs/variants.md)
* `build` is associated with the CMake Build action. It invokes a CMake build on your build target using your build preset or variant.
* `buildPreset` is associated with your active CMake Build Preset. When selected, the user can modify their active CMake Build Preset from the list detected in their CMakePresets.json and CMakeUserPresets.json (if found in project)
* `buildTarget` is associated with your active CMake Build Target. When selected, the user can specify their active Build Target. This will be the target invoked when the user presses the `Build` icon in the status bar (if not hidden) or runs `CMake: Build Target` from the Command Palette
* `ctest` is associated with running CTest. When selected, it will invoke CTest on the test preset specified. If there is no test preset specified, it will run all your tests by default.
* `testPreset` is associated with selecting your active CMake Test Preset. When selected, the user can modify their active CMake Test Preset from the list detected in their CMakePresets.json and CMakeUserPresets.json (if found in project)
* `launchTarget` is associated with selecting your active launch target. When selected, you can specify the active launch target.
* `debug` is associated with the CMake Debug action. It invokes a debugger on the active launch target.
* `launch` is associated with launching the target. It will run the specified target application in the terminal.
