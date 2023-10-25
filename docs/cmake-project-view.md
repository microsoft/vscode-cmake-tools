# CMake Project Outline View

Starting in CMake Tools 1.16, we will provide users the ability to customize their CMake Project Outline View and status bar with related CMake items like presets, kits, variants, build, configure, and launch.

The default settings will be set to
## Default Settings Json
```json
“cmake.status.statusBarVisibility”: “hidden”

“cmake.status.advanced: { 
“build”: { 
  “statusBarVisibility”: “default” 
}, 

“launch”: { 
  “statusBarVisibility”: “default” 
},
 
“debug”: { 
  “statusBarVisibility”: “default” 
}
}
```
