# CMake Project Outline View

Starting in CMake Tools 1.16, we will provide users the ability to customize their tatus bar with related CMake items like presets, kits, variants, build, configure, and launch to allow for users to de-clutter as much as they like while also having access to commonly performed actions.

The default settings will be set to the following:
## Default Settings Json
```json
“cmake.status.statusBarVisibility”: “hidden”

“cmake.status.advanced": { 
  “build”: { 
    “statusBarVisibility”: “visible” 
  }, 

  “launch”: { 
    “statusBarVisibility”: “visible” 
  },
 
  “debug”: { 
    “statusBarVisibility”: “visible” 
  }
}
```
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
These settings mean that by default all settings will be hidden from the status bar, except for Build, Launch, and Debug actions. You can configure settings for each of the following CMake actions in your settings.json to either be visible or hidden in the status bar. To revert to the prior experience and have all of your presets display in the status bar, set your `Cmake > StatusBar: Visibility` setting to `Visible`


The full level of options for the cmake status can be seen below

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
        "debug": { 
            	"statusBarVisibility": "default", "hidden" 
            	"projectStatusVisibility": "default", "hidden" 
        },
        "launch": { 
            	"statusBarVisibility": "default", "hidden" 
            	"projectStatusVisibility": "default", "hidden" 
        }, 
        "launchTarget": { 
            	"statusBarVisibility": "default", "compact", "hidden" 
            	"statusBarLength": <integer> 
        } 
}
```
*`folder` means <TODO: what does folder mean>
*`configure` is associated with the CMake Configure action. It can only be found in the Project Status View and can't be seen in the status bar, hence no `statusBarVisibility` property value

