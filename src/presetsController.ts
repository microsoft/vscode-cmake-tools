import * as chokidar from 'chokidar';
import * as path from 'path';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';

import { CMakeProject, ConfigureTrigger, ConfigureType } from '@cmt/cmakeProject';
import * as logging from '@cmt/logging';
import { fs } from '@cmt/pr';
import * as preset from '@cmt/preset';
import * as util from '@cmt/util';
import rollbar from '@cmt/rollbar';
import { ExpansionOptions, getParentEnvSubstitutions, substituteAll } from '@cmt/expand';
import paths from '@cmt/paths';
import { KitsController } from '@cmt/kitsController';
import { descriptionForKit, Kit, SpecialKits } from '@cmt/kit';
import { getHostTargetArchString } from '@cmt/installs/visualStudio';
import { loadSchema } from '@cmt/schema';
import json5 = require('json5');

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('presetController');

type SetPresetsFileFunc = (folder: string, presets: preset.PresetsFile | undefined) => void;

export class PresetsController {
    private _presetsWatcher: chokidar.FSWatcher | undefined;
    private _sourceDir: string = '';
    private _sourceDirChangedSub: vscode.Disposable | undefined;
    private _presetsFileExists = false;
    private _userPresetsFileExists = false;
    private _isChangingPresets = false;
    private _referencedFiles: string[] = [];

    private readonly _presetsChangedEmitter = new vscode.EventEmitter<preset.PresetsFile | undefined>();
    private readonly _userPresetsChangedEmitter = new vscode.EventEmitter<preset.PresetsFile | undefined>();

    private static readonly _addPreset = '__addPreset__';

    static async init(project: CMakeProject, kitsController: KitsController, isMultiProject: boolean): Promise<PresetsController> {
        const presetsController = new PresetsController(project, kitsController, isMultiProject);
        const expandSourceDir = async (dir: string) => {
            const workspaceFolder = project.workspaceFolder.uri.fsPath;
            const expansionOpts: ExpansionOptions = {
                vars: {
                    workspaceFolder,
                    workspaceFolderBasename: path.basename(workspaceFolder),
                    workspaceHash: util.makeHashString(workspaceFolder),
                    workspaceRoot: workspaceFolder,
                    workspaceRootFolderName: path.dirname(workspaceFolder),
                    userHome: paths.userHome,
                    // Following fields are not supported for sourceDir expansion
                    generator: '${generator}',
                    sourceDir: '${sourceDir}',
                    sourceParentDir: '${sourceParentDir}',
                    sourceDirName: '${sourceDirName}',
                    presetName: '${presetName}'
                }
            };
            return util.normalizeAndVerifySourceDir(dir, expansionOpts);
        };

        presetsController._sourceDir = await expandSourceDir(project.sourceDir);

        // We explicitly read presets file here, instead of on the initialization of the file watcher. Otherwise
        // there might be timing issues, since listeners are invoked async.
        await presetsController.reapplyPresets();

        await presetsController.watchPresetsChange();

        project.workspaceContext.config.onChange('allowCommentsInPresetsFile', async () => {
            await presetsController.reapplyPresets();
            vscode.workspace.textDocuments.forEach(doc => {
                const fileName = path.basename(doc.uri.fsPath);
                if (fileName === 'CMakePresets.json' || fileName === 'CMakeUserPresets.json') {
                    if (project.workspaceContext.config.allowCommentsInPresetsFile) {
                        void vscode.languages.setTextDocumentLanguage(doc, 'jsonc');
                    } else {
                        void vscode.languages.setTextDocumentLanguage(doc, 'json');
                    }
                }
            });
        });

        project.workspaceContext.config.onChange('allowUnsupportedPresetsVersions', async () => {
            await presetsController.reapplyPresets();
        });

        return presetsController;
    }

    private constructor(private readonly project: CMakeProject, private readonly _kitsController: KitsController, private isMultiProject: boolean) {}

    get presetsPath() {
        return path.join(this._sourceDir, 'CMakePresets.json');
    }

    get userPresetsPath() {
        return path.join(this._sourceDir, 'CMakeUserPresets.json');
    }

    get workspaceFolder() {
        return this.project.workspaceFolder;
    }

    get folderPath() {
        return this.project.folderPath;
    }

    get folderName() {
        return this.project.folderName;
    }

    get presetsFileExist() {
        return this._presetsFileExists || this._userPresetsFileExists;
    }

    /**
     * Call configurePresets, buildPresets, testPresets, packagePresets or workflowPresets to get the latest presets when thie event is fired.
     */
    onPresetsChanged(listener: () => any) {
        return this._presetsChangedEmitter.event(listener);
    }

    /**
     * Call configurePresets, buildPresets, testPresets, packagePresets or workflowPresets to get the latest presets when thie event is fired.
     */
    onUserPresetsChanged(listener: () => any) {
        return this._userPresetsChangedEmitter.event(listener);
    }

    private readonly _setPresetsFile = (folder: string, presetsFile: preset.PresetsFile | undefined) => {
        preset.setPresetsFile(folder, presetsFile);
        this._presetsChangedEmitter.fire(presetsFile);
    };

    private readonly _setUserPresetsFile = (folder: string, presetsFile: preset.PresetsFile | undefined) => {
        preset.setUserPresetsFile(folder, presetsFile);
        this._userPresetsChangedEmitter.fire(presetsFile);
    };

    private readonly _setOriginalPresetsFile = (folder: string, presetsFile: preset.PresetsFile | undefined) => {
        preset.setOriginalPresetsFile(folder, presetsFile);
    };

    private readonly _setOriginalUserPresetsFile = (folder: string, presetsFile: preset.PresetsFile | undefined) => {
        preset.setOriginalUserPresetsFile(folder, presetsFile);
    };

    private async resetPresetsFile(file: string, setPresetsFile: SetPresetsFileFunc, setOriginalPresetsFile: SetPresetsFileFunc, fileExistCallback: (fileExists: boolean) => void, referencedFiles: Set<string>) {
        const presetsFileBuffer = await this.readPresetsFile(file);

        // There might be a better location for this, but for now this is the best one...
        fileExistCallback(Boolean(presetsFileBuffer));

        // Record the file as referenced, even if the file does not exist.
        referencedFiles.add(file);

        let presetsFile = await this.parsePresetsFile(presetsFileBuffer, file);
        if (presetsFile) {
            // Parse again so we automatically have a copy by value
            setOriginalPresetsFile(this.folderPath, await this.parsePresetsFile(presetsFileBuffer, file));
        } else {
            setOriginalPresetsFile(this.folderPath, undefined);
        }

        presetsFile = await this.validatePresetsFile(presetsFile, file);
        // Private fields must be set after validation, otherwise validation would fail.
        this.populatePrivatePresetsFields(presetsFile, file);
        await this.mergeIncludeFiles(presetsFile, presetsFile, file, referencedFiles);
        // TODO: more validation (or move some of the per file validation here when all entries are merged.
        // Like unresolved preset reference or duplicates).
        setPresetsFile(this.folderPath, presetsFile);
    }

    // Need to reapply presets every time presets changed since the binary dir or cmake path could change
    // (need to clean or reload driver)
    async reapplyPresets() {
        const referencedFiles: Set<string> = new Set();

        // Reset all changes due to expansion since parents could change
        await this.resetPresetsFile(this.presetsPath, this._setPresetsFile, this._setOriginalPresetsFile, exists => this._presetsFileExists = exists, referencedFiles);
        await this.resetPresetsFile(this.userPresetsPath, this._setUserPresetsFile, this._setOriginalUserPresetsFile, exists => this._userPresetsFileExists = exists, referencedFiles);

        this._referencedFiles = Array.from(referencedFiles);

        this.project.minCMakeVersion = preset.minCMakeVersion(this.folderPath);

        if (this.project.configurePreset) {
            await this.setConfigurePreset(this.project.configurePreset.name);
        }
        // Don't need to set build/test presets here since they are reapplied in setConfigurePreset
    }

    private showNameInputBox() {
        return vscode.window.showInputBox({ placeHolder: localize('preset.name', 'Preset name') });
    }

    private getOsName() {
        const platmap = {
            win32: 'Windows',
            darwin: 'macOS',
            linux: 'Linux'
        } as { [k: string]: preset.OsName };
        return platmap[process.platform];
    }

    async addConfigurePreset(quickStart?: boolean): Promise<boolean> {
        interface AddPresetQuickPickItem extends vscode.QuickPickItem {
            name: string;
        }

        enum SpecialOptions {
            CreateFromCompilers = '__createFromCompilers__',
            InheritConfigurationPreset = '__inheritConfigurationPreset__',
            ToolchainFile = '__toolchainFile__',
            Custom = '__custom__'
        }

        const items: AddPresetQuickPickItem[] = [];
        if (preset.configurePresets(this.folderPath).length > 0) {
            items.push({
                name: SpecialOptions.InheritConfigurationPreset,
                label: localize('inherit.config.preset', 'Inherit from Configure Preset'),
                description: localize('description.inherit.config.preset', 'Inherit from an existing configure preset')
            });
        }
        items.push({
            name: SpecialOptions.ToolchainFile,
            label: localize('toolchain.file', 'Toolchain File'),
            description: localize('description.toolchain.file', 'Configure with a CMake toolchain file')
        }, {
            name: SpecialOptions.Custom,
            label: localize('custom.config.preset', 'Custom'),
            description: localize('description.custom.config.preset', 'Add an custom configure preset')
        }, {
            name: SpecialOptions.CreateFromCompilers,
            label: localize('create.from.compilers', 'Create from Compilers'),
            description: localize('description.create.from.compilers', 'Create from a pair of compilers on this computer')
        });

        const chosenItem = await vscode.window.showQuickPick(items,
            { placeHolder: localize('add.a.config.preset.placeholder', 'Add a configure preset for {0}', this.folderName) });
        if (!chosenItem) {
            log.debug(localize('user.cancelled.add.config.preset', 'User cancelled adding configure preset'));
            return false;
        } else {
            let newPreset: preset.ConfigurePreset | undefined;
            let isMultiConfigGenerator: boolean = false;
            switch (chosenItem.name) {
                case SpecialOptions.CreateFromCompilers: {
                    // Check that we have kits
                    if (!await this._kitsController.checkHaveKits()) {
                        return false;
                    }

                    const allKits = this._kitsController.availableKits;
                    // Filter VS based on generators, for example:
                    // VS 2019 Release x86, VS 2019 Preview x86, and VS 2017 Release x86
                    // will be filtered to
                    // VS 2019 x86, VS 2017 x86
                    // Remove toolchain kits
                    const filteredKits: Kit[] = [];
                    for (const kit of allKits) {
                        if (kit.toolchainFile || kit.name === SpecialKits.Unspecified) {
                            continue;
                        }
                        let duplicate = false;
                        if (kit.visualStudio && !kit.compilers) {
                            for (const filteredKit of filteredKits) {
                                if (filteredKit.preferredGenerator?.name === kit.preferredGenerator?.name &&
                                    filteredKit.preferredGenerator?.platform === kit.preferredGenerator?.platform &&
                                    filteredKit.preferredGenerator?.toolset === kit.preferredGenerator?.toolset) {
                                    // Found same generator in the filtered list
                                    duplicate = true;
                                    break;
                                }
                            }
                        }
                        if (!duplicate) {
                            filteredKits.push(kit);
                        }
                    }

                    // if we are calling from quick start and no compilers are found, exit out with an error message
                    if (quickStart && filteredKits.length === 1 && filteredKits[0].name === SpecialKits.ScanForKits) {
                        log.debug(localize('no.compilers.available.for.quick.start', 'No compilers available for Quick Start'));

                        void vscode.window.showErrorMessage(
                            localize('no.compilers.available', 'Cannot generate a CmakePresets.json with Quick Start due to no compilers being available.'),
                            {
                                title: localize('learn.about.installing.compilers', 'Learn About Installing Compilers'),
                                isLearnMore: true
                            })
                            .then(async item => {
                                if (item && item.isLearnMore) {
                                    await vscode.env.openExternal(vscode.Uri.parse('https://code.visualstudio.com/docs/languages/cpp#_install-a-compiler'));
                                }
                            });
                        return false;
                    }

                    log.debug(localize('start.selection.of.compilers', 'Start selection of compilers. Found {0} compilers.', filteredKits.length));

                    interface KitItem extends vscode.QuickPickItem {
                        kit: Kit;
                    }
                    log.debug(localize('opening.compiler.selection', 'Opening compiler selection QuickPick'));
                    // Generate the quickpick items from our known kits
                    const getKitName = (kit: Kit) => {
                        if (kit.name === SpecialKits.ScanForKits) {
                            return `[${localize('scan.for.compilers.button', 'Scan for compilers')}]`;
                        } else if (kit.visualStudio && !kit.compilers) {
                            const hostTargetArch = getHostTargetArchString(kit.visualStudioArchitecture!, kit.preferredGenerator?.platform);
                            return `${(kit.preferredGenerator?.name || 'Visual Studio')} ${hostTargetArch}`;
                        } else {
                            return kit.name;
                        }
                    };
                    const item_promises = filteredKits.map(
                        async (kit): Promise<KitItem> => ({
                            label: getKitName(kit),
                            description: await descriptionForKit(kit, true),
                            kit
                        })
                    );
                    const quickPickItems = await Promise.all(item_promises);
                    const chosen_kit = await vscode.window.showQuickPick(quickPickItems,
                        { placeHolder: localize('select.a.compiler.placeholder', 'Select a Kit for {0}', this.folderName) });
                    if (chosen_kit === undefined) {
                        log.debug(localize('user.cancelled.compiler.selection', 'User cancelled compiler selection'));
                        // No selection was made
                        return false;
                    } else {
                        if (chosen_kit.kit.name === SpecialKits.ScanForKits) {
                            await KitsController.scanForKits(await this.project.getCMakePathofProject());
                            return false;
                        } else {
                            log.debug(localize('user.selected.compiler', 'User selected compiler {0}', JSON.stringify(chosen_kit)));
                            const generator = chosen_kit.kit.preferredGenerator?.name;
                            const cacheVariables: { [key: string]: preset.CacheVarType | undefined } = {
                                CMAKE_INSTALL_PREFIX: '${sourceDir}/out/install/${presetName}',
                                CMAKE_C_COMPILER: chosen_kit.kit.compilers?.['C'] || (chosen_kit.kit.visualStudio ? 'cl.exe' : undefined),
                                CMAKE_CXX_COMPILER: chosen_kit.kit.compilers?.['CXX'] || (chosen_kit.kit.visualStudio ? 'cl.exe' : undefined)
                            };
                            if (util.isString(cacheVariables['CMAKE_C_COMPILER'])) {
                                cacheVariables['CMAKE_C_COMPILER'] = cacheVariables['CMAKE_C_COMPILER'].replace(/\\/g, '/');
                            }
                            if (util.isString(cacheVariables['CMAKE_CXX_COMPILER'])) {
                                cacheVariables['CMAKE_CXX_COMPILER'] = cacheVariables['CMAKE_CXX_COMPILER'].replace(/\\/g, '/');
                            }
                            isMultiConfigGenerator = util.isMultiConfGeneratorFast(generator);
                            if (!isMultiConfigGenerator) {
                                cacheVariables['CMAKE_BUILD_TYPE'] = 'Debug';
                            }
                            newPreset = {
                                name: '__placeholder__',
                                displayName: chosen_kit.kit.name,
                                description: chosen_kit.description,
                                generator,
                                toolset: chosen_kit.kit.preferredGenerator?.toolset,
                                architecture: chosen_kit.kit.preferredGenerator?.platform,
                                binaryDir: '${sourceDir}/out/build/${presetName}',
                                cacheVariables
                            };
                        }
                    }
                    break;
                }
                case SpecialOptions.InheritConfigurationPreset: {
                    const placeHolder = localize('select.one.or.more.config.preset.placeholder', 'Select one or more configure presets');
                    const presets = preset.configurePresets(this.folderPath);
                    const inherits = await this.selectAnyPreset(presets, presets, { placeHolder, canPickMany: true });
                    newPreset = { name: '__placeholder__', description: '', displayName: '', inherits };
                    break;
                }
                case SpecialOptions.ToolchainFile: {
                    newPreset = {
                        name: '__placeholder__',
                        displayName: `Configure preset using toolchain file`,
                        description: 'Sets Ninja generator, build and install directory',
                        generator: 'Ninja',
                        binaryDir: '${sourceDir}/out/build/${presetName}',
                        cacheVariables: {
                            CMAKE_BUILD_TYPE: 'Debug',
                            CMAKE_TOOLCHAIN_FILE: '',
                            CMAKE_INSTALL_PREFIX: '${sourceDir}/out/install/${presetName}'
                        }
                    };
                    break;
                }
                case SpecialOptions.Custom: {
                    newPreset = {
                        name: '__placeholder__',
                        displayName: `Custom configure preset`,
                        description: 'Sets Ninja generator, build and install directory',
                        generator: 'Ninja',
                        binaryDir: '${sourceDir}/out/build/${presetName}',
                        cacheVariables: {
                            CMAKE_BUILD_TYPE: 'Debug',
                            CMAKE_INSTALL_PREFIX: '${sourceDir}/out/install/${presetName}'
                        }
                    };
                    break;
                }
                default:
                    // Shouldn't reach here
                    break;
            }

            if (newPreset) {

                const before: preset.ConfigurePreset[] = await this.getAllConfigurePresets();
                const name = await this.showNameInputBox() || newPreset.displayName || undefined;
                if (!name) {
                    return false;
                }
                newPreset.name = name;
                await this.addPresetAddUpdate(newPreset, 'configurePresets');

                // Ensure that we update our local copies of the PresetsFile so that adding the build preset happens as expected.
                await this.reapplyPresets();

                if (isMultiConfigGenerator) {
                    const buildPreset: preset.BuildPreset = {
                        name: `${newPreset.name}-debug`,
                        displayName: `${newPreset.displayName} - Debug`,
                        configurePreset: newPreset.name,
                        configuration: 'Debug'
                    };
                    await this.addPresetAddUpdate(buildPreset, 'buildPresets');
                }

                if (before.length === 0) {
                    log.debug(localize('user.selected.config.preset', 'User selected configure preset {0}', JSON.stringify(newPreset.name)));
                    await this.setConfigurePreset(newPreset.name);
                }
            }

            return true;
        }
    }

    private async handleNoConfigurePresets(): Promise<boolean> {
        const yes = localize('yes', 'Yes');
        const no = localize('no', 'No');
        const result = await vscode.window.showWarningMessage(
            localize('no.config.preset', 'No Configure Presets exist. Would you like to add a Configure Preset?'), yes, no);
        if (result === yes) {
            return this.addConfigurePreset();
        } else {
            log.error(localize('error.no.config.preset', 'No configure presets exist.'));
            return false;
        }

    }

    async addBuildPreset(): Promise<boolean> {
        if (preset.configurePresets(this.folderPath).length === 0) {
            return this.handleNoConfigurePresets();
        }

        interface AddPresetQuickPickItem extends vscode.QuickPickItem {
            name: string;
        }

        enum SpecialOptions {
            CreateFromConfigurationPreset = '__createFromConfigurationPreset__',
            InheritBuildPreset = '__inheritBuildPreset__',
            Custom = '__custom__'
        }

        const items: AddPresetQuickPickItem[] = [{
            name: SpecialOptions.CreateFromConfigurationPreset,
            label: localize('create.build.from.config.preset', 'Create from Configure Preset'),
            description: localize('description.create.build.from.config.preset', 'Create a new build preset')
        }];
        if (preset.buildPresets(this.folderPath).length > 0) {
            items.push({
                name: SpecialOptions.InheritBuildPreset,
                label: localize('inherit.build.preset', 'Inherit from Build Preset'),
                description: localize('description.inherit.build.preset', 'Inherit from an existing build preset')
            });
        }
        items.push({
            name: SpecialOptions.Custom,
            label: localize('custom.build.preset', 'Custom'),
            description: localize('description.custom.build.preset', 'Add an custom build preset')
        });

        const chosenItem = await vscode.window.showQuickPick(items,
            { placeHolder: localize('add.a.build.preset.placeholder', 'Add a build preset for {0}', this.folderName) });
        if (!chosenItem) {
            log.debug(localize('user.cancelled.add.build.preset', 'User cancelled adding build preset'));
            return false;
        } else {
            let newPreset: preset.BuildPreset | undefined;
            switch (chosenItem.name) {
                case SpecialOptions.CreateFromConfigurationPreset: {
                    const placeHolder = localize('select.a.config.preset.placeholder', 'Select a configure preset');
                    const presets = preset.configurePresets(this.folderPath);
                    const configurePreset = await this.selectNonHiddenPreset(presets, presets, { placeHolder });
                    newPreset = { name: '__placeholder__', description: '', displayName: '', configurePreset };
                    break;
                }
                case SpecialOptions.InheritBuildPreset: {
                    const placeHolder = localize('select.one.or.more.build.preset.placeholder', 'Select one or more build presets');
                    const presets = preset.buildPresets(this.folderPath);
                    const inherits = await this.selectAnyPreset(presets, presets, { placeHolder, canPickMany: true });
                    newPreset = { name: '__placeholder__', description: '', displayName: '', inherits };
                    break;
                }
                case SpecialOptions.Custom: {
                    newPreset = { name: '__placeholder__', description: '', displayName: '' };
                    break;
                }
                default:
                    break;
            }

            if (newPreset) {
                const name = await this.showNameInputBox();
                if (!name) {
                    return false;
                }

                newPreset.name = name;
                await this.addPresetAddUpdate(newPreset, 'buildPresets');
            }

            return true;
        }
    }

    async addTestPreset(): Promise<boolean> {
        if (preset.configurePresets(this.folderPath).length === 0) {
            return this.handleNoConfigurePresets();
        }

        interface AddPresetQuickPickItem extends vscode.QuickPickItem {
            name: string;
        }

        enum SpecialOptions {
            CreateFromConfigurationPreset = '__createFromConfigurationPreset__',
            InheritTestPreset = '__inheritTestPreset__',
            Custom = '__custom__'
        }

        const items: AddPresetQuickPickItem[] = [{
            name: SpecialOptions.CreateFromConfigurationPreset,
            label: localize('create.test.from.config.preset', 'Create from Configure Preset'),
            description: localize('description.create.test.from.config.preset', 'Create a new test preset')
        }];
        if (preset.testPresets(this.folderPath).length > 0) {
            items.push({
                name: SpecialOptions.InheritTestPreset,
                label: localize('inherit.test.preset', 'Inherit from Test Preset'),
                description: localize('description.inherit.test.preset', 'Inherit from an existing test preset')
            });
        }
        items.push({
            name: SpecialOptions.Custom,
            label: localize('custom.test.preset', 'Custom'),
            description: localize('description.custom.test.preset', 'Add an custom test preset')
        });

        const chosenItem = await vscode.window.showQuickPick(items,
            { placeHolder: localize('add.a.test.preset.placeholder', 'Add a test preset for {0}', this.folderName) });
        if (!chosenItem) {
            log.debug(localize('user.cancelled.add.test.preset', 'User cancelled adding test preset'));
            return false;
        } else {
            let newPreset: preset.TestPreset | undefined;
            switch (chosenItem.name) {
                case SpecialOptions.CreateFromConfigurationPreset: {
                    const placeHolder = localize('select.a.config.preset.placeholder', 'Select a configure preset');
                    const presets = preset.configurePresets(this.folderPath);
                    const configurePreset = await this.selectNonHiddenPreset(presets, presets, { placeHolder });
                    newPreset = { name: '__placeholder__', description: '', displayName: '', configurePreset };
                    break;
                }
                case SpecialOptions.InheritTestPreset: {
                    const placeHolder = localize('select.one.or.more.test.preset.placeholder', 'Select one or more test presets');
                    const presets = preset.testPresets(this.folderPath);
                    const inherits = await this.selectAnyPreset(presets, presets, { placeHolder, canPickMany: true });
                    newPreset = { name: '__placeholder__', description: '', displayName: '', inherits };
                    break;
                }
                case SpecialOptions.Custom: {
                    newPreset = { name: '__placeholder__', description: '', displayName: '' };
                    break;
                }
                default:
                    break;
            }

            if (newPreset) {
                const name = await this.showNameInputBox();
                if (!name) {
                    return false;
                }

                newPreset.name = name;
                await this.addPresetAddUpdate(newPreset, 'testPresets');
            }
            return true;
        }
    }

    async addPackagePreset(): Promise<boolean> {
        if (preset.configurePresets(this.folderPath).length === 0) {
            return this.handleNoConfigurePresets();
        }

        interface AddPresetQuickPickItem extends vscode.QuickPickItem {
            name: string;
        }

        enum SpecialOptions {
            CreateFromConfigurationPreset = '__createFromConfigurationPreset__',
            InheritPackagePreset = '__inheritPackagePreset__',
            Custom = '__custom__'
        }

        const items: AddPresetQuickPickItem[] = [{
            name: SpecialOptions.CreateFromConfigurationPreset,
            label: localize('create.package.from.config.preset', 'Create from Configure Preset'),
            description: localize('description.create.package.from.config.preset', 'Create a new package preset')
        }];
        if (preset.packagePresets(this.folderPath).length > 0) {
            items.push({
                name: SpecialOptions.InheritPackagePreset,
                label: localize('inherit.package.preset', 'Inherit from Package Preset'),
                description: localize('description.inherit.package.preset', 'Inherit from an existing package preset')
            });
        }
        items.push({
            name: SpecialOptions.Custom,
            label: localize('custom.package.preset', 'Custom'),
            description: localize('description.custom.package.preset', 'Add a custom package preset')
        });

        const chosenItem = await vscode.window.showQuickPick(items,
            { placeHolder: localize('add.a.package.preset.placeholder', 'Add a package preset for {0}', this.folderName) });
        if (!chosenItem) {
            log.debug(localize('user.cancelled.add.package.preset', 'User cancelled adding package preset'));
            return false;
        } else {
            let newPreset: preset.PackagePreset | undefined;
            switch (chosenItem.name) {
                case SpecialOptions.CreateFromConfigurationPreset: {
                    const placeHolder = localize('select.a.config.preset.placeholder', 'Select a configure preset');
                    const presets = preset.configurePresets(this.folderPath);
                    const configurePreset = await this.selectNonHiddenPreset(presets, presets, { placeHolder });
                    newPreset = { name: '__placeholder__', description: '', displayName: '', configurePreset };
                    break;
                }
                case SpecialOptions.InheritPackagePreset: {
                    const placeHolder = localize('select.one.or.more.package.preset.placeholder', 'Select one or more package presets');
                    const presets = preset.packagePresets(this.folderPath);
                    const inherits = await this.selectAnyPreset(presets, presets, { placeHolder, canPickMany: true });
                    newPreset = { name: '__placeholder__', description: '', displayName: '', inherits };
                    break;
                }
                case SpecialOptions.Custom: {
                    newPreset = { name: '__placeholder__', description: '', displayName: '' };
                    break;
                }
                default:
                    break;
            }

            if (newPreset) {
                const name = await this.showNameInputBox();
                if (!name) {
                    return false;
                }

                newPreset.name = name;
                await this.addPresetAddUpdate(newPreset, 'packagePresets');
            }
            return true;
        }
    }

    async addWorkflowPreset(): Promise<boolean> {
        if (preset.configurePresets(this.folderPath).length === 0) {
            return this.handleNoConfigurePresets();
        }

        interface AddPresetQuickPickItem extends vscode.QuickPickItem {
            name: string;
        }

        enum SpecialOptions {
            // Will create a new workflow preset only with the first step of "configure" type
            CreateFromConfigurationPreset = '__createFromConfigurationPreset__',
            // This is not the usual "inheritance" that applies to all other types of presets,
            // but only a convenient way of authoring a new preset from the content of another,
            // instead of a plain copy-paste in the presets file.
            // Also, inheritance can happen from multiple bases while this "create from" can start
            // from only one base.
            CreateFromWorkflowPreset = '__createFromWorkflowPreset__',
            Custom = '__custom__'
        }

        const items: AddPresetQuickPickItem[] = [{
            name: SpecialOptions.CreateFromConfigurationPreset,
            label: localize('create.workflow.from.config.preset', 'Create from Configure Preset'),
            description: localize('description.create.workflow.from.config.preset', 'Create a new workflow preset')
        }];
        if (preset.workflowPresets(this.folderPath).length > 0) {
            items.push({
                name: SpecialOptions.CreateFromWorkflowPreset,
                label: localize('create.workflow.preset', 'Create from Workflow Preset'),
                description: localize('description.create.test.preset', 'Create a new workflow preset from an existing workflow preset')
            });
        }
        items.push({
            name: SpecialOptions.Custom,
            label: localize('custom.workflow.preset', 'Custom'),
            description: localize('description.custom.workflow.preset', 'Add an custom workflow preset')
        });

        const chosenItem = await vscode.window.showQuickPick(items,
            { placeHolder: localize('add.a.workflow.preset.placeholder', 'Add a workflow preset for {0}', this.folderName) });
        if (!chosenItem) {
            log.debug(localize('user.cancelled.add.workflow.preset', 'User cancelled adding workflow preset'));
            return false;
        } else {
            let newPreset: preset.WorkflowPreset | undefined;
            switch (chosenItem.name) {
                case SpecialOptions.CreateFromConfigurationPreset: {
                    const placeHolder = localize('select.a.config.preset.placeholder', 'Select a configure preset');
                    const presets = preset.configurePresets(this.folderPath);
                    const configurePreset = await this.selectNonHiddenPreset(presets, presets, { placeHolder });
                    if (configurePreset) {
                        newPreset = { name: '__placeholder__', description: '', displayName: '',
                            steps: [{type: "configure", name: configurePreset}] };
                    }

                    break;
                }
                case SpecialOptions.CreateFromWorkflowPreset: {
                    const placeHolder = localize('select.one.workflow.preset.placeholder', 'Select one workflow base preset');
                    const presets = preset.workflowPresets(this.folderPath);
                    const workflowBasePresetName = await this.selectNonHiddenPreset(presets, presets, { placeHolder, canPickMany: false });
                    const workflowBasePreset = presets.find(pr => pr.name === workflowBasePresetName);
                    newPreset = { name: '__placeholder__', description: '', displayName: '', steps: workflowBasePreset?.steps || [{type: "configure", name: "_placeholder_"}] };
                    break;
                }
                case SpecialOptions.Custom: {
                    newPreset = { name: '__placeholder__', description: '', displayName: '', steps: [{type: "configure", name: "_placeholder_"}] };
                    break;
                }
                default:
                    break;
            }

            if (newPreset) {
                const name = await this.showNameInputBox();
                if (!name) {
                    return false;
                }

                newPreset.name = name;
                await this.addPresetAddUpdate(newPreset, 'workflowPresets');
            }
            return true;
        }
    }

    // Returns the name of preset selected from the list of non-hidden presets.
    private async selectNonHiddenPreset(candidates: preset.Preset[], allPresets: preset.Preset[], options: vscode.QuickPickOptions): Promise<string | undefined> {
        return this.selectPreset(candidates, allPresets, options, false);
    }
    // Returns the name of preset selected from the list of all hidden/non-hidden presets.
    private async selectAnyPreset(candidates: preset.Preset[], allPresets: preset.Preset[], options: vscode.QuickPickOptions & { canPickMany: true }): Promise<string[] | undefined> {
        return this.selectPreset(candidates, allPresets, options, true);
    }

    private async selectPreset(candidates: preset.Preset[], allPresets: preset.Preset[], options: vscode.QuickPickOptions & { canPickMany: true }, showHiddenPresets: boolean): Promise<string[] | undefined>;
    private async selectPreset(candidates: preset.Preset[], allPresets: preset.Preset[], options: vscode.QuickPickOptions, showHiddenPresets: boolean): Promise<string | undefined>;
    private async selectPreset(candidates: preset.Preset[], allPresets: preset.Preset[], options: vscode.QuickPickOptions, showHiddenPresets: boolean): Promise<string | string[] | undefined> {
        interface PresetItem extends vscode.QuickPickItem {
            preset: string;
        }
        const presetsPool: preset.Preset[] = showHiddenPresets ? candidates : candidates.filter(_preset => !_preset.hidden && preset.evaluatePresetCondition(_preset, allPresets));
        const items: PresetItem[] = presetsPool.map(
            _preset => ({
                label: _preset.displayName || _preset.name,
                description: _preset.description,
                preset: _preset.name
            })
        );
        items.push({
            label: localize('add.new.preset', 'Add a New Preset...'),
            preset: PresetsController._addPreset
        });
        const chosenPresets = await vscode.window.showQuickPick(items, options);
        if (util.isArray<PresetItem>(chosenPresets)) {
            return chosenPresets.map(_preset => _preset.preset);
        }
        return chosenPresets?.preset;
    }

    async getAllConfigurePresets(): Promise<preset.ConfigurePreset[]> {
        preset.expandVendorForConfigurePresets(this.folderPath);
        await preset.expandConditionsForPresets(this.folderPath, this._sourceDir);
        return preset.configurePresets(this.folderPath).concat(preset.userConfigurePresets(this.folderPath));
    }

    async selectConfigurePreset(quickStart?: boolean): Promise<boolean> {
        const allPresets: preset.ConfigurePreset[] = await this.getAllConfigurePresets();
        const presets = allPresets.filter(
            _preset => {
                const supportedHost = (_preset.vendor as preset.VendorVsSettings)?.['microsoft.com/VisualStudioSettings/CMake/1.0']?.hostOS;
                const osName = this.getOsName();
                if (supportedHost) {
                    if (util.isString(supportedHost)) {
                        return supportedHost === osName;
                    } else {
                        return supportedHost.includes(osName);
                    }
                } else {
                    return true;
                }
            }
        );

        log.debug(localize('start.selection.of.config.presets', 'Start selection of configure presets. Found {0} presets.', presets.length));

        log.debug(localize('opening.config.preset.selection', 'Opening configure preset selection QuickPick'));
        const placeHolder = localize('select.active.config.preset.placeholder', 'Select a configure preset for {0}', this.folderName);
        const chosenPreset = await this.selectNonHiddenPreset(presets, allPresets, { placeHolder });
        if (!chosenPreset) {
            log.debug(localize('user.cancelled.config.preset.selection', 'User cancelled configure preset selection'));
            return false;
        } else if (chosenPreset === this.project.configurePreset?.name) {
            return true;
        } else {
            const addPreset = chosenPreset === PresetsController._addPreset;
            if (addPreset) {
                await this.addConfigurePreset(quickStart);
            } else {
                log.debug(localize('user.selected.config.preset', 'User selected configure preset {0}', JSON.stringify(chosenPreset)));
                await this.setConfigurePreset(chosenPreset);
            }

            if (this.project.workspaceContext.config.automaticReconfigure) {
                await this.project.configureInternal(ConfigureTrigger.selectConfigurePreset, [], ConfigureType.Normal);
            }
            return !addPreset || allPresets.length === 0;
        }
    }

    async setConfigurePreset(presetName: string): Promise<void> {
        if (this._isChangingPresets) {
            log.error(localize('preset.change.in.progress', 'A preset change is already in progress.'));
            return;
        }

        this._isChangingPresets = true;

        // Load the configure preset into the backend
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: localize('loading.config.preset', 'Loading configure preset {0}', presetName)
            },
            () => this.project.setConfigurePreset(presetName)
        );

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: localize('reloading.build.test.preset', 'Reloading build and test presets')
            },
            async () => {
                const configurePreset = this.project.configurePreset?.name;
                const buildPreset = configurePreset ? this.project.workspaceContext.state.getBuildPresetName(this.project.folderName, configurePreset, this.isMultiProject) : undefined;
                const testPreset = configurePreset ? this.project.workspaceContext.state.getTestPresetName(this.project.folderName, configurePreset, this.isMultiProject) : undefined;
                const packagePreset = configurePreset ? this.project.workspaceContext.state.getPackagePresetName(this.project.folderName, configurePreset, this.isMultiProject) : undefined;
                const workflowPreset = configurePreset ? this.project.workspaceContext.state.getWorkflowPresetName(this.project.folderName, configurePreset, this.isMultiProject) : undefined;
                if (buildPreset) {
                    await this.setBuildPreset(buildPreset, true/*needToCheckConfigurePreset*/, false/*checkChangingPreset*/);
                }
                if (!buildPreset || !this.project.buildPreset) {
                    await this.guessBuildPreset();
                }

                if (testPreset) {
                    await this.setTestPreset(testPreset, true/*needToCheckConfigurePreset*/, false/*checkChangingPreset*/);
                }
                if (!testPreset || !this.project.testPreset) {
                    await this.guessTestPreset();
                }

                if (packagePreset) {
                    await this.setPackagePreset(packagePreset, true/*needToCheckConfigurePreset*/, false/*checkChangingPreset*/);
                }
                if (!packagePreset || !this.project.packagePreset) {
                    await this.guessPackagePreset();
                }

                if (workflowPreset) {
                    await this.setWorkflowPreset(workflowPreset, true/*needToCheckConfigurePreset*/, false/*checkChangingPreset*/);
                }
                if (!workflowPreset || !this.project.workflowPreset) {
                    await this.guessWorkflowPreset();
                }
            }
        );

        this._isChangingPresets = false;
    }

    private async guessBuildPreset(): Promise<void> {
        const selectedConfigurePreset = this.project.configurePreset?.name;
        let currentBuildPreset: string | undefined;
        if (selectedConfigurePreset) {
            preset.expandConfigurePresetForPresets(this.folderPath, 'build');
            const buildPresets = preset.allBuildPresets(this.folderPath);
            for (const buildPreset of buildPresets) {
                // Set active build preset as the first valid build preset matches the selected configure preset
                if (buildPreset.configurePreset === selectedConfigurePreset && !buildPreset.hidden) {
                    await this.setBuildPreset(buildPreset.name, false/*needToCheckConfigurePreset*/, false/*checkChangingPreset*/);
                    currentBuildPreset = this.project.buildPreset?.name;
                }
                if (currentBuildPreset) {
                    break;
                }
            }
        }

        if (!currentBuildPreset) {
            // No valid buid preset matches the selected configure preset
            await this.setBuildPreset(preset.defaultBuildPreset.name, false/*needToCheckConfigurePreset*/, false/*checkChangingPreset*/);
        }
    }

    private async guessTestPreset(): Promise<void> {
        const selectedConfigurePreset = this.project.configurePreset?.name;
        let currentTestPreset: string | undefined;
        if (selectedConfigurePreset) {
            preset.expandConfigurePresetForPresets(this.folderPath, 'test');
            const testPresets = preset.allTestPresets(this.folderPath);
            for (const testPreset of testPresets) {
                // Set active test preset as the first valid test preset matches the selected configure preset
                if (testPreset.configurePreset === selectedConfigurePreset && !testPreset.hidden) {
                    await this.setTestPreset(testPreset.name, false/*needToCheckConfigurePreset*/, false/*checkChangingPreset*/);
                    currentTestPreset = this.project.testPreset?.name;
                }
                if (currentTestPreset) {
                    break;
                }
            }
        }

        if (!currentTestPreset) {
            // No valid test preset matches the selected configure preset
            await this.setTestPreset(preset.defaultTestPreset.name, false/*needToCheckConfigurePreset*/, false/*checkChangingPreset*/);
        }
    }

    private async guessPackagePreset(): Promise<void> {
        const selectedConfigurePreset = this.project.configurePreset?.name;
        let currentPackagePreset: string | undefined;
        if (selectedConfigurePreset) {
            preset.expandConfigurePresetForPresets(this.folderPath, 'package');
            const packagePresets = preset.allPackagePresets(this.folderPath);
            for (const packagePreset of packagePresets) {
                // Set active package preset as the first valid package preset matches the selected configure preset
                if (packagePreset.configurePreset === selectedConfigurePreset && !packagePreset.hidden) {
                    await this.setPackagePreset(packagePreset.name, false/*needToCheckConfigurePreset*/, false/*checkChangingPreset*/);
                    currentPackagePreset = this.project.packagePreset?.name;
                }
                if (currentPackagePreset) {
                    break;
                }
            }
        }

        if (!currentPackagePreset) {
            // No valid buid preset matches the selected configure preset
            await this.setPackagePreset(preset.defaultPackagePreset.name, false/*needToCheckConfigurePreset*/, false/*checkChangingPreset*/);
        }
    }

    private async guessWorkflowPreset(): Promise<void> {
        const selectedConfigurePreset = this.project.configurePreset?.name;
        let currentWorkflowPreset: string | undefined;
        if (selectedConfigurePreset) {
            preset.expandConfigurePresetForPresets(this.folderPath, 'workflow');
            const workflowPresets = preset.allWorkflowPresets(this.folderPath);
            for (const workflowPreset of workflowPresets) {
                // Set active workflow preset as the first valid workflow preset (matching the selected configure preset is not a requirement as for the other presets types)
                if (!workflowPreset.hidden) {
                    await this.setWorkflowPreset(workflowPreset.name, false/*needToCheckConfigurePreset*/, false/*checkChangingPreset*/);
                    currentWorkflowPreset = this.project.workflowPreset?.name;
                }
                if (currentWorkflowPreset) {
                    break;
                }
            }
        }

        if (!currentWorkflowPreset) {
            // No valid workflow preset matches the selected configure preset
            await this.setWorkflowPreset(preset.defaultWorkflowPreset.name, false/*needToCheckConfigurePreset*/, false/*checkChangingPreset*/);
        }
    }

    private async checkConfigurePreset(): Promise<preset.ConfigurePreset | null> {
        const selectedConfigurePreset = this.project.configurePreset;
        if (!selectedConfigurePreset) {
            const message_noConfigurePreset = localize('config.preset.required', 'A configure preset needs to be selected. How would you like to proceed?');
            const option_selectConfigurePreset = localize('select.config.preset', 'Select Configure Preset');
            const option_later = localize('later', 'Later');
            const result = await vscode.window.showErrorMessage(message_noConfigurePreset, option_selectConfigurePreset, option_later);
            if (result === option_selectConfigurePreset && await vscode.commands.executeCommand('cmake.selectConfigurePreset')) {
                return this.project.configurePreset;
            }
        }
        return selectedConfigurePreset;
    }

    private async checkBuildPreset(): Promise<preset.BuildPreset | null> {
        const selectedBuildPreset = this.project.buildPreset;
        if (!selectedBuildPreset) {
            const message_noBuildPreset = localize('build.preset.required', 'A build preset needs to be selected. How would you like to proceed?');
            const option_selectBuildPreset = localize('select.build.preset', 'Select build preset');
            const option_later = localize('later', 'later');
            const result = await vscode.window.showErrorMessage(message_noBuildPreset, option_selectBuildPreset, option_later);
            if (result === option_selectBuildPreset && await vscode.commands.executeCommand('cmake.selectBuildPreset')) {
                return this.project.buildPreset;
            }
        }
        return selectedBuildPreset;
    }

    async selectBuildPreset(): Promise<boolean> {
        // configure preset required
        const selectedConfigurePreset = await this.checkConfigurePreset();
        if (!selectedConfigurePreset) {
            return false;
        }

        preset.expandConfigurePresetForPresets(this.folderPath, 'build');
        await preset.expandConditionsForPresets(this.folderPath, this._sourceDir);

        const allPresets = preset.buildPresets(this.folderPath).concat(preset.userBuildPresets(this.folderPath));
        const presets = allPresets.filter(_preset => this.checkCompatibility(selectedConfigurePreset, _preset).buildPresetCompatible);
        presets.push(preset.defaultBuildPreset);

        log.debug(localize('start.selection.of.build.presets', 'Start selection of build presets. Found {0} presets.', presets.length));

        log.debug(localize('opening.build.preset.selection', 'Opening build preset selection QuickPick'));
        const placeHolder = localize('select.active.build.preset.placeholder', 'Select a build preset for {0}', this.folderName);
        const chosenPreset = await this.selectNonHiddenPreset(presets, allPresets, { placeHolder });
        if (!chosenPreset) {
            log.debug(localize('user.cancelled.build.preset.selection', 'User cancelled build preset selection'));
            return false;
        } else if (chosenPreset === this.project.buildPreset?.name) {
            return true;
        } else if (chosenPreset === '__addPreset__') {
            await this.addBuildPreset();
            return false;
        } else {
            log.debug(localize('user.selected.build.preset', 'User selected build preset {0}', JSON.stringify(chosenPreset)));
            await this.setBuildPreset(chosenPreset, false);
            return true;
        }
    }

    async setBuildPreset(presetName: string, needToCheckConfigurePreset: boolean = true, checkChangingPreset: boolean = true): Promise<void> {
        if (checkChangingPreset) {
            if (this._isChangingPresets) {
                return;
            }
            this._isChangingPresets = true;
        }

        if (needToCheckConfigurePreset && presetName !== preset.defaultBuildPreset.name) {
            preset.expandConfigurePresetForPresets(this.folderPath, 'build');
            const _preset = preset.getPresetByName(preset.allBuildPresets(this.folderPath), presetName);
            const compatibility = this.checkCompatibility(this.project.configurePreset, _preset, this.project.testPreset, this.project.packagePreset, this.project.workflowPreset);
            if (!compatibility.buildPresetCompatible) {
                log.warning(localize('build.preset.configure.preset.not.match', 'Build preset {0}: The configure preset does not match the active configure preset', presetName));
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: localize('unloading.build.preset', 'Unloading build preset')
                    },
                    () => this.project.setBuildPreset(null)
                );

                if (checkChangingPreset) {
                    this._isChangingPresets = false;
                }

                return;
            }
            if (!compatibility.testPresetCompatible) {
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: localize('unloading.test.preset', 'Unloading test preset')
                    },
                    () => this.project.setTestPreset(null)
                );
                // Not sure we need to do the same for package/workflow build
            }
        }
        // Load the build preset into the backend
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: localize('loading.build.preset', 'Loading build preset {0}', presetName)
            },
            () => this.project.setBuildPreset(presetName)
        );

        if (checkChangingPreset) {
            this._isChangingPresets = false;
        }
    }

    private checkCompatibility(configurePreset: preset.ConfigurePreset | null, buildPreset?: preset.BuildPreset | null, testPreset?: preset.TestPreset | null, packagePreset?: preset.PackagePreset | null, workflowPreset?: preset.WorkflowPreset | null):
    {buildPresetCompatible: boolean; testPresetCompatible: boolean; packagePresetCompatible: boolean; workflowPresetCompatible: boolean} {
        let testPresetCompatible = true;
        let buildPresetCompatible = true;
        let packagePresetCompatible = true;
        let workflowPresetCompatible = true;

        // We only check compatibility when we are setting the build, test, package or workflow preset.
        // Except for workflow presets, we need to exclude the hidden presets.
        if (testPreset) {
            if (testPreset.hidden) {
                testPresetCompatible = false;
            } else {
                const configMatches = testPreset.configurePreset === configurePreset?.name;
                let buildTypeMatches = buildPreset?.configuration === testPreset.configuration;
                if (!buildTypeMatches) {
                    if (util.isMultiConfGeneratorFast(configurePreset?.generator)) {
                        const buildType = buildPreset?.configuration || configurePreset?.cacheVariables?.['CMAKE_CONFIGURATION_TYPES']?.toString().split(';')?.[0] || 'Debug';
                        buildTypeMatches = testPreset.configuration === buildType || testPreset.configuration === undefined;
                    } else {
                        const buildType = configurePreset?.cacheVariables?.['CMAKE_BUILD_TYPE'] || 'Debug';
                        buildTypeMatches = buildPreset === undefined || testPreset.configuration === buildType || testPreset.configuration === undefined;
                    }
                }
                testPresetCompatible = configMatches && buildTypeMatches;
            }
        }

        if (buildPreset) {
            buildPresetCompatible = (configurePreset?.name === buildPreset.configurePreset) && !buildPreset.hidden;
        }

        if (packagePreset) {
            packagePresetCompatible = (configurePreset?.name === packagePreset.configurePreset) && !packagePreset.hidden;
            // we might need build type matches here as well as test preset checks, also in other places where I ommitted because I thought is not needed
        }

        // For a workflow preset, the step0 configure may be different than the current configure of the project,
        // but all the workflow steps that follow should have the same configure preset as the one mentioned in step0.
        if (workflowPreset) {
            const temp = workflowPreset.steps.find(st => {
                let stepConfigurePreset: string | undefined;
                switch (st.type) {
                    case "configure":
                        stepConfigurePreset = preset.getPresetByName(preset.allConfigurePresets(this.folderPath), st.name)?.name;
                        break;
                    case "build":
                        stepConfigurePreset = preset.getPresetByName(preset.allBuildPresets(this.folderPath), st.name)?.configurePreset;
                        break;
                    case "test":
                        stepConfigurePreset = preset.getPresetByName(preset.allTestPresets(this.folderPath), st.name)?.configurePreset;
                        break;
                    case "package":
                        stepConfigurePreset = preset.getPresetByName(preset.allPackagePresets(this.folderPath), st.name)?.configurePreset;
                        break;
                }

                if (stepConfigurePreset !== workflowPreset.steps[0].name) {
                    return true;
                }
            });

            workflowPresetCompatible = (temp === undefined);
        }

        return {buildPresetCompatible, testPresetCompatible, packagePresetCompatible, workflowPresetCompatible};
    }

    async selectTestPreset(): Promise<boolean> {
        // configure preset required
        const selectedConfigurePreset = await this.checkConfigurePreset();
        if (!selectedConfigurePreset) {
            return false;
        }
        const selectedBuildPreset = await this.checkBuildPreset();
        if (!selectedBuildPreset) {
            return false;
        }

        preset.expandConfigurePresetForPresets(this.folderPath, 'test');
        await preset.expandConditionsForPresets(this.folderPath, this._sourceDir);

        const allPresets = preset.testPresets(this.folderPath).concat(preset.userTestPresets(this.folderPath));
        const presets = allPresets.filter(_preset => this.checkCompatibility(selectedConfigurePreset, selectedBuildPreset, _preset).testPresetCompatible);
        presets.push(preset.defaultTestPreset);

        log.debug(localize('start.selection.of.test.presets', 'Start selection of test presets. Found {0} presets.', presets.length));
        const placeHolder = localize('select.active.test.preset.placeholder', 'Select a test preset for {0}', this.folderName);
        const chosenPreset = await this.selectNonHiddenPreset(presets, allPresets, { placeHolder });
        if (!chosenPreset) {
            log.debug(localize('user.cancelled.test.preset.selection', 'User cancelled test preset selection'));
            return false;
        } else if (chosenPreset === this.project.testPreset?.name) {
            return true;
        } else if (chosenPreset === '__addPreset__') {
            await this.addTestPreset();
            return false;
        } else {
            log.debug(localize('user.selected.test.preset', 'User selected test preset {0}', JSON.stringify(chosenPreset)));
            await this.setTestPreset(chosenPreset, false);
            await vscode.commands.executeCommand('cmake.refreshTests', this.workspaceFolder);
            return true;
        }
    }

    async setTestPreset(presetName: string | null, needToCheckConfigurePreset: boolean = true, checkChangingPreset: boolean = true): Promise<void> {
        if (presetName) {
            if (checkChangingPreset) {
                if (this._isChangingPresets) {
                    return;
                }
                this._isChangingPresets = true;
            }

            if (needToCheckConfigurePreset && presetName !== preset.defaultTestPreset.name) {
                preset.expandConfigurePresetForPresets(this.folderPath, 'test');
                const _preset = preset.getPresetByName(preset.allTestPresets(this.folderPath), presetName);
                const compatibility = this.checkCompatibility(this.project.configurePreset, this.project.buildPreset, _preset);
                if (!compatibility.testPresetCompatible) {
                    log.warning(localize('test.preset.configure.preset.not.match', 'Test preset {0} is not compatible with the active configure or build presets', `'${presetName}'`));
                    await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: localize('unloading.test.preset', 'Unloading test preset')
                        },
                        () => this.project.setTestPreset(null)
                    );

                    if (checkChangingPreset) {
                        this._isChangingPresets = false;
                    }

                    return;
                }
            }
            // Load the test preset into the backend
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: localize('loading.test.preset', 'Loading test preset {0}', presetName)
                },
                () => this.project.setTestPreset(presetName)
            );

            if (checkChangingPreset) {
                this._isChangingPresets = false;
            }
        } else {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: localize('unloading.test.preset', 'Unloading test preset.')
                },
                () => this.project.setTestPreset(null)
            );
        }
    }

    //----
    async selectPackagePreset(): Promise<boolean> {
        // configure preset required
        const selectedConfigurePreset = await this.checkConfigurePreset();
        if (!selectedConfigurePreset) {
            return false;
        }

        // Do we need this check for package preset?
        const selectedBuildPreset = await this.checkBuildPreset();
        if (!selectedBuildPreset) {
            return false;
        }

        preset.expandConfigurePresetForPresets(this.folderPath, 'package');
        await preset.expandConditionsForPresets(this.folderPath, this._sourceDir);

        const allPresets = preset.packagePresets(this.folderPath).concat(preset.userPackagePresets(this.folderPath));
        const presets = allPresets.filter(_preset => this.checkCompatibility(selectedConfigurePreset, selectedBuildPreset, this.project.testPreset, _preset).packagePresetCompatible);
        presets.push(preset.defaultPackagePreset);

        log.debug(localize('start.selection.of.package.presets', 'Start selection of package presets. Found {0} presets.', presets.length));
        const placeHolder = localize('select.active.package.preset.placeholder', 'Select a package preset for {0}', this.folderName);
        const chosenPreset = await this.selectNonHiddenPreset(presets, allPresets, { placeHolder });
        if (!chosenPreset) {
            log.debug(localize('user.cancelled.package.preset.selection', 'User cancelled package preset selection'));
            return false;
        } else if (chosenPreset === this.project.packagePreset?.name) {
            return true;
        } else if (chosenPreset === '__addPreset__') {
            await this.addPackagePreset();
            return false;
        } else {
            log.debug(localize('user.selected.package.preset', 'User selected package preset {0}', JSON.stringify(chosenPreset)));
            await this.setPackagePreset(chosenPreset, false);
            return true;
        }
    }

    async setPackagePreset(presetName: string | null, needToCheckConfigurePreset: boolean = true, checkChangingPreset: boolean = true): Promise<void> {
        if (presetName) {
            if (checkChangingPreset) {
                if (this._isChangingPresets) {
                    return;
                }
                this._isChangingPresets = true;
            }

            if (needToCheckConfigurePreset && presetName !== preset.defaultPackagePreset.name) {
                preset.expandConfigurePresetForPresets(this.folderPath, 'package');
                const _preset = preset.getPresetByName(preset.allPackagePresets(this.folderPath), presetName);
                const compatibility = this.checkCompatibility(this.project.configurePreset, this.project.buildPreset, this.project.testPreset, _preset);
                if (!compatibility.packagePresetCompatible) {
                    log.warning(localize('package.preset.configure.preset.not.match', 'Package preset {0} is not compatible with the active configure or build presets', `'${presetName}'`));
                    await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: localize('unloading.package.preset', 'Unloading package preset')
                        },
                        () => this.project.setPackagePreset(null)
                    );

                    if (checkChangingPreset) {
                        this._isChangingPresets = false;
                    }

                    return;
                }
            }
            // Load the package preset into the backend
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: localize('loading.package.preset', 'Loading package preset {0}', presetName)
                },
                () => this.project.setPackagePreset(presetName)
            );

            if (checkChangingPreset) {
                this._isChangingPresets = false;
            }
        } else {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: localize('unloading.package.preset', 'Unloading package preset.')
                },
                () => this.project.setPackagePreset(null)
            );
        }
    }

    async selectWorkflowPreset(): Promise<boolean> {
        // No configure nor build preset compatibility requirement.
        // The only consistency workflows need are the steps to be associated with the same configure preset,
        // which to be the same as in step0. This is verified by CMakePresets.json validation in validatePresetsFile.

        preset.expandConfigurePresetForPresets(this.folderPath, 'workflow');
        await preset.expandConditionsForPresets(this.folderPath, this._sourceDir);

        const allPresets = preset.workflowPresets(this.folderPath).concat(preset.userWorkflowPresets(this.folderPath));
        allPresets.push(preset.defaultWorkflowPreset);

        log.debug(localize('start.selection.of.workflow.presets', 'Start selection of workflow presets. Found {0} presets.', allPresets.length));
        const placeHolder = localize('select.active.workflow.preset.placeholder', 'Select a workflow preset for {0}', this.folderName);
        const chosenPreset = await this.selectNonHiddenPreset(allPresets, allPresets, { placeHolder });
        if (!chosenPreset) {
            log.debug(localize('user.cancelled.workflow.preset.selection', 'User cancelled workflow preset selection'));
            return false;
        } else if (chosenPreset === this.project.workflowPreset?.name) {
            return true;
        } else if (chosenPreset === '__addPreset__') {
            await this.addWorkflowPreset();
            return false;
        } else {
            log.debug(localize('user.selected.workflow.preset', 'User selected workflow preset {0}', JSON.stringify(chosenPreset)));
            await this.setWorkflowPreset(chosenPreset, false);
            return true;
        }
    }

    async setWorkflowPreset(presetName: string | null, needToCheckConfigurePreset: boolean = true, checkChangingPreset: boolean = true): Promise<void> {
        if (presetName) {
            if (checkChangingPreset) {
                if (this._isChangingPresets) {
                    return;
                }
                this._isChangingPresets = true;
            }

            if (needToCheckConfigurePreset && presetName !== preset.defaultWorkflowPreset.name) {
                preset.expandConfigurePresetForPresets(this.folderPath, 'workflow');
                const _preset = preset.getPresetByName(preset.allWorkflowPresets(this.folderPath), presetName);
                const compatibility = this.checkCompatibility(this.project.configurePreset, this.project.buildPreset, this.project.testPreset, this.project.packagePreset, _preset);
                if (!compatibility.workflowPresetCompatible) {
                    log.warning(localize('workflow.preset.configure.preset.not.match', 'The configure preset of the workflow preset {0} is not compatible with the configure preset of some of the workflow steps', `'${presetName}'`));
                    await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: localize('unloading.workflow.preset', 'Unloading workflow preset')
                        },
                        () => this.project.setWorkflowPreset(null)
                    );

                    if (checkChangingPreset) {
                        this._isChangingPresets = false;
                    }

                    return;
                }
            }
            // Load the workflow preset into the backend
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: localize('loading.workflow.preset', 'Loading workflow preset {0}', presetName)
                },
                () => this.project.setWorkflowPreset(presetName)
            );

            if (checkChangingPreset) {
                this._isChangingPresets = false;
            }
        } else {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: localize('unloading.workflow.preset', 'Unloading workflow preset.')
                },
                () => this.project.setWorkflowPreset(null)
            );
        }
    }
    //-----
    async openCMakePresets(): Promise<vscode.TextEditor | undefined> {
        if (!await fs.exists(this.presetsPath)) {
            return this.updatePresetsFile({ version: 8 });
        } else {
            return vscode.window.showTextDocument(vscode.Uri.file(this.presetsPath));
        }
    }

    async openCMakeUserPresets(): Promise<vscode.TextEditor | undefined> {
        if (!await fs.exists(this.userPresetsPath)) {
            return this.updatePresetsFile({ version: 8 }, true);
        } else {
            return vscode.window.showTextDocument(vscode.Uri.file(this.userPresetsPath));
        }
    }

    private async readPresetsFile(file: string): Promise<Buffer | undefined> {
        if (!await fs.exists(file)) {
            return undefined;
        }
        log.debug(localize('reading.presets.file', 'Reading presets file {0}', file));
        return fs.readFile(file);
    }

    private async parsePresetsFile(fileContent: Buffer | undefined, file: string): Promise<preset.PresetsFile | undefined> {
        if (!fileContent) {
            return undefined;
        }

        let presetsFile: preset.PresetsFile;
        try {
            if (this.project.workspaceContext.config.allowCommentsInPresetsFile) {
                presetsFile = json5.parse(fileContent.toLocaleString());
            } else {
                presetsFile = JSON.parse(fileContent.toLocaleString());
            }
        } catch (e) {
            log.error(localize('failed.to.parse', 'Failed to parse {0}: {1}', path.basename(file), util.errorToString(e)));
            return undefined;
        }
        return presetsFile;
    }

    private populatePrivatePresetsFields(presetsFile: preset.PresetsFile | undefined, file: string) {
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

    private async mergeIncludeFiles(rootPresetsFile: preset.PresetsFile | undefined, presetsFile: preset.PresetsFile | undefined, file: string, referencedFiles: Set<string>): Promise<void> {
        if (!rootPresetsFile || !presetsFile || !presetsFile.include) {
            return;
        }

        // Merge the includes in reverse order so that the final presets order is correct
        for (let i = presetsFile.include.length - 1; i >= 0; i--) {
            const rawInclude = presetsFile.include[i];
            const includePath = presetsFile.version >= 7 ?
                // Version 7 and later support $penv{} expansions in include paths
                substituteAll(rawInclude, getParentEnvSubstitutions(rawInclude, new Map<string, string>())).result :
                rawInclude;
            const fullIncludePath = path.normalize(path.resolve(path.dirname(file), includePath));

            // Do not include files more than once
            if (referencedFiles.has(fullIncludePath)) {
                continue;
            }
            // Record the file as referenced, even if the file does not exist.
            referencedFiles.add(fullIncludePath);

            const includeFileBuffer = await this.readPresetsFile(fullIncludePath);
            if (!includeFileBuffer) {
                log.error(localize('included.presets.file.not.found', 'Included presets file {0} cannot be found', fullIncludePath));
                continue;
            }

            let includeFile = await this.parsePresetsFile(includeFileBuffer, fullIncludePath);
            includeFile = await this.validatePresetsFile(includeFile, fullIncludePath);
            if (!includeFile) {
                continue;
            }

            // Private fields must be set after validation, otherwise validation would fail.
            this.populatePrivatePresetsFields(includeFile, fullIncludePath);

            if (includeFile.cmakeMinimumRequired) {
                if (!rootPresetsFile.cmakeMinimumRequired || util.versionLess(rootPresetsFile.cmakeMinimumRequired, includeFile.cmakeMinimumRequired)) {
                    rootPresetsFile.cmakeMinimumRequired = includeFile.cmakeMinimumRequired;
                }
            }
            if (includeFile.configurePresets) {
                rootPresetsFile.configurePresets = includeFile.configurePresets.concat(rootPresetsFile.configurePresets || []);
            }
            if (includeFile.buildPresets) {
                rootPresetsFile.buildPresets = includeFile.buildPresets.concat(rootPresetsFile.buildPresets || []);
            }
            if (includeFile.testPresets) {
                rootPresetsFile.testPresets = includeFile.testPresets.concat(rootPresetsFile.testPresets || []);
            }
            if (includeFile.packagePresets) {
                rootPresetsFile.packagePresets = includeFile.packagePresets.concat(rootPresetsFile.packagePresets || []);
            }
            if (includeFile.workflowPresets) {
                rootPresetsFile.workflowPresets = includeFile.workflowPresets.concat(rootPresetsFile.workflowPresets || []);
            }

            // Recursively merge included files
            await this.mergeIncludeFiles(rootPresetsFile, includeFile, fullIncludePath, referencedFiles);
        }
    }

    private async validatePresetsFile(presetsFile: preset.PresetsFile | undefined, file: string) {
        if (!presetsFile) {
            return undefined;
        }

        log.info(localize('validating.presets.file', 'Reading and validating the presets "file {0}"', file));
        let schemaFile;
        const maxSupportedVersion = 8;
        const validationErrorsAreWarnings = presetsFile.version > maxSupportedVersion && this.project.workspaceContext.config.allowUnsupportedPresetsVersions;
        if (presetsFile.version < 2) {
            await this.showPresetsFileVersionError(file);
            return undefined;
        } else if (presetsFile.version === 2) {
            schemaFile = './schemas/CMakePresets-schema.json';
        } else if (presetsFile.version === 3) {
            schemaFile = './schemas/CMakePresets-v3-schema.json';
        } else if (presetsFile.version === 4) {
            schemaFile = './schemas/CMakePresets-v4-schema.json';
        } else if (presetsFile.version === 5) {
            schemaFile = './schemas/CMakePresets-v5-schema.json';
        } else if (presetsFile.version === 6) {
            schemaFile = './schemas/CMakePresets-v6-schema.json';
        } else if (presetsFile.version === 7) {
            schemaFile = './schemas/CMakePresets-v7-schema.json';
        } else {
            schemaFile = './schemas/CMakePresets-v8-schema.json';
        }

        const validator = await loadSchema(schemaFile);
        const is_valid = validator(presetsFile);
        if (!is_valid) {
            const showErrors = (logFunc: (x: string) => void) => {
                const errors = validator.errors!;
                logFunc(localize('unsupported.presets', 'Unsupported presets detected in {0}. Support is limited to features defined by version {1}.', file, maxSupportedVersion));
                for (const err of errors) {
                    if (err.params && 'additionalProperty' in err.params) {
                        logFunc(` >> ${err.dataPath}: ${err.message}: ${err.params.additionalProperty}`);
                    } else {
                        logFunc(` >> ${err.dataPath}: ${err.message}`);
                    }
                }
            };
            if (validationErrorsAreWarnings) {
                showErrors(x => log.warning(x));
                return presetsFile;
            } else {
                showErrors(x => log.error(x));
                log.error(localize('unsupported.presets.disable', 'Unknown properties and macros can be ignored by using the {0} setting.', "'cmake.allowUnsupportedPresetsVersions'"));
                return undefined;
            }
        }

        for (const pr of presetsFile?.buildPresets || []) {
            const dupe = presetsFile?.buildPresets?.find(p => (pr.name === p.name && p !== pr));
            if (dupe) {
                log.error(localize('duplicate.build.preset.found', 'Found duplicates within the build presets collection: "{0}"', pr.name));
                return undefined;
            }
        }

        for (const pr of presetsFile?.testPresets || []) {
            const dupe = presetsFile?.testPresets?.find(p => (pr.name === p.name && p !== pr));
            if (dupe) {
                log.error(localize('duplicate.test.preset.found', 'Found duplicates within the test presets collection: "{0}"', pr.name));
                return undefined;
            }
        }

        for (const pr of presetsFile?.packagePresets || []) {
            const dupe = presetsFile?.packagePresets?.find(p => (pr.name === p.name && p !== pr));
            if (dupe) {
                log.error(localize('duplicate.package.preset.found', 'Found duplicates within the package presets collection: "{0}"', pr.name));
                return undefined;
            }
        }

        for (const pr of presetsFile?.workflowPresets || []) {
            const dupe = presetsFile?.workflowPresets?.find(p => (pr.name === p.name && p !== pr));
            if (dupe) {
                log.error(localize('duplicate.workflow.preset.found', 'Found duplicates within the workflow presets collection: "{0}"', pr.name));
                return undefined;
            }
        }

        for (const pr of presetsFile.workflowPresets || []) {
            if (pr.steps.length < 1 || pr.steps[0].type !== "configure") {
                log.error(localize('workflow.does.not.start.configure.step', 'The workflow preset "{0}" does not start with a configure step.', pr.name));
                return undefined;
            }

            for (const step of pr.steps) {
                if (step.type === "configure" && step !== pr.steps[0]) {
                    log.error(localize('workflow.has.subsequent.configure.preset', 'The workflow preset "{0}" has another configure preset "{1}" besides the first step "{2}": ', pr.name, step.name, pr.steps[0].name));
                    return undefined;
                }
            }
        }

        log.info(localize('successfully.validated.presets', 'Successfully validated presets in {0}', file));
        return presetsFile;
    }

    private async showPresetsFileVersionError(file: string): Promise<void> {
        const useKitsVars = localize('use.kits.variants', 'Use kits and variants');
        const changePresets = localize('edit.presets', 'Locate');
        const result = await vscode.window.showErrorMessage(
            localize('presets.version.error', 'CMakePresets version 1 is not supported. How would you like to proceed?'),
            useKitsVars, changePresets);
        if (result === useKitsVars) {
            void vscode.workspace.getConfiguration('cmake', this.workspaceFolder.uri).update('useCMakePresets', 'never');
        } else {
            await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        }
    }

    // Note: in case anyone want to change this, presetType must match the corresponding key in presets.json files
    async addPresetAddUpdate(newPreset: preset.ConfigurePreset | preset.BuildPreset | preset.TestPreset | preset.PackagePreset | preset.WorkflowPreset,
        presetType: 'configurePresets' | 'buildPresets' | 'testPresets' | 'packagePresets' | 'workflowPresets') {
        const originalPresetsFile: preset.PresetsFile = preset.getOriginalPresetsFile(this.folderPath) || { version: 8 };
        if (!originalPresetsFile[presetType]) {
            originalPresetsFile[presetType] = [];
        }

        switch (presetType) {
            case "configurePresets":
            case "buildPresets":
            case "testPresets":
            case "packagePresets":
                originalPresetsFile[presetType]!.push(newPreset);
                break;
            case "workflowPresets":
                originalPresetsFile[presetType]!.push(newPreset as preset.WorkflowPreset);
                break;
        }

        await this.updatePresetsFile(originalPresetsFile);
    }

    private getIndentationSettings() {
        const config = vscode.workspace.getConfiguration('editor', this.workspaceFolder.uri);
        let tabSize = config.get<number>('tabSize');
        tabSize = (tabSize === undefined) ? 4 : tabSize;
        let insertSpaces = config.get<boolean>('insertSpaces');
        insertSpaces = (insertSpaces === undefined) ? true : insertSpaces;
        return { insertSpaces, tabSize };
    }

    async updatePresetsFile(presetsFile: preset.PresetsFile, isUserPresets = false): Promise<vscode.TextEditor | undefined> {
        const presetsFilePath = isUserPresets ? this.userPresetsPath : this.presetsPath;
        const indent = this.getIndentationSettings();
        try {
            await fs.writeFile(presetsFilePath, JSON.stringify(presetsFile, null, indent.insertSpaces ? indent.tabSize : '\t'));
        } catch (e: any) {
            rollbar.exception(localize('failed.writing.to.file', 'Failed writing to file {0}', presetsFilePath), e);
            return;
        }

        return vscode.window.showTextDocument(vscode.Uri.file(presetsFilePath));
    }

    private async watchPresetsChange() {
        if (this._presetsWatcher) {
            this._presetsWatcher.close().then(() => {}, () => {});
        }

        const handler = () => {
            void this.reapplyPresets();
        };
        this._presetsWatcher = chokidar.watch(this._referencedFiles, { ignoreInitial: true })
            .on('add', handler)
            .on('change', handler)
            .on('unlink', handler);
    };

    dispose() {
        if (this._presetsWatcher) {
            this._presetsWatcher.close().then(() => {}, () => {});
        }
        if (this._sourceDirChangedSub) {
            this._sourceDirChangedSub.dispose();
        }
    }
}
