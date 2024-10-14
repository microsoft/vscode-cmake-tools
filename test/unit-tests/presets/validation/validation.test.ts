import { ExpansionErrorHandler } from "@cmt/expand";
import { PresetsFile } from "@cmt/presets/preset";
import { PresetsParser } from "@cmt/presets/presetsParser";
import { expect } from "@test/util";
import * as fs from "fs";
import * as preset from "@cmt/presets/preset";
import * as path from "path";

suite('Preset validation tests', () => {
    let workspaceFolder: string;
    let sourceDirectory: string;
    let folderPath: string;
    let presetsFileVersionErrors: string[] = [];
    let presetsFileErrors: string[] = [];
    let presetsParser: PresetsParser;

    suiteSetup(async function(this: Mocha.Context) {
        this.timeout(100000);

        workspaceFolder = __dirname;
        sourceDirectory = workspaceFolder;
        folderPath = sourceDirectory;

        presetsParser = new PresetsParser(
            folderPath,
            sourceDirectory,
            workspaceFolder,
            async (_path: string, _errors: ExpansionErrorHandler) => {
                _errors.errorList.forEach((error) => {
                    presetsFileErrors.push(error[0]);
                });
            },
            async (_file: string) => {
                presetsFileVersionErrors.push(`Version error in ${_file}`);
            },
            (_filePath: string) => {
                console.log("Modifying the collection for the Problems pane, not needed in this unit test");
            },
            (_file: PresetsFile | undefined) => {
                console.log("Presets file handler");
            },
            (_file: PresetsFile | undefined) => {
                console.log("User Presets file handler");
            }
        );
    });

    setup(async function(this: Mocha.Context) {
        this.timeout(100000);

        presetsFileVersionErrors = [];
        presetsFileErrors = [];
    });

    test('Validate that we fail on CMakePresets version 1', async () => {
        fs.writeFileSync(presetsParser.presetsPath,
            JSON.stringify({
                "version": 1,
                "configurePresets": [
                    {
                        "name": "configure",
                        "hidden": false,
                        "generator": "Ninja",
                        "binaryDir": "${workspaceFolder}/build"
                    }
                ]
            }
            ));

        await presetsParser.resetPresetsFiles(
            new Map<string, PresetsFile>(),
            false,
            false
        );

        expect(presetsFileVersionErrors).to.have.lengthOf(1);
    }).timeout(100000);

    /**
     * Test version 2 of CMake Prests.
     * We want to ensure that we're requiring `binaryDir`.
     * `installDir`, `condition`, `toolchainFile` are not supported in version 2.
     */
    /* TODO: test('Validate version 2 CMakePresets, requires binaryDir', async () => {
        fs.writeFileSync(presetsParser.presetsPath,
            JSON.stringify({
                "version": 2,
                "configurePresets": [
                    {
                        "name": "configure",
                        "hidden": false,
                        "generator": "Ninja"
                    }
                ]
            }
            ));

        await presetsParser.resetPresetsFiles(
            (_f, p) => (presetsContainer.expandedPresets = p),
            (_f, p) => (presetsContainer.expandedUserPresets = p),
            (_f, p) => (presetsContainer.presetsPlusIncluded = p),
            (_f, p) => (presetsContainer.userPresetsPlusIncluded = p),
            (_f, p) => (presetsContainer.originalPresets = p),
            (_f, p) => (presetsContainer.originalUserPresets = p),
            new Map<string, PresetsFile>(),
            false,
            false
        );

        expect(presetsFileErrors).to.have.lengthOf(1);
        expect(presetsFileErrors.filter((e) => e.includes("binaryDir"))).to.have.lengthOf(1);
        expect(presetsContainer.expandedPresets).to.be.undefined;
        expect(presetsContainer.expandedUserPresets).to.be.undefined;
        expect(presetsContainer.presetsPlusIncluded).to.be.undefined;
        expect(presetsContainer.userPresetsPlusIncluded).to.be.undefined;
    }).timeout(100000);*/

    /**
     * Test version 2 of CMake Prests.
     * Ensure that we're validating and that `installDir`, `condition`, and `toolchainFile` aren't allowed.
     */
    test('Validate version 2 CMakePresets, requires binaryDir', async () => {
        fs.writeFileSync(presetsParser.presetsPath,
            JSON.stringify({
                "version": 2,
                "configurePresets": [
                    {
                        "name": "configure",
                        "hidden": false,
                        "generator": "Ninja",
                        "installDir": "${workspaceFolder}/install",
                        "condition": {
                            "type": "equals",
                            "lhs": "${hostSystemName}",
                            "rhs": "Windows"
                        },
                        "toolchainFile": ""
                    }
                ]
            }
            ));

        await presetsParser.resetPresetsFiles(
            new Map<string, PresetsFile>(),
            false,
            false
        );

        expect(presetsFileErrors).to.have.lengthOf(4);
        expect(presetsFileErrors.filter((e) => e.includes("should NOT have additional properties: installDir"))).to.have.lengthOf(1);
        expect(presetsFileErrors.filter((e) => e.includes("should NOT have additional properties: condition"))).to.have.lengthOf(1);
        expect(presetsFileErrors.filter((e) => e.includes("should NOT have additional properties: toolchainFile"))).to.have.lengthOf(1);
        expect(preset.configurePresets(sourceDirectory).length).to.be.equal(0);
    }).timeout(100000);

    /**
     * Test validation of version 3 of CMake Prests.
     * Ensure that `installDir` and `condition` are accepted.
     *
     * Then, add add `include` and `buildPresets with `resolvePackageReference`, confirm that `include` and `resolvePackageReference` are not allowed.
     */
    test('Validate version 3 CMakePresets', async () => {
        fs.writeFileSync(presetsParser.presetsPath,
            JSON.stringify({
                "version": 3,
                "configurePresets": [
                    {
                        "name": "configure",
                        "hidden": false,
                        "generator": "Ninja",
                        "installDir": "${workspaceFolder}/install",
                        "condition": {
                            "type": "equals",
                            "lhs": "${hostSystemName}",
                            "rhs": "Windows"
                        },
                        "toolchainFile": ""
                    }
                ]
            }
            ));

        await presetsParser.resetPresetsFiles(
            new Map<string, PresetsFile>(),
            false,
            false
        );

        expect(presetsFileErrors).to.have.lengthOf(0);
        expect(preset.configurePresets(sourceDirectory).length).to.be.equal(1);

        fs.writeFileSync(presetsParser.presetsPath,
            JSON.stringify({
                "version": 3,
                "include": ["test.json"],
                "configurePresets": [
                    {
                        "name": "configure",
                        "hidden": false,
                        "generator": "Ninja",
                        "installDir": "${workspaceFolder}/install",
                        "condition": {
                            "type": "equals",
                            "lhs": "${hostSystemName}",
                            "rhs": "Windows"
                        },
                        "toolchainFile": ""
                    }
                ],
                "buildPresets": [
                    {
                        "name": "x64-debug",
                        "configurePreset": "configure",
                        "cleanFirst": true,
                        "resolvePackageReferences": "on"
                    }
                ]
            }
            ));

        await presetsParser.resetPresetsFiles(
            new Map<string, PresetsFile>(),
            false,
            false
        );

        expect(presetsFileErrors).to.have.lengthOf(3);
        expect(presetsFileErrors.filter((e) => e.includes("should NOT have additional properties: include"))).to.have.lengthOf(1);
        expect(presetsFileErrors.filter((e) => e.includes("should NOT have additional properties: resolvePackageReference"))).to.have.lengthOf(1);
        expect(preset.configurePresets(sourceDirectory).length).to.be.equal(0);
        expect(preset.buildPresets(sourceDirectory).length).to.be.equal(0);
    }).timeout(100000);

    /**
     * First test that the `include` and `resolvePackageReferences` fields are allowed in version 4.
     * Then, test that fields only allowed in 5 aren't supported, by adding a testPreset with the `testOutputTrunction` field added.
     */
    test('Validate version 4 CMakePresets', async () => {
        fs.writeFileSync(presetsParser.presetsPath,
            JSON.stringify({
                "version": 4,
                "include": ["test.json"],
                "configurePresets": [
                    {
                        "name": "configure",
                        "hidden": false,
                        "generator": "Ninja",
                        "installDir": "${workspaceFolder}/install",
                        "condition": {
                            "type": "equals",
                            "lhs": "${hostSystemName}",
                            "rhs": "Windows"
                        },
                        "toolchainFile": ""
                    }
                ],
                "buildPresets": [
                    {
                        "name": "x64-debug",
                        "configurePreset": "configure",
                        "cleanFirst": true,
                        "resolvePackageReferences": "on"
                    }
                ]
            }
            ));
        fs.writeFileSync(path.join(presetsParser.presetsPath, "..", "test.json"),
            JSON.stringify({
                "version": 4,
                "configurePresets": [
                    {
                        "name": "blah",
                        "hidden": false,
                        "generator": "Ninja",
                        "installDir": "${workspaceFolder}/install",
                        "condition": {
                            "type": "equals",
                            "lhs": "${hostSystemName}",
                            "rhs": "Windows"
                        },
                        "toolchainFile": ""
                    }
                ]
            }
            ));

        await presetsParser.resetPresetsFiles(
            new Map<string, PresetsFile>(),
            false,
            false
        );

        expect(presetsFileErrors).to.have.lengthOf(0);
        expect(preset.configurePresets(sourceDirectory).length).to.be.equal(2);
        expect(preset.buildPresets(sourceDirectory).length).to.be.equal(1);

        // Remove the include.
        fs.rmSync(path.join(presetsParser.presetsPath, "..", "test.json"));

        fs.writeFileSync(presetsParser.presetsPath,
            JSON.stringify({
                "version": 4,
                "configurePresets": [
                    {
                        "name": "configure",
                        "hidden": false,
                        "generator": "Ninja",
                        "installDir": "${workspaceFolder}/install",
                        "condition": {
                            "type": "equals",
                            "lhs": "${hostSystemName}",
                            "rhs": "Windows"
                        },
                        "toolchainFile": ""
                    }
                ],
                "buildPresets": [
                    {
                        "name": "x64-debug",
                        "configurePreset": "configure",
                        "cleanFirst": true,
                        "resolvePackageReferences": "on"
                    }
                ],
                "testPresets": [
                    {
                        "name": "x64-debug",
                        "configurePreset": "configure",
                        "output": {
                            "testOutputTruncation": "tail"
                        }
                    }
                ]
            }
            ));

        await presetsParser.resetPresetsFiles(
            new Map<string, PresetsFile>(),
            false,
            false
        );

        expect(presetsFileErrors).to.have.lengthOf(2);
        expect(presetsFileErrors.filter((e) => e.includes("should NOT have additional properties: testOutputTruncation"))).to.have.lengthOf(1);
        expect(preset.configurePresets(sourceDirectory).length).to.be.equal(0);
        expect(preset.buildPresets(sourceDirectory).length).to.be.equal(0);
    }).timeout(100000);

    /**
     * First test that the `testOutputTruncation field is allowed in version 5.
     */
    test('Validate version 5 CMakePresets', async () => {
        fs.writeFileSync(presetsParser.presetsPath,
            JSON.stringify({
                "version": 5,
                "configurePresets": [
                    {
                        "name": "configure",
                        "hidden": false,
                        "generator": "Ninja",
                        "installDir": "${workspaceFolder}/install",
                        "condition": {
                            "type": "equals",
                            "lhs": "${hostSystemName}",
                            "rhs": "Windows"
                        },
                        "toolchainFile": ""
                    }
                ],
                "buildPresets": [
                    {
                        "name": "x64-debug",
                        "configurePreset": "configure",
                        "cleanFirst": true,
                        "resolvePackageReferences": "on"
                    }
                ],
                "testPresets": [
                    {
                        "name": "x64-debug",
                        "configurePreset": "configure",
                        "output": {
                            "testOutputTruncation": "tail"
                        }
                    }
                ]
            }
            ));

        await presetsParser.resetPresetsFiles(
            new Map<string, PresetsFile>(),
            false,
            false
        );

        expect(presetsFileErrors).to.have.lengthOf(0);
        expect(preset.configurePresets(sourceDirectory).length).to.be.equal(1);
        expect(preset.buildPresets(sourceDirectory).length).to.be.equal(1);
        expect(preset.testPresets(sourceDirectory).length).to.be.equal(1);

        fs.writeFileSync(presetsParser.presetsPath,
            JSON.stringify({
                "version": 5,
                "configurePresets": [
                    {
                        "name": "configure",
                        "hidden": false,
                        "generator": "Ninja",
                        "installDir": "${workspaceFolder}/install",
                        "condition": {
                            "type": "equals",
                            "lhs": "${hostSystemName}",
                            "rhs": "Windows"
                        },
                        "toolchainFile": ""
                    }
                ],
                "buildPresets": [
                    {
                        "name": "x64-debug",
                        "configurePreset": "configure",
                        "cleanFirst": true,
                        "resolvePackageReferences": "on"
                    }
                ],
                "testPresets": [
                    {
                        "name": "x64-debug",
                        "configurePreset": "configure",
                        "output": {
                            "testOutputTruncation": "tail"
                        }
                    }
                ],
                "packagePresets": [
                    {
                        "name": "x64-debug-package"
                    }
                ],
                "workflowPresets": [
                    {
                        "name": "x64-debug-workflow",
                        "steps": [
                            {
                                "type": "configure",
                                "name": "x64-debug"
                            }
                        ]
                    }
                ]
            }
            ));

        await presetsParser.resetPresetsFiles(
            new Map<string, PresetsFile>(),
            false,
            false
        );

        expect(presetsFileErrors).to.have.lengthOf(3);
        expect(presetsFileErrors.filter((e) => e.includes("should NOT have additional properties: packagePresets"))).to.have.lengthOf(1);
        expect(presetsFileErrors.filter((e) => e.includes("should NOT have additional properties: workflowPresets"))).to.have.lengthOf(1);
        expect(preset.configurePresets(sourceDirectory).length).to.be.equal(0);
        expect(preset.buildPresets(sourceDirectory).length).to.be.equal(0);
        expect(preset.testPresets(sourceDirectory).length).to.be.equal(0);
        expect(preset.packagePresets(sourceDirectory).length).to.be.equal(0);
        expect(preset.workflowPresets(sourceDirectory).length).to.be.equal(0);
    }).timeout(100000);

    /**
     * Validate the `packagePresets` and `workflowPresets` are supported in Presets v6.
     */
    test('Validate version 6 CMakePresets', async () => {
        fs.writeFileSync(presetsParser.presetsPath,
            JSON.stringify({
                "version": 6,
                "configurePresets": [
                    {
                        "name": "configure",
                        "hidden": false,
                        "generator": "Ninja",
                        "installDir": "${workspaceFolder}/install",
                        "condition": {
                            "type": "equals",
                            "lhs": "${hostSystemName}",
                            "rhs": "Windows"
                        },
                        "toolchainFile": ""
                    }
                ],
                "buildPresets": [
                    {
                        "name": "x64-debug",
                        "configurePreset": "configure",
                        "cleanFirst": true,
                        "resolvePackageReferences": "on"
                    }
                ],
                "testPresets": [
                    {
                        "name": "x64-debug",
                        "configurePreset": "configure",
                        "output": {
                            "testOutputTruncation": "tail"
                        }
                    }
                ],
                "packagePresets": [
                    {
                        "name": "x64-debug-package"
                    }
                ],
                "workflowPresets": [
                    {
                        "name": "x64-debug-workflow",
                        "steps": [
                            {
                                "type": "configure",
                                "name": "configure"
                            }
                        ]
                    }
                ]
            }
            ));

        await presetsParser.resetPresetsFiles(
            new Map<string, PresetsFile>(),
            false,
            false
        );

        expect(presetsFileErrors).to.have.lengthOf(0);
        expect(preset.configurePresets(sourceDirectory).length).to.be.equal(1);
        expect(preset.buildPresets(sourceDirectory).length).to.be.equal(1);
        expect(preset.testPresets(sourceDirectory).length).to.be.equal(1);
        expect(preset.packagePresets(sourceDirectory).length).to.be.equal(1);
        expect(preset.workflowPresets(sourceDirectory).length).to.be.equal(1);
    }).timeout(100000);

    teardown(async () => {
        if (fs.existsSync(presetsParser.presetsPath)) {
            fs.rmSync(presetsParser.presetsPath);
        }

        if (fs.existsSync(presetsParser.userPresetsPath)) {
            fs.rmSync(presetsParser.userPresetsPath);
        }
    });
});
