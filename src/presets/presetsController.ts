import * as chokidar from 'chokidar';
import * as path from 'path';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';

import { CMakeProject, ConfigureTrigger, ConfigureType } from '@cmt/cmakeProject';
import * as logging from '@cmt/logging';
import { fs } from '@cmt/pr';
import * as preset from '@cmt/presets/preset';
import { PresetsParser } from '@cmt/presets/presetsParser';
import * as util from '@cmt/util';
import rollbar from '@cmt/rollbar';
import { ExpansionErrorHandler, ExpansionOptions } from '@cmt/expand';
import paths from '@cmt/paths';
import { KitsController } from '@cmt/kits/kitsController';
import { descriptionForKit, Kit, SpecialKits } from '@cmt/kits/kit';
import { getHostTargetArchString } from '@cmt/installs/visualStudio';
import { Diagnostic, DiagnosticSeverity, Position, Range } from 'vscode';
import collections from '@cmt/diagnostics/collections';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('presetController');

export class PresetsController implements vscode.Disposable {
    private _presetsWatchers: FileWatcher | undefined;
    private _sourceDirChangedSub: vscode.Disposable | undefined;
    private _isChangingPresets = false;
    private _referencedFiles: string[] = [];
    private _presetsParser!: PresetsParser; // Using definite assigment (!) because we initialize it in the init method

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

        presetsController._presetsParser = new PresetsParser(project.folderPath, await expandSourceDir(project.sourceDir), project.workspaceFolder.uri.fsPath, presetsController.reportPresetsFileErrors, presetsController.showPresetsFileVersionError, (filePath: string) => {
            collections.presets.set(
                vscode.Uri.file(filePath),
                undefined
            );
        }, presetsController._presetsChangedEmitter.fire, presetsController._userPresetsChangedEmitter.fire);

        // We explicitly read presets file here, instead of on the initialization of the file watcher. Otherwise
        // there might be timing issues, since listeners are invoked async.
        await presetsController.reapplyPresets();

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

        // We need to reapply presets to reassess whether the VS Developer Environment should be used.
        project.workspaceContext.config.onChange('useVsDeveloperEnvironment', async () => {
            await presetsController.reapplyPresets();
        });

        return presetsController;
    }

    private constructor(private readonly project: CMakeProject, private readonly _kitsController: KitsController, private isMultiProject: boolean) {}

    get presetsPath() {
        return this._presetsParser.presetsPath;
    }

    get userPresetsPath() {
        return this._presetsParser.userPresetsPath;
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
        return this._presetsParser.presetsFileExists;
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

    // Need to reapply presets every time presets changed since the binary dir or cmake path could change
    // (need to clean or reload driver)
    async reapplyPresets() {
        const referencedFiles: Map<string, preset.PresetsFile | undefined> =
            new Map();

        // Reset all changes due to expansion since parents could change
        await this._presetsParser.resetPresetsFiles(
            referencedFiles,
            this.project.workspaceContext.config.allowCommentsInPresetsFile,
            this.project.workspaceContext.config.allowUnsupportedPresetsVersions
        );

        // reset all expanded presets storage.
        this._referencedFiles = Array.from(referencedFiles.keys());

        this.project.minCMakeVersion = preset.minCMakeVersion(this.folderPath);

        if (this.project.configurePreset) {
            await this.setConfigurePreset(this.project.configurePreset.name);
        }
        // Don't need to set build/test presets here since they are reapplied in setConfigurePreset

        await this.watchPresetsChange();
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
                        } else if (kit.name === SpecialKits.ScanSpecificDir) {
                            return `[${localize('scan.for.compilers.in.dir', 'Scan recursively for compilers in directory (max depth: 5)')}]`;
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
                        } else if (chosen_kit.kit.name === SpecialKits.ScanSpecificDir) {
                            await KitsController.scanForKitsInSpecificFolder(this.project);
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
                    const presets = preset.allConfigurePresets(this.folderPath);
                    const inherits = await this.selectAnyPreset(presets, presets, { placeHolder, canPickMany: true });
                    newPreset = { name: '__placeholder__', description: '', displayName: '', inherits };
                    break;
                }
                case SpecialOptions.ToolchainFile: {
                    const displayName = localize("custom.configure.preset.toolchain.file", "Configure preset using toolchain file");
                    const description = localize("description.custom.configure.preset", "Sets Ninja generator, build and install directory");
                    newPreset = {
                        name: '__placeholder__',
                        displayName,
                        description,
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
                    const displayName = localize("custom.configure.preset", "Custom configure preset");
                    const description = localize("description.custom.configure.preset", "Sets Ninja generator, build and install directory");
                    newPreset = {
                        name: '__placeholder__',
                        displayName,
                        description,
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

                const before: preset.ConfigurePreset[] = preset.allConfigurePresets(this.folderPath);
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
        if (preset.allConfigurePresets(this.folderPath).length === 0) {
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
        if (preset.allBuildPresets(this.folderPath).length > 0) {
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
                    const presets = preset.allConfigurePresets(this.folderPath);
                    const configurePreset = await this.selectNonHiddenPreset(presets, presets, { placeHolder });
                    newPreset = { name: '__placeholder__', description: '', displayName: '', configurePreset };
                    break;
                }
                case SpecialOptions.InheritBuildPreset: {
                    const placeHolder = localize('select.one.or.more.build.preset.placeholder', 'Select one or more build presets');
                    const presets = preset.allBuildPresets(this.folderPath);
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
        if (preset.allConfigurePresets(this.folderPath).length === 0) {
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
        if (preset.allTestPresets(this.folderPath).length > 0) {
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
                    const presets = preset.allConfigurePresets(this.folderPath);
                    const configurePreset = await this.selectNonHiddenPreset(presets, presets, { placeHolder });
                    newPreset = { name: '__placeholder__', description: '', displayName: '', configurePreset };
                    break;
                }
                case SpecialOptions.InheritTestPreset: {
                    const placeHolder = localize('select.one.or.more.test.preset.placeholder', 'Select one or more test presets');
                    const presets = preset.allTestPresets(this.folderPath);
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
        if (preset.allConfigurePresets(this.folderPath).length === 0) {
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
                    const presets = preset.allConfigurePresets(this.folderPath);
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
        if (preset.allConfigurePresets(this.folderPath).length === 0) {
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
        if (preset.allWorkflowPresets(this.folderPath).length > 0) {
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
                    const presets = preset.allConfigurePresets(this.folderPath);
                    const configurePreset = await this.selectNonHiddenPreset(presets, presets, { placeHolder });
                    if (configurePreset) {
                        newPreset = {
                            name: '__placeholder__', description: '', displayName: '',
                            steps: [{ type: "configure", name: configurePreset }]
                        };
                    }

                    break;
                }
                case SpecialOptions.CreateFromWorkflowPreset: {
                    const placeHolder = localize('select.one.workflow.preset.placeholder', 'Select one workflow base preset');
                    const presets = preset.allWorkflowPresets(this.folderPath);
                    const workflowBasePresetName = await this.selectNonHiddenPreset(presets, presets, { placeHolder, canPickMany: false });
                    const workflowBasePreset = presets.find(pr => pr.name === workflowBasePresetName);
                    newPreset = { name: '__placeholder__', description: '', displayName: '', steps: workflowBasePreset?.steps || [{ type: "configure", name: "_placeholder_" }] };
                    break;
                }
                case SpecialOptions.Custom: {
                    newPreset = { name: '__placeholder__', description: '', displayName: '', steps: [{ type: "configure", name: "_placeholder_" }] };
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

    // For all of the `getAll` methods, we now can safely grab only the user presets (if present), because they inherently include
    // the presets.
    async getAllConfigurePresets(): Promise<preset.ConfigurePreset[]> {
        const userPresets = preset.userConfigurePresets(this.folderPath);
        return userPresets.length > 0 ? userPresets : preset.configurePresets(this.folderPath);
    }

    async getAllBuildPresets(): Promise<preset.BuildPreset[]> {
        const userPresets = preset.userBuildPresets(this.folderPath);
        return userPresets.length > 0 ? userPresets : preset.buildPresets(this.folderPath);
    }

    async getAllTestPresets(): Promise<preset.TestPreset[]> {
        const userPresets = preset.userTestPresets(this.folderPath);
        return userPresets.length > 0 ? userPresets : preset.testPresets(this.folderPath);
    }

    async getAllPackagePresets(): Promise<preset.PackagePreset[]> {
        const userPresets = preset.userPackagePresets(this.folderPath);
        return userPresets.length > 0 ? userPresets : preset.packagePresets(this.folderPath);
    }

    async getAllWorkflowPresets(): Promise<preset.WorkflowPreset[]> {
        const userPresets = preset.userWorkflowPresets(this.folderPath);
        return userPresets.length > 0 ? userPresets : preset.workflowPresets(this.folderPath);
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

            if (this.project.workspaceContext.config.automaticReconfigure && !quickStart) {
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
            const allPresets = preset.allBuildPresets(this.folderPath);
            const buildPresets = (await this.getAllBuildPresets()).filter(
                (_preset) =>
                    this.checkCompatibility(
                        this.project.configurePreset,
                        _preset
                    ).buildPresetCompatible &&
                    preset.evaluatePresetCondition(_preset, allPresets)
            );
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
            const allPresets = preset.allTestPresets(this.folderPath);
            const testPresets = (await this.getAllTestPresets()).filter(
                (_preset) =>
                    this.checkCompatibility(
                        this.project.configurePreset,
                        _preset
                    ).buildPresetCompatible &&
                    preset.evaluatePresetCondition(_preset, allPresets)
            );
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
            const allPresets = preset.allPackagePresets(this.folderPath);
            const packagePresets = (await this.getAllPackagePresets()).filter(
                (_preset) =>
                    this.checkCompatibility(
                        this.project.configurePreset,
                        _preset
                    ).buildPresetCompatible &&
                    preset.evaluatePresetCondition(_preset, allPresets)
            );
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
            const allPresets = preset.allWorkflowPresets(this.folderPath);
            const workflowPresets = (await this.getAllWorkflowPresets()).filter(
                (_preset) =>
                    this.checkCompatibility(
                        this.project.configurePreset,
                        _preset
                    ).buildPresetCompatible &&
                    preset.evaluatePresetCondition(_preset, allPresets)
            );
            for (const workflowPreset of workflowPresets) {
                // Set active workflow preset as the first valid workflow preset (matching the selected configure preset is not a requirement as for the other presets types)
                await this.setWorkflowPreset(workflowPreset.name, false/*needToCheckConfigurePreset*/, false/*checkChangingPreset*/);
                currentWorkflowPreset = this.project.workflowPreset?.name;
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

        const allPresets = await this.getAllBuildPresets();
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

    private checkCompatibility(configurePreset: preset.ConfigurePreset | null, buildPreset?: preset.BuildPreset | null, testPreset?: preset.TestPreset | null, packagePreset?: preset.PackagePreset | null, workflowPreset?: preset.WorkflowPreset | null): { buildPresetCompatible: boolean; testPresetCompatible: boolean; packagePresetCompatible: boolean; workflowPresetCompatible: boolean } {
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

        return { buildPresetCompatible, testPresetCompatible, packagePresetCompatible, workflowPresetCompatible };
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

        const allPresets = await this.getAllTestPresets();
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

        const allPresets = await this.getAllPackagePresets();
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

        const allPresets = await this.getAllWorkflowPresets();
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

    private async reportPresetsFileErrors(path: string = "", expansionErrors: ExpansionErrorHandler) {
        const diagnostics: Diagnostic[] = [];
        for (const error of expansionErrors.errorList) {
            // message - error type, source - details & the preset name it's from
            const diagnostic: Diagnostic = {
                severity: DiagnosticSeverity.Error,
                message: error[0],
                source: error[1],
                range: new Range(new Position(0, 0), new Position(0, 0))    // TODO in the future we can add the range of the error - parse originalPresetsFile
            };
            // avoid duplicate diagnostics
            if (!diagnostics.find(d => d.message === diagnostic.message && d.source === diagnostic.source)) {
                diagnostics.push(diagnostic);
            }
        }

        collections.presets.set(vscode.Uri.file(path), diagnostics);
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
        // If the new preset inherits from a user preset, it should be added to the user presets file.
        let presetsFile: preset.PresetsFile;
        let isUserPreset = false;

        if (preset.inheritsFromUserPreset(newPreset, presetType, this.folderPath)) {
            presetsFile = preset.getOriginalUserPresetsFile(this.folderPath) || { version: 8 };
            isUserPreset = true;
        } else {
            presetsFile = preset.getOriginalPresetsFile(this.folderPath) || { version: 8 };
            isUserPreset = false;
        }

        if (!presetsFile[presetType]) {
            presetsFile[presetType] = [];
        }
        switch (presetType) {
            case "configurePresets":
            case "buildPresets":
            case "testPresets":
            case "packagePresets":
                presetsFile[presetType]!.push(newPreset);
                break;
            case "workflowPresets":
                presetsFile[presetType]!.push(newPreset as preset.WorkflowPreset);
                break;
        }
        await this.updatePresetsFile(presetsFile, isUserPreset);
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

    // this is used for the file watcher on adding a new presets file
    async onCreatePresetsFile() {
        await this.reapplyPresets();
        await this.project.projectController?.updateActiveProject(this.workspaceFolder);
    }

    private async watchPresetsChange() {

        const presetChangeHandler = () => {
            void this.reapplyPresets();
        };
        const presetCreatedHandler = () => {
            void this.onCreatePresetsFile();
        };

        const events: Map<string, () => void> = new Map<string, () => void>([
            ["change", presetChangeHandler],
            ["unlink", presetChangeHandler],
            ["add", presetCreatedHandler]
        ]);

        this._presetsWatchers?.dispose();
        this._presetsWatchers = new FileWatcher(this._referencedFiles, events, { ignoreInitial: true });
    };

    dispose() {
        this._presetsWatchers?.dispose();

        if (this._sourceDirChangedSub) {
            this._sourceDirChangedSub.dispose();
        }
    }
}

/**
 * FileWatcher is a wrapper around chokidar's FSWatcher that allows for watching multiple paths.
 * Chokidar's support for watching multiple paths is currently broken, if it is fixed in the future, this class can be removed.
 */
class FileWatcher implements vscode.Disposable {
    private watchers: Map<string, chokidar.FSWatcher>;
    // Debounce the change handler to avoid multiple changes being triggered by a single file change. Two change events are coming in rapid succession without this.
    private canRunChangeHandler = true;

    public constructor(paths: string | string[], eventHandlers: Map<string, () => void>, options?: chokidar.WatchOptions) {
        this.watchers = new Map<string, chokidar.FSWatcher>();

        // We debounce the change event to avoid multiple changes being triggered by a single file change.
        const onChange = eventHandlers.get('change');
        if (onChange) {
            const debouncedOnChange = () => {
                if (this.canRunChangeHandler) {
                    onChange();
                    this.canRunChangeHandler = false;
                    setTimeout(() => (this.canRunChangeHandler = true), 500);
                }
            };
            eventHandlers.set("change", debouncedOnChange);
        }

        for (const path of Array.isArray(paths) ? paths : [paths]) {
            try {
                const watcher = chokidar.watch(path, { ...options });
                const eventHandlerEntries = Array.from(eventHandlers);
                for (let i = 0; i < eventHandlerEntries.length; i++) {
                    const [event, handler] = eventHandlerEntries[i];
                    watcher.on(event, handler);
                }
                this.watchers.set(path, watcher);
            } catch (error) {
                log.error(localize('failed.to.watch', 'Watcher could not be created for {0}: {1}', path, util.errorToString(error)));
            }
        }
    }

    public dispose() {
        for (const watcher of this.watchers.values()) {
            watcher.close().then(() => {}, () => {});
        }
    }
}
