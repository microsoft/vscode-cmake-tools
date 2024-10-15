import * as preset from "@cmt/presets/preset";
import json5 = require("json5");
import * as nls from "vscode-nls";
import * as logging from "@cmt/logging";
import * as path from "path";
import * as util from "@cmt/util";
import { fs } from "@cmt/pr";
import * as lodash from "lodash";
import { expandString, ExpansionErrorHandler, MinimalPresetContextVars } from "@cmt/expand";
import { loadSchema } from "@cmt/schema";

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger("presetController");

type SetPresetsFileFunc = (folder: string, presets: preset.PresetsFile | undefined) => void;

/**
 * This class is designed to be a file that parses and evaluates the presets file (along with the user presets file).
 * This is designed to be able to take in a folder location or a file location and parse the presets file accordingly.
 * This class is designed to be used in the PresetController class, and it's designed to be standalone from vscode specific implementation
 * so that it can be unit tested in isolation.
 */
export class PresetsParser {
    private folderPath: string;
    private _sourceDir: string;
    private workspaceFolder: string;
    private presetsFileErrorReporter: (
        path: string,
        expansionErrors: ExpansionErrorHandler
    ) => Promise<void>;
    private showPresetsFileVersionError: (file: string) => Promise<void>;
    private _presetsFileExists = false;
    private _userPresetsFileExists = false;
    private collectionsModifier: (filePath: string) => void;
    private presetsChangedHandler: (presets: preset.PresetsFile | undefined) => void;
    private userPresetsChangedHandler: (presets: preset.PresetsFile | undefined) => void;

    /**
     * Constructs the PresetsParser object
     * @param folderPath Folder path of the presets file.
     * @param sourceDir Source directory of the presets file.
     * @param workspaceFolder Workspace folder of the presets file.
     * @param presetsFileErrorReporter Callback that reports errors in the presets file.
     * @param showPresetsFileVersionError Callback that reports errors with unsupported Presets versions.
     * @param collectionsModifier Callback that modifies the collections (Problems pane) of the presets file.
     * @param presetsChangedHandler Callback that handles the presets file being changed.
     * @param userPresetsChangedHandler Callback that handles the user presets file being changed.
     */
    public constructor(
        folderPath: string,
        sourceDir: string,
        workspaceFolder: string,
        presetsFileErrorReporter: (
            path: string,
            expansionErrors: ExpansionErrorHandler
        ) => Promise<void>,
        showPresetsFileVersionError: (file: string) => Promise<void>,
        collectionsModifier: (filePath: string) => void,
        presetsChangedHandler: (presets: preset.PresetsFile | undefined) => void,
        userPresetsChangedHandler: (presets: preset.PresetsFile | undefined) => void
    ) {
        this.folderPath = folderPath;
        this._sourceDir = sourceDir;
        this.workspaceFolder = workspaceFolder;
        this.presetsFileErrorReporter = presetsFileErrorReporter;
        this.showPresetsFileVersionError = showPresetsFileVersionError;
        this.collectionsModifier = collectionsModifier;
        this.presetsChangedHandler = presetsChangedHandler;
        this.userPresetsChangedHandler = userPresetsChangedHandler;
    }

    set sourceDir(sourceDir: string) {
        this._sourceDir = sourceDir;
    }

    get presetsFileExists(): boolean {
        return this._presetsFileExists || this._userPresetsFileExists;
    }

    get presetsPath() {
        return path.join(this._sourceDir, 'CMakePresets.json');
    }

    get userPresetsPath() {
        return path.join(this._sourceDir, 'CMakeUserPresets.json');
    }

    public async resetPresetsFiles(referencedFiles: Map<string, preset.PresetsFile | undefined>, allowCommentsInPresetsFile: boolean, allowUnsupportedPresetsVersions: boolean) {
        await this.resetPresetsFile(this.presetsPath, this._setExpandedPresets, this._setPresetsPlusIncluded, this._setOriginalPresetsFile, exists => this._presetsFileExists = exists, referencedFiles, allowCommentsInPresetsFile, allowUnsupportedPresetsVersions);
        await this.resetPresetsFile(this.userPresetsPath, this._setExpandedUserPresetsFile, this._setUserPresetsPlusIncluded, this._setOriginalUserPresetsFile, exists => this._userPresetsFileExists = exists, referencedFiles, allowCommentsInPresetsFile, allowUnsupportedPresetsVersions);
    }

    private readonly _setExpandedPresets = (folder: string, presetsFile: preset.PresetsFile | undefined) => {
        const clone = lodash.cloneDeep(presetsFile);
        preset.setExpandedPresets(folder, clone);
        this.presetsChangedHandler(clone);
    };

    private readonly _setExpandedUserPresetsFile = (folder: string, presetsFile: preset.PresetsFile | undefined) => {
        const clone = lodash.cloneDeep(presetsFile);
        preset.setExpandedUserPresetsFile(folder, clone);
        this.userPresetsChangedHandler(clone);
    };

    private readonly _setPresetsPlusIncluded = (folder: string, presetsFile: preset.PresetsFile | undefined) => {
        const clone = lodash.cloneDeep(presetsFile);
        preset.setPresetsPlusIncluded(folder, clone);
        this.presetsChangedHandler(clone);
    };

    private readonly _setUserPresetsPlusIncluded = (folder: string, presetsFile: preset.PresetsFile | undefined) => {
        const clone = lodash.cloneDeep(presetsFile);
        preset.setUserPresetsPlusIncluded(folder, clone);
        this.userPresetsChangedHandler(clone);
    };

    private readonly _setOriginalPresetsFile = (folder: string, presetsFile: preset.PresetsFile | undefined) => {
        const clone = lodash.cloneDeep(presetsFile);
        preset.setOriginalPresetsFile(folder, clone);
    };

    private readonly _setOriginalUserPresetsFile = (folder: string, presetsFile: preset.PresetsFile | undefined) => {
        const clone = lodash.cloneDeep(presetsFile);
        preset.setOriginalUserPresetsFile(folder, clone);
    };

    private async validatePresetsFile(
        presetsFile: preset.PresetsFile | undefined,
        file: string,
        allowUnsupportedPresetsVersions: boolean,
        expansionErrors: ExpansionErrorHandler
    ): Promise<preset.PresetsFile | undefined> {
        if (!presetsFile) {
            return undefined;
        }

        log.info(
            localize(
                "validating.presets.file",
                'Reading and validating the presets "file {0}"',
                file
            )
        );
        let schemaFile;
        const maxSupportedVersion = 9;
        const validationErrorsAreWarnings =
            presetsFile.version > maxSupportedVersion &&
            allowUnsupportedPresetsVersions;
        if (presetsFile.version < 2) {
            await this.showPresetsFileVersionError(file);
            return undefined;
        } else if (presetsFile.version === 2) {
            schemaFile = "./schemas/CMakePresets-schema.json";
        } else if (presetsFile.version === 3) {
            schemaFile = "./schemas/CMakePresets-v3-schema.json";
        } else if (presetsFile.version === 4) {
            schemaFile = "./schemas/CMakePresets-v4-schema.json";
        } else if (presetsFile.version === 5) {
            schemaFile = "./schemas/CMakePresets-v5-schema.json";
        } else if (presetsFile.version === 6) {
            schemaFile = "./schemas/CMakePresets-v6-schema.json";
        } else if (presetsFile.version === 7) {
            schemaFile = "./schemas/CMakePresets-v7-schema.json";
        } else {
            // This can be used for v9 as well, there is no schema difference.
            schemaFile = "./schemas/CMakePresets-v8-schema.json";
        }

        const validator = await loadSchema(schemaFile);
        const is_valid = validator(presetsFile);
        if (!is_valid) {
            const showErrors = (logFunc: (x: string) => void) => {
                const errors = validator.errors!;
                logFunc(
                    localize(
                        "unsupported.presets",
                        "Unsupported presets detected in {0}. Support is limited to features defined by version {1}.",
                        file,
                        maxSupportedVersion
                    )
                );
                for (const err of errors) {
                    if (err.params && "additionalProperty" in err.params) {
                        logFunc(
                            ` >> ${err.dataPath}: ${localize(
                                "no.additional.properties",
                                "should NOT have additional properties"
                            )}: ${err.params.additionalProperty}`
                        );
                    } else {
                        logFunc(` >> ${err.dataPath}: ${err.message}`);
                    }
                }
            };
            if (validationErrorsAreWarnings) {
                showErrors((x) => log.warning(x));
                return presetsFile;
            } else {
                showErrors((x) => {
                    log.error(x);
                    expansionErrors.errorList.push([x, file]);
                });
                log.error(
                    localize(
                        "unsupported.presets.disable",
                        "Unknown properties and macros can be ignored by using the {0} setting.",
                        "'cmake.allowUnsupportedPresetsVersions'"
                    )
                );
                return undefined;
            }
        }

        for (const pr of presetsFile?.buildPresets || []) {
            const dupe = presetsFile?.buildPresets?.find(
                (p) => pr.name === p.name && p !== pr
            );
            if (dupe) {
                log.error(
                    localize(
                        "duplicate.build.preset.found",
                        'Found duplicates within the build presets collection: "{0}"',
                        pr.name
                    )
                );
                return undefined;
            }
        }

        for (const pr of presetsFile?.testPresets || []) {
            const dupe = presetsFile?.testPresets?.find(
                (p) => pr.name === p.name && p !== pr
            );
            if (dupe) {
                log.error(
                    localize(
                        "duplicate.test.preset.found",
                        'Found duplicates within the test presets collection: "{0}"',
                        pr.name
                    )
                );
                return undefined;
            }
        }

        for (const pr of presetsFile?.packagePresets || []) {
            const dupe = presetsFile?.packagePresets?.find(
                (p) => pr.name === p.name && p !== pr
            );
            if (dupe) {
                log.error(
                    localize(
                        "duplicate.package.preset.found",
                        'Found duplicates within the package presets collection: "{0}"',
                        pr.name
                    )
                );
                return undefined;
            }
        }

        for (const pr of presetsFile?.workflowPresets || []) {
            const dupe = presetsFile?.workflowPresets?.find(
                (p) => pr.name === p.name && p !== pr
            );
            if (dupe) {
                log.error(
                    localize(
                        "duplicate.workflow.preset.found",
                        'Found duplicates within the workflow presets collection: "{0}"',
                        pr.name
                    )
                );
                return undefined;
            }
        }

        for (const pr of presetsFile.workflowPresets || []) {
            if (pr.steps.length < 1 || pr.steps[0].type !== "configure") {
                log.error(
                    localize(
                        "workflow.does.not.start.configure.step",
                        'The workflow preset "{0}" does not start with a configure step.',
                        pr.name
                    )
                );
                return undefined;
            }

            for (const step of pr.steps) {
                if (step.type === "configure" && step !== pr.steps[0]) {
                    log.error(
                        localize(
                            "workflow.has.subsequent.configure.preset",
                            'The workflow preset "{0}" has another configure preset "{1}" besides the first step "{2}": ',
                            pr.name,
                            step.name,
                            pr.steps[0].name
                        )
                    );
                    return undefined;
                }
            }
        }

        log.info(
            localize(
                "successfully.validated.presets",
                "Successfully validated {0} against presets schema",
                file
            )
        );
        return presetsFile;
    }

    private async getExpandedInclude(
        presetsFile: preset.PresetsFile,
        include: string,
        file: string,
        hostSystemName: string,
        expansionErrors: ExpansionErrorHandler
    ): Promise<string> {
        return presetsFile.version >= 9
            ? expandString(
                include,
                {
                    vars: {
                        sourceDir: this.folderPath,
                        sourceParentDir: path.dirname(this.folderPath),
                        sourceDirName: path.basename(this.folderPath),
                        hostSystemName: hostSystemName,
                        fileDir: path.dirname(file),
                        pathListSep: path.delimiter
                    },
                    envOverride: {} // $env{} expansions are not supported in `include` v9
                },
                expansionErrors
            )
            : presetsFile.version >= 7
                ? // Version 7 and later support $penv{} expansions in include paths
                expandString(
                    include,
                    {
                        // No vars are supported in Version 7 for include paths.
                        vars: {} as MinimalPresetContextVars,
                        envOverride: {} // $env{} expansions are not supported in `include` v9
                    },
                    expansionErrors
                )
                : include;
    }

    private async mergeIncludeFiles(
        presetsFile: preset.PresetsFile | undefined,
        file: string,
        referencedFiles: Map<string, preset.PresetsFile | undefined>,
        expansionErrors: ExpansionErrorHandler,
        allowCommentsInPresetsFile: boolean,
        allowUnsupportedPresetsVersions: boolean
    ): Promise<void> {
        if (!presetsFile) {
            return;
        }

        const hostSystemName = await util.getHostSystemNameMemo();

        // CMakeUserPresets.json file should include CMakePresets.json file, by default.
        if (this.presetsFileExists && file === this.userPresetsPath) {
            presetsFile.include = presetsFile.include || [];
            const filteredIncludes = [];
            for (const include of presetsFile.include) {
                const expandedInclude = await this.getExpandedInclude(
                    presetsFile,
                    include,
                    file,
                    hostSystemName,
                    expansionErrors
                );
                if (
                    path.normalize(
                        path.resolve(path.dirname(file), expandedInclude)
                    ) === this.presetsPath
                ) {
                    filteredIncludes.push(include);
                }
            }

            if (filteredIncludes.length === 0) {
                presetsFile.include.push(this.presetsPath);
            }
        }

        if (!presetsFile.include) {
            return;
        }

        // Merge the includes in reverse order so that the final presets order is correct
        for (let i = presetsFile.include.length - 1; i >= 0; i--) {
            const rawInclude = presetsFile.include[i];
            const includePath = await this.getExpandedInclude(
                presetsFile,
                rawInclude,
                file,
                hostSystemName,
                expansionErrors
            );
            const fullIncludePath = path.normalize(
                path.resolve(path.dirname(file), includePath)
            );

            // Do not include files more than once
            if (referencedFiles.has(fullIncludePath)) {
                const referencedIncludeFile =
                    referencedFiles.get(fullIncludePath);
                if (referencedIncludeFile) {
                    if (referencedIncludeFile.configurePresets) {
                        presetsFile.configurePresets = lodash.unionWith(
                            referencedIncludeFile.configurePresets,
                            presetsFile.configurePresets || [],
                            (a, b) => a.name === b.name
                        );
                    }
                    if (referencedIncludeFile.buildPresets) {
                        presetsFile.buildPresets = lodash.unionWith(
                            referencedIncludeFile.buildPresets,
                            presetsFile.buildPresets || [],
                            (a, b) => a.name === b.name
                        );
                    }
                    if (referencedIncludeFile.testPresets) {
                        presetsFile.testPresets = lodash.unionWith(
                            referencedIncludeFile.testPresets,
                            presetsFile.testPresets || [],
                            (a, b) => a.name === b.name
                        );
                    }
                    if (referencedIncludeFile.packagePresets) {
                        presetsFile.packagePresets = lodash.unionWith(
                            referencedIncludeFile.packagePresets,
                            presetsFile.packagePresets || [],
                            (a, b) => a.name === b.name
                        );
                    }
                    if (referencedIncludeFile.workflowPresets) {
                        presetsFile.workflowPresets = lodash.unionWith(
                            referencedIncludeFile.workflowPresets,
                            presetsFile.workflowPresets || [],
                            (a, b) => a.name === b.name
                        );
                    }
                    if (referencedIncludeFile.cmakeMinimumRequired) {
                        if (
                            !presetsFile.cmakeMinimumRequired ||
                            util.versionLess(
                                presetsFile.cmakeMinimumRequired,
                                referencedIncludeFile.cmakeMinimumRequired
                            )
                        ) {
                            presetsFile.cmakeMinimumRequired =
                                referencedIncludeFile.cmakeMinimumRequired;
                        }
                    }
                }
                continue;
            }
            // Record the file as referenced, even if the file does not exist.
            referencedFiles.set(fullIncludePath, undefined);

            const includeFileBuffer = await this.readPresetsFile(
                fullIncludePath
            );
            if (!includeFileBuffer) {
                log.error(
                    localize(
                        "included.presets.file.not.found",
                        "Included presets file {0} cannot be found",
                        fullIncludePath
                    )
                );
                expansionErrors.errorList.push([
                    localize(
                        "included.presets.file.not.found",
                        "Included presets file {0} cannot be found",
                        fullIncludePath
                    ),
                    file
                ]);
                continue;
            }

            let includeFile = await this.parsePresetsFile(
                includeFileBuffer,
                fullIncludePath,
                allowCommentsInPresetsFile
            );
            referencedFiles.set(fullIncludePath, includeFile);
            includeFile = await this.validatePresetsFile(
                includeFile,
                fullIncludePath,
                allowUnsupportedPresetsVersions,
                expansionErrors
            );
            if (!includeFile) {
                continue;
            }

            // Private fields must be set after validation, otherwise validation would fail.
            this.populatePrivatePresetsFields(includeFile, fullIncludePath);

            // Recursively merge included files
            await this.mergeIncludeFiles(
                includeFile,
                fullIncludePath,
                referencedFiles,
                expansionErrors,
                allowCommentsInPresetsFile,
                allowUnsupportedPresetsVersions
            );

            if (includeFile.configurePresets) {
                presetsFile.configurePresets = lodash.unionWith(
                    includeFile.configurePresets,
                    presetsFile.configurePresets || [],
                    (a, b) => a.name === b.name
                );
            }
            if (includeFile.buildPresets) {
                presetsFile.buildPresets = lodash.unionWith(
                    includeFile.buildPresets,
                    presetsFile.buildPresets || [],
                    (a, b) => a.name === b.name
                );
            }
            if (includeFile.testPresets) {
                presetsFile.testPresets = lodash.unionWith(
                    includeFile.testPresets,
                    presetsFile.testPresets || [],
                    (a, b) => a.name === b.name
                );
            }
            if (includeFile.packagePresets) {
                presetsFile.packagePresets = lodash.unionWith(
                    includeFile.packagePresets,
                    presetsFile.packagePresets || [],
                    (a, b) => a.name === b.name
                );
            }
            if (includeFile.workflowPresets) {
                presetsFile.workflowPresets = lodash.unionWith(
                    includeFile.workflowPresets,
                    presetsFile.workflowPresets || [],
                    (a, b) => a.name === b.name
                );
            }
            if (includeFile.cmakeMinimumRequired) {
                if (
                    !presetsFile.cmakeMinimumRequired ||
                    util.versionLess(
                        presetsFile.cmakeMinimumRequired,
                        includeFile.cmakeMinimumRequired
                    )
                ) {
                    presetsFile.cmakeMinimumRequired =
                        includeFile.cmakeMinimumRequired;
                }
            }
        }

        if (
            expansionErrors.errorList.length > 0 ||
            expansionErrors.tempErrorList.length > 0
        ) {
            expansionErrors.tempErrorList.forEach((error) =>
                expansionErrors.errorList.unshift(error)
            );
            log.error(
                localize(
                    "expansion.errors",
                    "Expansion errors found in the presets file."
                )
            );
            expansionErrors.tempErrorList = [];
        } else {
            this.collectionsModifier(presetsFile.__path || "");
        }
    }

    private async readPresetsFile(file: string): Promise<Buffer | undefined> {
        if (!(await fs.exists(file))) {
            return undefined;
        }
        log.debug(
            localize("reading.presets.file", "Reading presets file {0}", file)
        );
        return fs.readFile(file);
    }

    private async parsePresetsFile(
        fileContent: Buffer | undefined,
        file: string,
        allowCommentsInPresetsFile: boolean
    ): Promise<preset.PresetsFile | undefined> {
        if (!fileContent) {
            return undefined;
        }

        let presetsFile: preset.PresetsFile;
        try {
            if (allowCommentsInPresetsFile) {
                presetsFile = json5.parse(fileContent.toLocaleString());
            } else {
                presetsFile = JSON.parse(fileContent.toLocaleString());
            }
        } catch (e) {
            log.error(
                localize(
                    "failed.to.parse",
                    "Failed to parse {0}: {1}",
                    path.basename(file),
                    util.errorToString(e)
                )
            );
            return undefined;
        }
        return presetsFile;
    }

    private populatePrivatePresetsFields(
        presetsFile: preset.PresetsFile | undefined,
        file: string
    ) {
        if (!presetsFile) {
            return;
        }

        presetsFile.__path = file;
        const setFile = (presets?: preset.Preset[]) => {
            if (presets) {
                for (const preset of presets) {
                    preset.__file = presetsFile;
                }
            }
        };
        setFile(presetsFile.configurePresets);
        setFile(presetsFile.buildPresets);
        setFile(presetsFile.testPresets);
        setFile(presetsFile.workflowPresets);
        setFile(presetsFile.packagePresets);
    }

    /**
     * Returns the expanded presets file if there are no errors, otherwise returns undefined
     * Does not apply vsdevenv to the presets file
     */
    private async expandPresetsFile(
        presetsFile: preset.PresetsFile | undefined,
        expansionErrors: ExpansionErrorHandler
    ): Promise<preset.PresetsFile | undefined> {
        if (!presetsFile) {
            return undefined;
        }

        log.info(
            localize(
                "expanding.presets.file",
                "Expanding presets file {0}",
                presetsFile?.__path || ""
            )
        );

        const expandedConfigurePresets: preset.ConfigurePreset[] = [];
        for (const configurePreset of presetsFile?.configurePresets || []) {
            const inheritedPreset = await preset.getConfigurePresetInherits(
                this.folderPath,
                configurePreset.name,
                true,
                false,
                expansionErrors
            );
            if (inheritedPreset) {
                expandedConfigurePresets.push(
                    await preset.expandConfigurePresetVariables(
                        inheritedPreset,
                        this.folderPath,
                        configurePreset.name,
                        this.workspaceFolder,
                        this._sourceDir,
                        true,
                        false,
                        expansionErrors
                    )
                );
            }
        }

        const expandedBuildPresets: preset.BuildPreset[] = [];
        for (const buildPreset of presetsFile?.buildPresets || []) {
            const inheritedPreset = await preset.getBuildPresetInherits(
                this.folderPath,
                buildPreset.name,
                this.workspaceFolder,
                this._sourceDir,
                undefined,
                undefined,
                true,
                buildPreset.configurePreset,
                false,
                expansionErrors
            );
            if (inheritedPreset) {
                expandedBuildPresets.push(
                    await preset.expandBuildPresetVariables(
                        inheritedPreset,
                        buildPreset.name,
                        this.workspaceFolder,
                        this._sourceDir,
                        expansionErrors
                    )
                );
            }
        }

        const expandedTestPresets: preset.TestPreset[] = [];
        for (const testPreset of presetsFile?.testPresets || []) {
            const inheritedPreset = await preset.getTestPresetInherits(
                this.folderPath,
                testPreset.name,
                this.workspaceFolder,
                this._sourceDir,
                undefined,
                true,
                testPreset.configurePreset,
                false,
                expansionErrors
            );
            if (inheritedPreset) {
                expandedTestPresets.push(
                    await preset.expandTestPresetVariables(
                        inheritedPreset,
                        testPreset.name,
                        this.workspaceFolder,
                        this._sourceDir,
                        expansionErrors
                    )
                );
            }
        }

        const expandedPackagePresets: preset.PackagePreset[] = [];
        for (const packagePreset of presetsFile?.packagePresets || []) {
            const inheritedPreset = await preset.getPackagePresetInherits(
                this.folderPath,
                packagePreset.name,
                this.workspaceFolder,
                this._sourceDir,
                undefined,
                true,
                packagePreset.configurePreset,
                false,
                expansionErrors
            );
            if (inheritedPreset) {
                expandedPackagePresets.push(
                    await preset.expandPackagePresetVariables(
                        inheritedPreset,
                        packagePreset.name,
                        this.workspaceFolder,
                        this._sourceDir,
                        expansionErrors
                    )
                );
            }
        }

        const expandedWorkflowPresets: preset.WorkflowPreset[] = [];
        for (const workflowPreset of presetsFile?.workflowPresets || []) {
            const inheritedPreset = await preset.getWorkflowPresetInherits(
                this.folderPath,
                workflowPreset.name,
                this.workspaceFolder,
                this._sourceDir,
                true, // should this always be true?
                undefined, // should this always be undefined?
                false,
                expansionErrors
            );
            if (inheritedPreset && inheritedPreset !== null) {
                expandedWorkflowPresets.push(inheritedPreset);
            }
        }

        if (expansionErrors.errorList.length > 0) {
            log.error(
                localize(
                    "expansion.errors",
                    "Expansion errors found in the presets file."
                )
            );
            return undefined;
        } else {
            log.info(
                localize(
                    "successfully.expanded.presets.file",
                    "Successfully expanded presets file {0}",
                    presetsFile?.__path || ""
                )
            );

            // cache everything that we just expanded
            // we'll only need to expand again on set preset - to apply the vs dev env if needed
            presetsFile.configurePresets = expandedConfigurePresets;
            presetsFile.buildPresets = expandedBuildPresets;
            presetsFile.testPresets = expandedTestPresets;
            presetsFile.packagePresets = expandedPackagePresets;
            presetsFile.workflowPresets = expandedWorkflowPresets;

            // clear out the errors since there are none now
            this.collectionsModifier(presetsFile.__path || "");

            return presetsFile;
        }
    }

    private async resetPresetsFile(
        file: string,
        setExpandedPresets: SetPresetsFileFunc,
        setPresetsPlusIncluded: SetPresetsFileFunc,
        setOriginalPresetsFile: SetPresetsFileFunc,
        fileExistCallback: (fileExists: boolean) => void,
        referencedFiles: Map<string, preset.PresetsFile | undefined>,
        allowCommentsInPresetsFile: boolean,
        allowUnsupportedPresetsVersions: boolean
    ) {
        const presetsFileBuffer = await this.readPresetsFile(file);

        // There might be a better location for this, but for now this is the best one...
        fileExistCallback(Boolean(presetsFileBuffer));

        // Record the file as referenced, even if the file does not exist.
        let presetsFile = await this.parsePresetsFile(
            presetsFileBuffer,
            file,
            allowCommentsInPresetsFile
        );
        referencedFiles.set(file, presetsFile);
        if (presetsFile) {
            setOriginalPresetsFile(this.folderPath, presetsFile);
        } else {
            setOriginalPresetsFile(this.folderPath, undefined);
        }

        const expansionErrors: ExpansionErrorHandler = {
            errorList: [],
            tempErrorList: []
        };

        presetsFile = await this.validatePresetsFile(
            presetsFile,
            file,
            allowUnsupportedPresetsVersions,
            expansionErrors
        );
        if (presetsFile) {
            // Private fields must be set after validation, otherwise validation would fail.
            this.populatePrivatePresetsFields(presetsFile, file);
            await this.mergeIncludeFiles(
                presetsFile,
                file,
                referencedFiles,
                expansionErrors,
                allowCommentsInPresetsFile,
                allowUnsupportedPresetsVersions
            );

            if (
                expansionErrors.errorList.length > 0 ||
                expansionErrors.tempErrorList.length > 0
            ) {
                presetsFile = undefined;
            } else {
                // add the include files to the original presets file
                setPresetsPlusIncluded(this.folderPath, presetsFile);

                // set the pre-expanded version so we can call expandPresetsFile on it
                setExpandedPresets(this.folderPath, presetsFile);
                presetsFile = await this.expandPresetsFile(
                    presetsFile,
                    expansionErrors
                );
            }
        }

        if (expansionErrors.errorList.length > 0 ||
            expansionErrors.tempErrorList.length > 0
        ) {
            await this.presetsFileErrorReporter(file, expansionErrors);
        }

        setExpandedPresets(this.folderPath, presetsFile);
    }
}
