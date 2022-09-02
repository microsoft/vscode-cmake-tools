# Configure with CMake Tools tasks
You can create a configure task from the VS Code command pallette by running the **Tasks: Configure task** command.

![Configure a task](images/configure_task.png)

By selecting "CMake: configure" template, if you are not using presets, this task will be generated in `tasks.json` file: 


```json
    {
        "type": "cmake",
        "label": "CMake: configure",
        "command": "configure",
        "targets": [
            "all"
        ],
        "problemMatcher": [],
        "detail": "CMake template configure task"
    }
```

**Note**: When running this task, the configure settings (including configure options and configure environment) defined in `settings.json` will be used.

However, if you are using presets, this task will be generated in `tasks.json` file:

```json
    {
        "type": "cmake",
        "label": "CMake: configure",
        "command": "configure",
        "preset": "${command:cmake.activeConfigurePresetName}",
        "detail": "CMake template configure task"
    }
```
You can modify "preset" option with your chosen configure preset name.

**Note**: When running this task, the configure settings defined in `CMakeUserPresets.json`/`CMakePresets.json` will be used.

**Note**: If you are using a preset other than the active configure preset, you can change this settings in *settings.json* to avoid re-configure based on the active preset when editing.

```json
    "cmake.configureOnEdit": false
```

# Build with CMake Tools tasks
Similarly, You can create a build task from the VS Code command pallette by running the **Tasks: Configure task** command.

By selecting "CMake: build" template, if you are not using presets, this task will be generated in `tasks.json` file: 

```json
    {
        "type": "cmake",
        "label": "CMake: build",
        "command": "build",
        "targets": [
            "all"
        ],
        "group": "build",
        "problemMatcher": [],
        "detail": "CMake template build task"
    }
```
**Note**: When running this task, the build settings (including buildArgs and build environment) defined in `settings.json` will be used.

However, if you are using presets, this task will be generated in `tasks.json` file:

```json
    {
        "type": "cmake",
        "label": "CMake: build",
        "command": "build",
        "preset": "${command:cmake.activeBuildPresetName}",
        "detail": "CMake template build task"
    }
```

**Note**: When running this task, the configure settings defined in `CMakeUserPresets.json`/`CMakePresets.json` will be used.

You can chain a configure task to your build task by adding this to your task's definition:

```json
        "dependsOn": [
            "CMake: configure"
        ]
```

# Test with CMake Tools tasks
Similarly, You can create a test task from the VS Code command pallette by running the **Tasks: Configure task** command.

By selecting "CMake: test" template, if you are not using presets, this task will be generated in `tasks.json` file: 

```json
    {
        "type": "cmake",
        "label": "CMake: test",
        "command": "test",
        "detail": "CMake template test task"
    }
```
**Note**: When running this task, the test settings defined in `settings.json` will be used.

However, if you are using presets, this task will be generated in `tasks.json` file:

```json
    {
        "type": "cmake",
        "label": "CMake: test",
        "command": "test",
        "preset": "${command:cmake.activeTestPresetName}",
        "detail": "CMake template test task"
    }
```

**Note**: When running this task, the test settings defined in `CMakeUserPresets.json`/`CMakePresets.json` will be used.

# Install/Clean/Clean-rebuild with CMake Tools tasks
Similarly, you can create a Install/Clean/Clean-rebuild task from the VS Code command pallette by running the **Tasks: Configure task** command.

By selecting "CMake: install", "CMake: clean" or "CMake: clean rebuild" template, these tasks will be generated in `tasks.json` file:

```json
    {
        "type": "cmake",
        "label": "CMake: install",
        "command": "install",
        "detail": "CMake template install task"
    },
    {
        "type": "cmake",
        "label": "CMake: clean",
        "command": "clean",
        "detail": "CMake template clean task"
    },
    {
        "type": "cmake",
        "label": "CMake: clean rebuild",
        "command": "cleanRebuild",
        "detail": "CMake template clean rebuild task"
    }
```
However, if you are using presets, these tasks will be generated in `tasks.json` file.

**Note**: Install, Clean, and Clean-rebuild tasks will run based on the build preset settings.

```json
    {
        "type": "cmake",
        "label": "CMake: install",
        "command": "install",
        "preset": "${command:cmake.activeBuildPresetName}",
        "detail": "CMake template install task"
    },
    {
        "type": "cmake",
        "label": "CMake: clean",
        "command": "clean",
        "preset": "${command:cmake.activeBuildPresetName}",
        "detail": "CMake template clean task"
    },
    {
        "type": "cmake",
        "label": "CMake: clean rebuild",
        "command": "cleanRebuild",
        "preset": "${command:cmake.activeBuildPresetName}",
        "detail": "CMake template clean rebuild task"
    }
```
