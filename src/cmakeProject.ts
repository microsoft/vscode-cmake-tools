import { CMakeCache } from '@cmt/cache';
import { CMakeExecutable, getCMakeExecutableInformation } from '@cmt/cmake/cmakeExecutable';
import { CompilationDatabase } from '@cmt/compilationDatabase';
import * as debuggerModule from '@cmt/debugger';
import collections from '@cmt/diagnostics/collections';
import * as shlex from '@cmt/shlex';
import { Strand } from '@cmt/strand';
import { ProgressHandle, versionToString, lightNormalizePath, Version, versionLess } from '@cmt/util';
import { DirectoryContext } from '@cmt/workspace';
import * as path from 'path';
import * as vscode from 'vscode';
import * as proc from '@cmt/proc';
import { CodeModelContent } from '@cmt/drivers/codeModel';
import {
    BadHomeDirectoryError,
    CMakeDriver,
    CMakeFileApiDriver,
    CMakeLegacyDriver,
    CMakePreconditionProblems,
    CMakeServerDriver,
    ConfigureResult,
    ConfigureResultType,
    ExecutableTarget,
    NoGeneratorError
} from '@cmt/drivers/drivers';
import { CTestDriver } from './ctest';
import { CPackDriver } from './cpack';
import { WorkflowDriver } from './workflow';
import { CMakeBuildConsumer } from './diagnostics/build';
import { CMakeOutputConsumer } from './diagnostics/cmake';
import { FileDiagnostic, populateCollection } from './diagnostics/util';
import { expandStrings, expandString, ExpansionOptions } from './expand';
import { CMakeGenerator, Kit, SpecialKits } from './kit';
import * as logging from './logging';
import { fs } from './pr';
import { buildCmdStr, DebuggerEnvironmentVariable, ExecutionResult, ExecutionOptions } from './proc';
import { FireLate, Property } from './prop';
import rollbar from './rollbar';
import * as telemetry from './telemetry';
import { VariantManager } from './variant';
import * as nls from 'vscode-nls';
import { ConfigurationWebview } from './cacheView';
import { enableFullFeatureSet, extensionManager, updateFullFeatureSet, setContextAndStore } from './extension';
import { CMakeCommunicationMode, ConfigurationReader, OptionConfig, UseCMakePresets, checkConfigureOverridesPresent } from './config';
import * as preset from '@cmt/preset';
import * as util from '@cmt/util';
import { Environment, EnvironmentUtils } from './environmentVariables';
import { KitsController } from './kitsController';
import { PresetsController } from './presetsController';
import paths from './paths';
import { ProjectController } from './projectController';
import { MessageItem } from 'vscode';
import { DebugTrackerFactory, DebuggerInformation, getDebuggerPipeName } from './debug/debuggerConfigureDriver';
import { ConfigurationType } from 'vscode-cmake-tools';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const open = require('open') as ((url: string, appName?: string, callback?: Function) => void);

const log = logging.createLogger('main');
const buildLogger = logging.createLogger('build');
const cmakeLogger = logging.createLogger('cmake');

export enum ConfigureType {
    Normal,
    Clean,
    Cache,
    ShowCommandOnly,
    NormalWithDebugger,
    CleanWithDebugger
}

export enum ConfigureTrigger {
    api = "api",
    runTests = "runTests",
    package = "package",
    workflow =  "workflow",
    badHomeDir = "badHomeDir",
    configureOnOpen = "configureOnOpen",
    configureWithCache = "configureWithCache",
    quickStart = "quickStart",
    setVariant = "setVariant",
    cmakeListsChange = "cmakeListsChange",
    sourceDirectoryChange = "sourceDirectoryChange",
    buttonNewKitsDefinition = "buttonNewKitsDefinition",
    compilation = "compilation",
    launch = "launch",
    commandEditCacheUI = "commandEditCacheUI",
    commandConfigure = "commandConfigure",
    commandConfigureWithDebugger = "commandConfigureWithDebugger",
    projectOutlineConfigureWithDebugger = "projectOutlineConfigureWithDebugger",
    commandCleanConfigure = "commandCleanConfigure",
    commandCleanConfigureWithDebugger = "commandCleanConfigureWithDebugger",
    commandConfigureAll = "commandConfigureAll",
    commandConfigureAllWithDebugger = "commandConfigureAllWithDebugger",
    projectOutlineConfigureAllWithDebugger = "projectOutlineConfigureAllWithDebugger",
    commandCleanConfigureAll = "commandCleanConfigureAll",
    commandCleanConfigureAllWithDebugger = "commandConfigureAllWithDebugger",
    projectOutlineCleanConfigureAllWithDebugger = "projectOutlineCleanConfigureAllWithDebugger",
    configureFailedConfigureWithDebuggerButton = "configureFailedConfigureWithDebuggerButton",
    taskProvider = "taskProvider",
    selectConfigurePreset = "selectConfigurePreset",
    selectKit = "selectKit"
}

export interface DiagnosticsConfiguration {
    folder: string;
    cmakeVersion: string;
    compilers: { C?: string; CXX?: string };
    usesPresets: boolean;
    generator: string;
    configured: boolean;
}

export interface DiagnosticsSettings {
    communicationMode: CMakeCommunicationMode;
    useCMakePresets: UseCMakePresets;
    configureOnOpen: boolean | null;
}

export interface ConfigureCancelInformation {
    canceled: boolean;
}

/**
 * Class implementing the extension. It's all here!
 *
 * The class internally uses a two-phase initialization, since proper startup
 * requires asynchrony. To ensure proper initialization. The class must be
 * created via the `create` static method. This will run the two phases
 * internally and return a promise to the new instance. This ensures that the
 * class invariants are maintained at all times.
 *
 * Some fields also require two-phase init. Their first phase is in the first
 * phase of the CMakeProject init, ie. the constructor.
 *
 * The second phases of fields will be called by the second phase of the parent
 * class. See the `init` private method for this initialization.
 */
export class CMakeProject {
    private wasUsingCMakePresets: boolean | undefined;
    private onDidOpenTextDocumentListener: vscode.Disposable | undefined;
    private disposables: vscode.Disposable[] = [];
    private readonly onUseCMakePresetsChangedEmitter = new vscode.EventEmitter<boolean>();
    public projectController: ProjectController | undefined;
    public readonly cTestController: CTestDriver;
    public readonly cPackageController: CPackDriver;
    public readonly workflowController: WorkflowDriver;
    public kitsController!: KitsController;
    public presetsController!: PresetsController;

    /**
     * Construct a new instance. The instance isn't ready, and must be initalized.
     * @param projectController Required for test explorer to work properly. Setting as optional to avoid breaking tests.
     *
     * This is private. You must call `create` to get an instance.
     */
    private constructor(readonly workspaceContext: DirectoryContext, projectController?: ProjectController, readonly isMultiProjectFolder: boolean = false) {
        // Handle the active kit changing. We want to do some updates and teardown
        log.debug(localize('constructing.cmakeproject', 'Constructing new CMakeProject instance'));
        this.projectController = projectController;
        this.cTestController = new CTestDriver(workspaceContext, projectController);
        this.cPackageController = new CPackDriver(workspaceContext);
        this.workflowController = new WorkflowDriver(workspaceContext, projectController);
        this.onCodeModelChanged(FireLate, (_) => this._codeModelChangedApiEventEmitter.fire());
    }

    /**
     * The Workspace folder associated with this CMakeProject instance.
     * This is where we search for the variants and workspace-local kits.
     */
    get workspaceFolder(): vscode.WorkspaceFolder {
        return this.workspaceContext.folder;
    }

    /**
     * The folder associated with this CMakeProject.
     * For single-project folders, this is the WorkspaceFolder for historical reasons.
     * For multi-project folders, this is the directory where the CMakeProject lives (this.sourceDir)
     */
    get folderPath(): string {
        return this.isMultiProjectFolder ? this.sourceDir : this.workspaceContext.folder.uri.fsPath;
    }

    /**
     * The name of the folder for this CMakeProject instance
     */
    get folderName(): string {
        return path.basename(this.folderPath);
    }

    /**
     * Whether we use presets
     */
    private _useCMakePresets = false; // The default value doesn't matter, value is set when folder is loaded
    get useCMakePresets(): boolean {
        return this._useCMakePresets;
    }
    async setUseCMakePresets(useCMakePresets: boolean) {
        if (this.targetName.value === this.initTargetName) {
            if (useCMakePresets) {
                this.targetName.set(this.targetsInPresetName);
            } else {
                this.targetName.set('all');
            }
        }
        if (!useCMakePresets && this.targetName.value === this.targetsInPresetName) {
            this.targetName.set('all');
        }
        const oldValue = this.useCMakePresets;
        if (oldValue !== useCMakePresets) {
            this._useCMakePresets = useCMakePresets;
            const drv = await this.cmakeDriver;
            if (drv) {
                log.debug(localize('disposing.driver', 'Disposing CMake driver'));
                await drv.asyncDispose();
                this.cmakeDriver = Promise.resolve(null);
            }
        }
    }

    // Events that effect the user-interface
    /**
     * The status of this backend
     */
    get onStatusMessageChanged() {
        return this.statusMessage.changeEvent;
    }
    private readonly statusMessage = new Property<string>(localize('initializing', 'Initializing'));

    /**
     * Minimum cmake version supported. Currently only used for presets
     */
    public minCMakeVersion?: Version;

    /**
     * Currently selected configure preset
     */
    get configurePreset() {
        return this._configurePreset.value;
    }

    get onActiveConfigurePresetChanged() {
        return this._configurePreset.changeEvent;
    }
    private readonly _configurePreset = new Property<preset.ConfigurePreset | null>(null);

    private async resetPresets(driver: CMakeDriver | null) {
        // NOTE: don't delete from workspaceContext the association between this.folderName-this.configurePreset.name
        // and all the previously selected build/test/package/workflow presets.
        // If we set the configure preset back to the value before this "reset", all should be restored fine.
        await this.workspaceContext.state.setConfigurePresetName(this.folderName, null, this.isMultiProjectFolder);

        this._configurePreset.set(null);
        this._buildPreset.set(null);
        this._testPreset.set(null);
        this._packagePreset.set(null);
        this._workflowPreset.set(null);

        await driver?.setConfigurePreset(null);
        await driver?.setBuildPreset(null);
        await driver?.setTestPreset(null);
        await driver?.setPackagePreset(null);
        await driver?.setWorkflowPreset(null);
    }

    async expandConfigPresetbyName(configurePreset: string | null | undefined): Promise<preset.ConfigurePreset | undefined> {
        if (!configurePreset) {
            return undefined;
        }
        log.debug(localize('resolving.config.preset', 'Resolving the selected configure preset'));

        // We want to use the original unexpanded preset file to apply the dev env in expandConfigurePreset
        // we have to first check if the preset is valid in expandedPresets since we won't be expanding the whole file here, only the path up for this preset
        if (!preset.getPresetByName(preset.configurePresets(this.folderPath), configurePreset) && !preset.getPresetByName(preset.userConfigurePresets(this.folderPath), configurePreset)) {
            return undefined;
        }

        // TODO: move applyDevEnv here to decouple from expandConfigurePreset

        // modify the preset parent environment, in certain cases, to apply the Vs Dev Env on top of process.env.
        const expandedConfigurePreset = await preset.expandConfigurePreset(this.folderPath,
            configurePreset,
            lightNormalizePath(this.folderPath || '.'),
            this.sourceDir,
            true,
            true);

        if (!expandedConfigurePreset) {
            log.error(localize('failed.resolve.config.preset', 'Failed to resolve configure preset: {0}', configurePreset));
            return undefined;
        }
        if (expandedConfigurePreset.__file && expandedConfigurePreset.__file.version <= 2) {
            if (!expandedConfigurePreset.binaryDir) {
                log.error(localize('binaryDir.not.set.config.preset', '{0} is not set in configure preset: {1}', "\"binaryDir\"", configurePreset));
                return undefined;
            }
            if (!expandedConfigurePreset.generator) {
                log.error(localize('generator.not.set.config.preset', '{0} is not set in configure preset: {1}', "\"generator\"", configurePreset));
                return undefined;
            }
        }

        return expandedConfigurePreset;
    }

    /**
     * Presets are loaded by PresetsController, so this function should only be called by PresetsController.
     */
    async setConfigurePreset(configurePreset: string | null) {
        const previousGenerator = this.configurePreset?.generator;
        const drv = await this.cmakeDriver;  // Use only an existing driver, do not create one

        if (configurePreset) {
            const expandedConfigurePreset: preset.ConfigurePreset | undefined = await this.expandConfigPresetbyName(configurePreset);

            if (!expandedConfigurePreset) {
                await this.resetPresets(drv);
                return;
            }
            const priorCMakePath = await this.getCMakePathofProject(); // used for later comparison to determine if we need to update the driver's cmake.
            this._configurePreset.set(expandedConfigurePreset);
            if (previousGenerator && previousGenerator !== expandedConfigurePreset?.generator) {
                await this.shutDownCMakeDriver();
            }
            log.debug(localize('loading.new.config.preset', 'Loading new configure preset into CMake driver'));
            if (drv) {
                try {
                    this.statusMessage.set(localize('reloading.status', 'Reloading...'));
                    await drv.setConfigurePreset(expandedConfigurePreset);
                    const updatedCMakePath = await this.getCMakePathofProject();

                    // check if we need to update the driver's cmake, if so, update.
                    if (priorCMakePath !== updatedCMakePath) {
                        drv.cmake = await this.getCMakeExecutable();
                    }

                    await this.workspaceContext.state.setConfigurePresetName(this.folderName, configurePreset, this.isMultiProjectFolder);
                    this.statusMessage.set(localize('ready.status', 'Ready'));
                } catch (error: any) {
                    void vscode.window.showErrorMessage(localize('unable.to.set.config.preset', 'Unable to set configure preset {0}.', `"${error}"`));
                    this.statusMessage.set(localize('error.on.switch.config.preset', 'Error on switch of configure preset ({0})', error.message));
                    this.cmakeDriver = Promise.resolve(null);
                    await this.resetPresets(drv);
                }
            } else {
                // Remember the selected configure preset for the next session.
                await this.workspaceContext.state.setConfigurePresetName(this.folderName, configurePreset, this.isMultiProjectFolder);
            }
        } else {
            await this.resetPresets(drv);
        }
    }

    /**
     * Currently selected build preset
     */
    get buildPreset() {
        return this._buildPreset.value;
    }
    get onActiveBuildPresetChanged() {
        return this._buildPreset.changeEvent;
    }
    private readonly _buildPreset = new Property<preset.BuildPreset | null>(null);

    async expandBuildPresetbyName(buildPreset: string | null): Promise<preset.BuildPreset | undefined> {
        if (!buildPreset) {
            return undefined;
        }
        log.debug(localize('resolving.build.preset', 'Resolving the selected build preset'));
        const expandedBuildPreset = await preset.expandBuildPreset(this.folderPath,
            buildPreset,
            lightNormalizePath(this.folderPath || '.'),
            this.sourceDir,
            this.workspaceContext.config.parallelJobs,
            this.getPreferredGeneratorName(),
            true,
            this.configurePreset?.name);
        if (!expandedBuildPreset) {
            log.error(localize('failed.resolve.build.preset', 'Failed to resolve build preset: {0}', buildPreset));
            return undefined;
        }
        return expandedBuildPreset;
    }

    /**
     * Presets are loaded by PresetsController, so this function should only be called by PresetsController.
     */
    async setBuildPreset(buildPreset: string | null) {
        const drv = await this.cmakeDriver;  // Use only an existing driver, do not create one
        if (buildPreset) {
            const expandedBuildPreset = await this.expandBuildPresetbyName(buildPreset);
            if (!expandedBuildPreset) {
                this._buildPreset.set(null);
                return;
            }
            this._buildPreset.set(expandedBuildPreset);
            if (!expandedBuildPreset.configurePreset) {
                log.error(localize('configurePreset.not.set.build.preset', '{0} is not set in build preset: {1}', "\"configurePreset\"", buildPreset));
                this._buildPreset.set(null);
                return;
            }
            log.debug(localize('loading.new.build.preset', 'Loading new build preset into CMake driver'));
            if (drv) {
                try {
                    this.statusMessage.set(localize('reloading.status', 'Reloading...'));
                    await drv.setBuildPreset(expandedBuildPreset);
                    await this.workspaceContext.state.setBuildPresetName(this.folderName, expandedBuildPreset.configurePreset, buildPreset, this.isMultiProjectFolder);
                    this.statusMessage.set(localize('ready.status', 'Ready'));
                } catch (error: any) {
                    void vscode.window.showErrorMessage(localize('unable.to.set.build.preset', 'Unable to set build preset {0}.', `"${error}"`));
                    this.statusMessage.set(localize('error.on.switch.build.preset', 'Error on switch of build preset ({0})', error.message));
                    this.cmakeDriver = Promise.resolve(null);
                    this._buildPreset.set(null);
                }
            } else {
                // Remember the selected build preset for the next session.
                await this.workspaceContext.state.setBuildPresetName(this.folderName, expandedBuildPreset.configurePreset, buildPreset, this.isMultiProjectFolder);
            }
        } else {
            this._buildPreset.set(null);
            await drv?.setBuildPreset(null);
            if (this.configurePreset) {
                await this.workspaceContext.state.setBuildPresetName(this.folderName, this.configurePreset.name, null, this.isMultiProjectFolder);
            }
        }
    }

    /**
     * Currently selected test preset
     */
    get testPreset() {
        return this._testPreset.value;
    }
    get onActiveTestPresetChanged() {
        return this._testPreset.changeEvent;
    }
    private readonly _testPreset = new Property<preset.TestPreset | null>(null);

    async expandTestPresetbyName(testPreset: string | null): Promise<preset.TestPreset | undefined> {
        if (!testPreset) {
            return undefined;
        }
        log.debug(localize('resolving.test.preset', 'Resolving the selected test preset'));
        const expandedTestPreset = await preset.expandTestPreset(this.folderPath,
            testPreset,
            lightNormalizePath(this.folderPath || '.'),
            this.sourceDir,
            this.getPreferredGeneratorName(),
            true,
            this.configurePreset?.name);
        if (!expandedTestPreset) {
            log.error(localize('failed.resolve.test.preset', 'Failed to resolve test preset: {0}', testPreset));
            return undefined;
        }
        if (!expandedTestPreset.configurePreset) {
            log.error(localize('configurePreset.not.set.test.preset', '{0} is not set in test preset: {1}', "\"configurePreset\"", testPreset));
            return undefined;
        }
        return expandedTestPreset;
    }

    /**
     * Presets are loaded by PresetsController, so this function should only be called by PresetsController.
     */
    async setTestPreset(testPreset: string | null) {
        const drv = await this.cmakeDriver;  // Use only an existing driver, do not create one
        if (testPreset) {
            log.debug(localize('resolving.test.preset', 'Resolving the selected test preset'));
            const expandedTestPreset = await this.expandTestPresetbyName(testPreset);
            if (!expandedTestPreset) {
                this._testPreset.set(null);
                return;
            }
            this._testPreset.set(expandedTestPreset);
            log.debug(localize('loading.new.test.preset', 'Loading new test preset into CMake driver'));
            if (drv) {
                try {
                    this.statusMessage.set(localize('reloading.status', 'Reloading...'));
                    await drv.setTestPreset(expandedTestPreset);
                    if (expandedTestPreset.configurePreset) {
                        await this.workspaceContext.state.setTestPresetName(this.folderName, expandedTestPreset.configurePreset, testPreset, this.isMultiProjectFolder);
                    }
                    this.statusMessage.set(localize('ready.status', 'Ready'));
                } catch (error: any) {
                    void vscode.window.showErrorMessage(localize('unable.to.set.test.preset', 'Unable to set test preset {0}.', `"${error}"`));
                    this.statusMessage.set(localize('error.on.switch.test.preset', 'Error on switch of test preset ({0})', error.message));
                    this.cmakeDriver = Promise.resolve(null);
                    this._testPreset.set(null);
                }
            } else {
                if (expandedTestPreset.configurePreset) {
                    // Remember the selected test preset for the next session.
                    await this.workspaceContext.state.setTestPresetName(this.folderName, expandedTestPreset.configurePreset, testPreset, this.isMultiProjectFolder);
                }
            }
        } else {
            this._testPreset.set(null);
            await drv?.setTestPreset(null);
            if (this.configurePreset) {
                await this.workspaceContext.state.setTestPresetName(this.folderName, this.configurePreset.name, null, this.isMultiProjectFolder);
            }
        }
    }

    /**
     * Currently selected package preset
     */
    get packagePreset() {
        return this._packagePreset.value;
    }
    get onActivePackagePresetChanged() {
        return this._packagePreset.changeEvent;
    }
    private readonly _packagePreset = new Property<preset.PackagePreset | null>(null);

    async expandPackagePresetbyName(packagePreset: string | null): Promise<preset.PackagePreset | undefined> {
        if (!packagePreset) {
            return undefined;
        }
        log.debug(localize('resolving.package.preset', 'Resolving the selected package preset'));
        const expandedPackagePreset = await preset.expandPackagePreset(this.folderPath,
            packagePreset,
            lightNormalizePath(this.folderPath || '.'),
            this.sourceDir,
            this.getPreferredGeneratorName(),
            true,
            this.configurePreset?.name);
        if (!expandedPackagePreset) {
            log.error(localize('failed.resolve.package.preset', 'Failed to resolve package preset: {0}', packagePreset));
            return undefined;
        }
        if (!expandedPackagePreset.configurePreset) {
            log.error(localize('configurePreset.not.set.package.preset', '{0} is not set in package preset: {1}', "\"configurePreset\"", packagePreset));
            return undefined;
        }
        return expandedPackagePreset;
    }

    /**
     * Presets are loaded by PresetsController, so this function should only be called by PresetsController.
     */
    async setPackagePreset(packagePreset: string | null) {
        const drv = await this.cmakeDriver;  // Use only an existing driver, do not create one
        if (packagePreset) {
            log.debug(localize('resolving.package.preset', 'Resolving the selected package preset'));
            const expandedPackagePreset = await this.expandPackagePresetbyName(packagePreset);
            if (!expandedPackagePreset) {
                this._packagePreset.set(null);
                return;
            }
            this._packagePreset.set(expandedPackagePreset);
            log.debug(localize('loading.new.package.preset', 'Loading new package preset into CMake driver'));
            if (drv) {
                try {
                    this.statusMessage.set(localize('reloading.status', 'Reloading...'));
                    await drv.setPackagePreset(expandedPackagePreset);
                    if (expandedPackagePreset.configurePreset) {
                        await this.workspaceContext.state.setPackagePresetName(this.folderName, expandedPackagePreset.configurePreset, packagePreset, this.isMultiProjectFolder);
                    }
                    this.statusMessage.set(localize('ready.status', 'Ready'));
                } catch (error: any) {
                    void vscode.window.showErrorMessage(localize('unable.to.set.package.preset', 'Unable to set package preset {0}.', `"${error}"`));
                    this.statusMessage.set(localize('error.on.switch.package.preset', 'Error on switch of package preset ({0})', error.message));
                    this.cmakeDriver = Promise.resolve(null);
                    this._packagePreset.set(null);
                }
            } else {
                if (expandedPackagePreset.configurePreset) {
                    // Remember the selected package preset for the next session.
                    await this.workspaceContext.state.setPackagePresetName(this.folderName, expandedPackagePreset.configurePreset, packagePreset, this.isMultiProjectFolder);
                }
            }
        } else {
            this._packagePreset.set(null);
            await drv?.setPackagePreset(null);
            if (this.configurePreset) {
                await this.workspaceContext.state.setPackagePresetName(this.folderName, this.configurePreset.name, null, this.isMultiProjectFolder);
            }
        }
    }

    /**
     * Currently selected workflow preset
     */
    get workflowPreset() {
        return this._workflowPreset.value;
    }
    get onActiveWorkflowPresetChanged() {
        return this._workflowPreset.changeEvent;
    }
    private readonly _workflowPreset = new Property<preset.WorkflowPreset | null>(null);

    async expandWorkflowPresetbyName(workflowPreset: string | null): Promise<preset.WorkflowPreset | undefined> {
        if (!workflowPreset) {
            return undefined;
        }
        log.debug(localize('resolving.workflow.preset', 'Resolving the selected workflow preset'));
        const expandedWorkflowPreset = await preset.expandWorkflowPreset(this.folderPath,
            workflowPreset,
            lightNormalizePath(this.folderPath || '.'),
            this.sourceDir,
            true,
            this.configurePreset?.name);
        if (!expandedWorkflowPreset) {
            log.error(localize('failed.resolve.workflow.preset', 'Failed to resolve workflow preset: {0}', workflowPreset));
            return undefined;
        }
        if (!expandedWorkflowPreset.steps[0].name) {
            log.error(localize('configurePreset.not.set.workflow.preset', '{0} is not set in workflow preset: {1}', "\"configurePreset\"", workflowPreset));
            return undefined;
        }
        return expandedWorkflowPreset;
    }

    /**
     * Presets are loaded by PresetsController, so this function should only be called by PresetsController.
     */
    async setWorkflowPreset(workflowPreset: string | null) {
        const drv = await this.cmakeDriver;  // Use only an existing driver, do not create one
        if (workflowPreset) {
            log.debug(localize('resolving.workflow.preset', 'Resolving the selected workflow preset'));
            const expandedWorkflowPreset = await this.expandWorkflowPresetbyName(workflowPreset);
            if (!expandedWorkflowPreset) {
                this._workflowPreset.set(null);
                return;
            }
            this._workflowPreset.set(expandedWorkflowPreset);
            log.debug(localize('loading.new.workflow.preset', 'Loading new workflow preset into CMake driver'));
            if (drv) {
                try {
                    this.statusMessage.set(localize('reloading.status', 'Reloading...'));
                    await drv.setWorkflowPreset(expandedWorkflowPreset);
                    // We need to associate this workflow preset with the current configure preset of the project,
                    // not the configure preset of step0 (which may even differ).
                    if (this.configurePreset) {
                        await this.workspaceContext.state.setWorkflowPresetName(this.folderName, this.configurePreset.name, workflowPreset, this.isMultiProjectFolder);
                    }
                    this.statusMessage.set(localize('ready.status', 'Ready'));
                } catch (error: any) {
                    void vscode.window.showErrorMessage(localize('unable.to.set.workflow.preset', 'Unable to set workflow preset {0}.', `"${error}"`));
                    this.statusMessage.set(localize('error.on.switch.workflow.preset', 'Error on switch of workflow preset ({0})', error.message));
                    this.cmakeDriver = Promise.resolve(null);
                    this._workflowPreset.set(null);
                }
            } else {
                if (this.configurePreset) {
                    // Remember the selected workflow preset for the next session.
                    await this.workspaceContext.state.setWorkflowPresetName(this.folderName, this.configurePreset.name, workflowPreset, this.isMultiProjectFolder);
                }
            }
        } else {
            this._workflowPreset.set(null);
            await drv?.setWorkflowPreset(null);
            if (this.configurePreset) {
                await this.workspaceContext.state.setWorkflowPresetName(this.folderName, this.configurePreset.name, null, this.isMultiProjectFolder);
            }
        }
    }

    /**
     * The current target to build.
     */
    get onTargetNameChanged() {
        return this.targetName.changeEvent;
    }
    private readonly initTargetName = '__init__';
    private readonly targetName = new Property<string>(this.initTargetName);

    /**
     * The current variant name for displaying to the UI (not the buildType)
     */
    get activeVariantName() {
        return this.activeVariant.value;
    }
    get onActiveVariantNameChanged() {
        return this.activeVariant.changeEvent;
    }
    private readonly activeVariant = new Property<string>('Unconfigured');

    /**
     * The "launch target" (the target that will be run by debugging)
     */
    get launchTargetName() {
        return this._launchTargetName.value;
    }
    get onLaunchTargetNameChanged() {
        return this._launchTargetName.changeEvent;
    }
    private readonly _launchTargetName = new Property<string | null>(null);

    /**
     * Whether CTest is enabled
     */
    get ctestEnabled() {
        return this._ctestEnabled.value;
    }
    get onCTestEnabledChanged() {
        return this._ctestEnabled.changeEvent;
    }
    private readonly _ctestEnabled = new Property<boolean>(false);

    /**
     * Whether CPack is enabled
     */
    get cpackEnabled() {
        return this._cpackEnabled.value;
    }
    get onCPackEnabledChanged() {
        return this._cpackEnabled.changeEvent;
    }
    private readonly _cpackEnabled = new Property<boolean>(false);

    /**
     * Whether the backend is busy running some task
     */
    get onIsBusyChanged() {
        return this.isBusy.changeEvent;
    }
    private readonly isBusy = new Property<boolean>(false);

    /**
     * Event fired when the code model from CMake is updated
     */
    get codeModelContent() {
        return this._codeModelContent.value;
    }
    get onCodeModelChanged() {
        return this._codeModelContent.changeEvent;
    }
    private readonly _codeModelContent = new Property<CodeModelContent | null>(null);
    private codeModelDriverSub: vscode.Disposable | null = null;

    get onCodeModelChangedApiEvent() {
        return this._codeModelChangedApiEventEmitter.event;
    }
    private readonly _codeModelChangedApiEventEmitter = new vscode.EventEmitter<void>();

    public notifyOnSelectedConfigurationChanged(configurationType: ConfigurationType) {
        this._onSelectedConfigurationChangedApiEvent.fire(configurationType);
    }
    get onSelectedConfigurationChangedApiEvent() {
        return this._onSelectedConfigurationChangedApiEvent.event;
    }
    private readonly _onSelectedConfigurationChangedApiEvent = new vscode.EventEmitter<ConfigurationType>();

    private readonly communicationModeSub = this.workspaceContext.config.onChange('cmakeCommunicationMode', () => {
        log.info(localize('communication.changed.restart.driver', "Restarting the CMake driver after a communication mode change."));
        return this.shutDownCMakeDriver();
    });

    private readonly generatorSub = this.workspaceContext.config.onChange('generator', async () => {
        log.info(localize('generator.changed.restart.driver', "Restarting the CMake driver after a generator change."));
        await this.reloadCMakeDriver();
    });

    private readonly preferredGeneratorsSub = this.workspaceContext.config.onChange('preferredGenerators', async () => {
        log.info(localize('preferredGenerator.changed.restart.driver', "Restarting the CMake driver after a preferredGenerators change."));
        await this.reloadCMakeDriver();
    });

    private readonly cmakePathSub = this.workspaceContext.config.onChange('cmakePath', async () => {
        // Force re-reading of cmake exe, this will ensure that the debugger capabilities are updated.
        const cmakeInfo = await this.getCMakeExecutable();
        if (!cmakeInfo.isPresent) {
            void vscode.window.showErrorMessage(localize('bad.executable', 'Bad CMake executable: {0}. Check to make sure it is installed or the value of the {1} setting contains the correct path', `"${cmakeInfo.path}"`, '"cmake.cmakePath"'));
            telemetry.logEvent('CMakeExecutableNotFound');
        }

        await this.reloadCMakeDriver();
    });

    /**
     * The variant manager keeps track of build variants. Has two-phase init.
     */
    private readonly variantManager = new VariantManager(this.workspaceFolder, this.workspaceContext.state, this.workspaceContext.config, this.isMultiProjectFolder);

    /**
     * A strand to serialize operations with the CMake driver
     */
    private readonly driverStrand = new Strand();

    /**
     * The object in charge of talking to CMake. It starts empty (null) because
     * we don't know what driver to use at the current time. The driver also has
     * two-phase init and a private constructor. The driver may be replaced at
     * any time by the user making changes to the workspace configuration.
     */
    private cmakeDriver: Promise<CMakeDriver | null> = Promise.resolve(null);

    /**
     * This object manages the CMake Cache Editor GUI
     */
    private cacheEditorWebview: ConfigurationWebview | undefined;

    /**
     * Event fired just as CMakeProject is about to be disposed
     */
    get onDispose() {
        return this.disposeEmitter.event;
    }
    private readonly disposeEmitter = new vscode.EventEmitter<void>();

    /**
     * Dispose the instance
     */
    dispose() {
        log.debug(localize('disposing.extension', 'Disposing CMake Tools extension'));
        this.disposeEmitter.fire();
        this.termCloseSub.dispose();
        this.launchTerminals.forEach(term => term.dispose());
        for (const sub of [
            this.generatorSub,
            this.preferredGeneratorsSub,
            this.communicationModeSub,
            this.cmakePathSub
        ]) {
            sub.dispose();
        }
        this.kitsController.dispose();
        rollbar.invokeAsync(localize('extension.dispose', 'Extension dispose'), () => this.asyncDispose());
        if (this.onDidOpenTextDocumentListener) {
            this.onDidOpenTextDocumentListener.dispose();
        }
    }

    /**
     * Dispose of the extension asynchronously.
     */
    async asyncDispose() {
        collections.reset();
        const drv = await this.cmakeDriver;
        if (drv) {
            await drv.asyncDispose();
        }
        for (const disp of [this.statusMessage, this.targetName, this.activeVariant, this._ctestEnabled, this.isBusy, this.variantManager, this.cTestController, this.cPackageController]) {
            disp.dispose();
        }
    }

    private getPreferredGenerators(): CMakeGenerator[] {
        const userPreferred: CMakeGenerator[] = this.workspaceContext.config.preferredGenerators
            .map(g => ({ name: g }));

        // The generator setting is placed at the front of user preferred generators
        const userGenerator = this.workspaceContext.config.generator;
        if (userGenerator) {
            log.debug(localize('using.user.generator', 'Using generator from user configuration: {0}', userGenerator));
            userPreferred.unshift({
                name: userGenerator,
                platform: this.workspaceContext.config.platform || undefined,
                toolset: this.workspaceContext.config.toolset || undefined
            });
        }

        return userPreferred;
    }

    private getPreferredGeneratorName(): string | undefined {
        const generators = this.getPreferredGenerators();
        return generators[0]?.name;
    }

    /**
     * Execute pre-configure/build tasks to check if we are ready to run a full
     * configure. This should be called by a derived driver before any
     * configuration tasks are run
     */
    public async cmakePreConditionProblemHandler(e: CMakePreconditionProblems, isConfiguring: boolean, config?: ConfigurationReader): Promise<boolean> {
        let telemetryEvent: string | undefined;
        const telemetryProperties: telemetry.Properties = {};

        switch (e) {
            case CMakePreconditionProblems.ConfigureIsAlreadyRunning:
                void vscode.window.showErrorMessage(localize('configuration.already.in.progress', 'Configuration is already in progress.'));
                break;
            case CMakePreconditionProblems.BuildIsAlreadyRunning:
                void vscode.window.showErrorMessage(localize('task.already.running', 'A CMake task is already running. Stop it before trying to run a new CMake task.'));
                break;
            case CMakePreconditionProblems.NoSourceDirectoryFound:
                void vscode.window.showErrorMessage(localize('no.source.directory.found', 'You do not have a source directory open'));
                break;
            case CMakePreconditionProblems.MissingCMakeListsFile:
                telemetryEvent = "partialActivation";

                telemetry.logEvent('missingCMakeListsFile');  // Fire this event in case the notification is dismissed with the `ESC` key.

                const ignoreCMakeListsMissing: boolean = this.workspaceContext.state.getIgnoreCMakeListsMissing(this.folderName, this.isMultiProjectFolder) || this.workspaceContext.config.ignoreCMakeListsMissing;
                telemetryProperties["ignoreCMakeListsMissing"] = ignoreCMakeListsMissing.toString();

                if (!ignoreCMakeListsMissing && !this.isMultiProjectFolder) {
                    const existingCmakeListsFiles: string[] | undefined = await util.getAllCMakeListsPaths(this.folderPath);

                    if (existingCmakeListsFiles !== undefined && existingCmakeListsFiles.length > 0) {
                        telemetryProperties["hasCmakeLists"] = "true";
                    } else {
                        telemetryProperties["hasCMakeLists"] = "false";
                    }
                    interface FileItem extends vscode.QuickPickItem {
                        fullPath: string;
                    }
                    const items: FileItem[] = existingCmakeListsFiles ? existingCmakeListsFiles.map<FileItem>(file => ({
                        label: util.getRelativePath(file, this.folderPath) + "/CMakeLists.txt",
                        fullPath: file
                    })) : [];

                    // Sort files by depth. In general the user may want to select the top-most CMakeLists.txt
                    items.sort((a, b) => {
                        const aDepth = a.fullPath.split(path.sep).length;
                        const bDepth = b.fullPath.split(path.sep).length;

                        return aDepth - bDepth;
                    });

                    const browse: string = localize("browse.for.cmakelists", "[Browse for CMakeLists.txt]");
                    const dontAskAgain: string = localize("do.not.ask.again", "[Don't Show Again]");
                    items.push({ label: browse, fullPath: "", description: localize("search.for.cmakelists", "Search for CMakeLists.txt on this computer") });
                    items.push({ label: dontAskAgain, fullPath: "", description: localize("do.not.ask.again.description", "Do not ask for CMakeLists.txt again in this folder. This will enable the cmake.ignoreCMakeListsMissing setting.") });
                    const selection: FileItem | undefined = await vscode.window.showQuickPick(items, {
                        placeHolder: (items.length === 1 ? localize("cmakelists.not.found", "No CMakeLists.txt was found.") : localize("select.cmakelists", "Select CMakeLists.txt"))
                    });
                    telemetryProperties["missingCMakeListsUserAction"] = (selection === undefined) ? "cancel" : (selection.label === browse) ? "browse" : (selection.label === dontAskAgain) ? "dontAskAgain" : "pick";
                    let selectedFile: string | undefined;
                    if (!selection) {
                        break; // User canceled it.
                    } else if (selection.label === browse) {
                        const openOpts: vscode.OpenDialogOptions = {
                            canSelectMany: false,
                            defaultUri: vscode.Uri.file(this.folderPath),
                            filters: { "CMake files": ["txt"], "All files": ["*"] },
                            openLabel: "Load"
                        };
                        const cmakeListsFile = await vscode.window.showOpenDialog(openOpts);
                        if (cmakeListsFile) {
                            // Keep the absolute path for CMakeLists.txt files that are located outside of the workspace folder.
                            selectedFile = cmakeListsFile[0].fsPath;
                        }
                    } else if (selection.label === dontAskAgain)  {
                        await vscode.workspace.getConfiguration('cmake', this.workspaceFolder).update('ignoreCMakeListsMissing', true, vscode.ConfigurationTarget.WorkspaceFolder);
                    } else {
                        // Keep the relative path for CMakeLists.txt files that are located inside of the workspace folder.
                        // selection.label is the relative path to the selected CMakeLists.txt.
                        selectedFile = selection.label;
                    }
                    if (selectedFile) {
                        const newSourceDirectory = path.dirname(selectedFile);
                        await this.setSourceDir(await util.normalizeAndVerifySourceDir(newSourceDirectory, CMakeDriver.sourceDirExpansionOptions(this.workspaceContext.folder.uri.fsPath)));
                        void vscode.workspace.getConfiguration('cmake', this.workspaceFolder.uri).update("sourceDirectory", this._sourceDir);
                        if (config) {
                            // Updating sourceDirectory here, at the beginning of the configure process,
                            // doesn't need to fire the settings change event (which would trigger unnecessarily
                            // another immediate configure, which will be blocked anyway).
                            config.updatePartial({ sourceDirectory: newSourceDirectory }, false);

                            // Since the source directory is set via a file open dialog tuned to CMakeLists.txt,
                            // we know that it exists and we don't need any other additional checks on its value,
                            // so simply enable full feature set.
                            await enableFullFeatureSet(true);

                            if (!isConfiguring) {
                                telemetry.logEvent(telemetryEvent, telemetryProperties);
                                await vscode.commands.executeCommand('cmake.configure');
                                return true;
                            } else {
                                await this.reloadCMakeDriver();
                            }
                        }

                        return true;
                    } else {
                        telemetryProperties["missingCMakeListsUserAction"] = "cancel-browse";
                    }
                }

                break;
        }

        if (telemetryEvent) {
            telemetry.logEvent(telemetryEvent, telemetryProperties);
        }

        // This project folder can go through various changes while executing this function
        // that could be relevant to the partial/full feature set view.
        // This is a good place for an update.
        await updateFullFeatureSet();
        return false;
    }

    /**
     * Start up a new CMake driver and return it. This is so that the initialization
     * of the driver is atomic to those using it
     */
    private async startNewCMakeDriver(cmake: CMakeExecutable): Promise<CMakeDriver> {
        log.debug(localize('starting.cmake.driver', 'Starting CMake driver'));
        if (!cmake.isPresent) {
            throw new Error(localize('bad.cmake.executable', 'Bad CMake executable {0}.', `"${cmake.path}"`));
        }

        const workspace: string = this.workspaceFolder.uri.fsPath;
        let drv: CMakeDriver;
        const preferredGenerators = this.getPreferredGenerators();
        const preConditionHandler = async (e: CMakePreconditionProblems, config?: ConfigurationReader) => this.cmakePreConditionProblemHandler(e, true, config);
        let communicationMode = this.workspaceContext.config.cmakeCommunicationMode.toLowerCase();
        const fileApi = 'fileapi';
        const serverApi = 'serverapi';
        const legacy = 'legacy';

        if (communicationMode !== fileApi && communicationMode !== serverApi && communicationMode !== legacy) {
            if (cmake.isFileApiModeSupported) {
                communicationMode = fileApi;
            } else if (cmake.isServerModeSupported) {
                communicationMode = serverApi;
            } else {
                communicationMode = legacy;
            }
        } else if (communicationMode === fileApi) {
            if (!cmake.isFileApiModeSupported) {
                if (cmake.isServerModeSupported) {
                    communicationMode = serverApi;
                    log.warning(
                        localize('switch.to.serverapi',
                            'CMake file-api communication mode is not supported in versions earlier than {0}. Switching to CMake server communication mode.',
                            versionToString(cmake.minimalFileApiModeVersion)));
                } else {
                    communicationMode = legacy;
                }
            }
        }

        if (communicationMode !== fileApi && communicationMode !== serverApi) {
            log.warning(
                localize('please.upgrade.cmake',
                    'For the best experience, CMake server or file-api support is required. Please upgrade CMake to {0} or newer.',
                    versionToString(cmake.minimalServerModeVersion)));
        }

        try {
            if (communicationMode === serverApi) {
                this.statusMessage.set(localize('starting.cmake.driver.status', 'Starting CMake Server...'));
            }
            switch (communicationMode) {
                case fileApi:
                    drv = await CMakeFileApiDriver.create(cmake,
                        this.workspaceContext.config,
                        this.sourceDir,
                        this.isMultiProjectFolder,
                        this.useCMakePresets,
                        this.activeKit,
                        this.configurePreset,
                        this.buildPreset,
                        this.testPreset,
                        this.packagePreset,
                        this.workflowPreset,
                        workspace,
                        preConditionHandler,
                        preferredGenerators);
                    break;
                case serverApi:
                    drv = await CMakeServerDriver.create(cmake,
                        this.workspaceContext.config,
                        this.sourceDir,
                        this.isMultiProjectFolder,
                        this.useCMakePresets,
                        this.activeKit,
                        this.configurePreset,
                        this.buildPreset,
                        this.testPreset,
                        this.packagePreset,
                        this.workflowPreset,
                        workspace,
                        preConditionHandler,
                        preferredGenerators);
                    break;
                default:
                    drv = await CMakeLegacyDriver.create(cmake,
                        this.workspaceContext.config,
                        this.sourceDir,
                        this.isMultiProjectFolder,
                        this.useCMakePresets,
                        this.activeKit,
                        this.configurePreset,
                        this.buildPreset,
                        this.testPreset,
                        this.packagePreset,
                        this.workflowPreset,
                        workspace,
                        preConditionHandler,
                        preferredGenerators);
            }
        } finally {
            this.statusMessage.set(localize('ready.status', 'Ready'));
        }

        // Set variant in driver when not using presets
        if (!this.useCMakePresets) {
            // Make sure the variant manager is initialized first
            if (!this.variantManager.hasInitialized()) {
                await this.variantManager.initialize(this.folderName);
            }

            await drv.setVariant(this.variantManager.activeVariantOptions, this.variantManager.activeKeywordSetting);
        }

        const newTargetName = this.defaultBuildTarget || (this.useCMakePresets ? this.targetsInPresetName : drv.allTargetName);
        if (this.targetName.value !== newTargetName) {
            this.targetName.set(newTargetName);
        }
        this.cTestController.clearTests(drv);

        // All set up. Fulfill the driver promise.
        return drv;
    }

    public getConfigurationReader(): ConfigurationReader {
        return this.workspaceContext.config;
    }
    /**
     * Event fired after CMake configure runs
     */
    get onReconfigured() {
        return this.onReconfiguredEmitter.event;
    }
    private readonly onReconfiguredEmitter = new vscode.EventEmitter<void>();

    private readonly onTargetChangedEmitter = new vscode.EventEmitter<void>();
    get onTargetChanged() {
        return this.onTargetChangedEmitter.event;
    }

    async executeCMakeCommand(args: string[], options?: ExecutionOptions): Promise<ExecutionResult> {
        const drv = await this.getCMakeDriverInstance();
        if (drv) {
            return drv.executeCommand(drv.cmake.path, args, undefined, options).result;
        } else {
            throw new Error(localize('unable.to.execute.cmake.command', 'Unable to execute cmake command, there is no valid cmake driver instance.'));
        }
    }

    async execute(program: string, args: string[], options?: ExecutionOptions): Promise<ExecutionResult> {
        const drv = await this.getCMakeDriverInstance();
        if (drv) {
            return drv.executeCommand(program, args, undefined, options).result;
        } else {
            throw new Error(localize('unable.to.execute.program', 'Unable to execute program, there is no valid cmake driver instance.'));
        }
    }

    private async shutDownCMakeDriver() {
        const drv = await this.cmakeDriver;
        if (drv) {
            log.debug(localize('shutting.down.driver', 'Shutting down CMake driver'));
            await drv.asyncDispose();
            this.cmakeDriver = Promise.resolve(null);
        }
    }

    /**
     * Reload/restarts the CMake Driver
     */
    private async reloadCMakeDriver() {
        try {
            const drv = await this.cmakeDriver;
            if (drv) {
                log.debug(localize('reloading.driver', 'Reloading CMake driver'));
                await drv?.asyncDispose();
                return this.cmakeDriver = this.startNewCMakeDriver(await this.getCMakeExecutable());
            }
        } catch {
            return this.cmakeDriver = this.startNewCMakeDriver(await this.getCMakeExecutable());
        }
    }

    /**
     * Second phase of two-phase init. Called by `create`.
     */
    private async init(sourceDirectory: string) {
        log.debug(localize('second.phase.init', 'Starting CMake Tools second-phase init'));
        await this.setSourceDir(await util.normalizeAndVerifySourceDir(sourceDirectory, CMakeDriver.sourceDirExpansionOptions(this.workspaceContext.folder.uri.fsPath)));
        this.doStatusChange(this.workspaceContext.config.options);
        // Restore the debug target
        this._launchTargetName.set(this.workspaceContext.state.getLaunchTargetName(this.folderName, this.isMultiProjectFolder) || '');

        // Hook up event handlers
        this.cTestController.onTestingEnabledChanged(enabled => this._ctestEnabled.set(enabled));
        this.cPackageController.onPackagingEnabledChanged(enabled => this._cpackEnabled.set(enabled));

        this.statusMessage.set(localize('ready.status', 'Ready'));

        this.kitsController = await KitsController.init(this);
        this.presetsController = await PresetsController.init(this, this.kitsController, this.isMultiProjectFolder);

        await this.doUseCMakePresetsChange();

        // Only initialize the variant manager when not using presets
        if (!this.useCMakePresets) {
            // Start up the variant manager
            await this.variantManager.initialize(this.folderName);
            // Set the status bar message
            this.activeVariant.set(this.variantManager.activeVariantOptions.short);
        }

        // Listen for the variant to change
        this.variantManager.onActiveVariantChanged(() => {
            log.debug(localize('active.build.variant.changed', 'Active build variant changed'));
            rollbar.invokeAsync(localize('changing.build.variant', 'Changing build variant'), async () => {
                const drv = await this.getCMakeDriverInstance();
                if (drv) {
                    await drv.setVariant(this.variantManager.activeVariantOptions, this.variantManager.activeKeywordSetting);
                    this.activeVariant.set(this.variantManager.activeVariantOptions.short);
                    // We don't configure yet, since someone else might be in the middle of a configure
                }
            });
        });

        this.disposables.push(this.onPresetsChanged(() => this.doUseCMakePresetsChange()));
        this.disposables.push(this.onUserPresetsChanged(() => this.doUseCMakePresetsChange()));
    }

    public async hasPresetsFiles(): Promise<boolean> {
        if (await fs.exists(this.presetsController.presetsPath) || await fs.exists(this.presetsController.userPresetsPath)) {
            return true;
        }
        return false;
    }

    async doUseCMakePresetsChange(useCMakePresets?: string) {
        if (useCMakePresets === undefined) {
            useCMakePresets = this.workspaceContext.config.useCMakePresets;
        }
        this._useCMakePresets = useCMakePresets === 'always' ? true : useCMakePresets === 'never' ? false : await this.hasPresetsFiles();

        const usingCMakePresets = this.useCMakePresets;
        if (usingCMakePresets !== this.wasUsingCMakePresets) {
            this.wasUsingCMakePresets = usingCMakePresets;
            await this.setUseCMakePresets(usingCMakePresets);
            await this.initializeKitOrPresets();
            const config = this.workspaceContext.config;
            if (usingCMakePresets) {
                const setPresetsFileLanguageMode = (document: vscode.TextDocument) => {
                    const fileName = path.basename(document.uri.fsPath);
                    if (util.isFileInsideFolder(document.uri, this.folderPath) && fileName === 'CMakePresets.json' || fileName === 'CMakeUserPresets.json') {
                        if (config.allowCommentsInPresetsFile && document.languageId !== 'jsonc') {
                            // setTextDocumentLanguage will trigger onDidOpenTextDocument
                            void vscode.languages.setTextDocumentLanguage(document, 'jsonc');
                        } else if (!config.allowCommentsInPresetsFile && document.languageId !== 'json') {
                            void vscode.languages.setTextDocumentLanguage(document, 'json');
                        }
                    }
                };

                this.onDidOpenTextDocumentListener = vscode.workspace.onDidOpenTextDocument(document =>
                    setPresetsFileLanguageMode(document)
                );

                vscode.workspace.textDocuments.forEach(document => setPresetsFileLanguageMode(document));
            } else {
                if (this.onDidOpenTextDocumentListener) {
                    this.onDidOpenTextDocumentListener.dispose();
                    this.onDidOpenTextDocumentListener = undefined;
                }
            }

            this.onUseCMakePresetsChangedEmitter.fire(usingCMakePresets);
        }
    }
    /**
     * Call configurePresets, buildPresets, testPresets, packagePresets or workflowPresets to get the latest presets when the event is fired.
     */
    onPresetsChanged(listener: () => any) {
        return this.presetsController.onPresetsChanged(listener);
    }

    /**
     * Call configurePresets, buildPresets, testPresets, packagePresets or workflowPresets to get the latest presets when the event is fired.
     */
    onUserPresetsChanged(listener: () => any) {
        return this.presetsController.onUserPresetsChanged(listener);
    }

    async initializeKitOrPresets() {
        if (this.useCMakePresets) {
            const latestConfigPresetName = this.workspaceContext.state.getConfigurePresetName(this.folderName, this.isMultiProjectFolder);
            if (latestConfigPresetName) {
                // Check if the latest configurePresetName from the previous session is still valid.
                const presets = await this.presetsController.getAllConfigurePresets();
                const latestConfigPreset: preset.ConfigurePreset | undefined = presets.find(preset => preset.name === latestConfigPresetName);
                if (latestConfigPreset && !latestConfigPreset.hidden) {
                    await this.presetsController.setConfigurePreset(latestConfigPresetName);
                }
            }
        } else {
            // Check if the CMakeProject remembers what kit it was last using in this dir:
            const kitName = this.workspaceContext.state.getActiveKitName(this.folderName, this.isMultiProjectFolder);
            if (kitName) {
                // It remembers a kit. Find it in the kits avail in this dir:
                const kit = this.kitsController.availableKits.find(k => k.name === kitName) || null;
                // Set the kit: (May do nothing if no kit was found)
                await this.setKit(kit);
            }
        }
    }

    async isNinjaInstalled(): Promise<boolean> {
        const drv = await this.cmakeDriver;

        if (drv) {
            return await drv.testHaveCommand('ninja') || drv.testHaveCommand('ninja-build');
        }

        return false;
    }

    async setKit(kit: Kit | null) {
        this._activeKit = kit;
        if (kit) {
            log.debug(localize('injecting.new.kit', 'Injecting new Kit into CMake driver'));
            const drv = await this.cmakeDriver;  // Use only an existing driver, do not create one
            if (drv) {
                try {
                    this.statusMessage.set(localize('reloading.status', 'Reloading...'));
                    await drv.setKit(kit, this.getPreferredGenerators());
                    await this.workspaceContext.state.setActiveKitName(this.folderName, kit.name, this.isMultiProjectFolder);
                    this.statusMessage.set(localize('ready.status', 'Ready'));
                } catch (error: any) {
                    void vscode.window.showErrorMessage(localize('unable.to.set.kit', 'Unable to set kit {0}.', `"${error.message}"`));
                    this.statusMessage.set(localize('error.on.switch.status', 'Error on switch of kit ({0})', error.message));
                    this.cmakeDriver = Promise.resolve(null);
                    this._activeKit = null;
                }
            } else {
                // Remember the selected kit for the next session.
                await this.workspaceContext.state.setActiveKitName(this.folderName, kit.name, this.isMultiProjectFolder);
            }
        }
    }

    async getCMakePathofProject(): Promise<string> {
        const overWriteCMakePathSetting = this.useCMakePresets ? this.configurePreset?.cmakeExecutable : undefined;
        return await this.workspaceContext.getCMakePath(overWriteCMakePathSetting) || '';
    }

    async getCMakeExecutable() {
        const cmakePath: string = await this.getCMakePathofProject();
        const cmakeExe = await getCMakeExecutableInformation(cmakePath);
        if (cmakeExe.version && this.minCMakeVersion && versionLess(cmakeExe.version, this.minCMakeVersion)) {
            rollbar.error(localize('cmake.version.not.supported',
                'CMake version {0} may not be supported. Minimum version required is {1}.',
                versionToString(cmakeExe.version),
                versionToString(this.minCMakeVersion)));
        }
        return cmakeExe;
    }

    /**
     * Returns, if possible a cmake driver instance. To creation the driver instance,
     * there are preconditions that should be fulfilled, such as an active kit is selected.
     * These preconditions are checked before it driver instance creation. When creating a
     * driver instance, this function waits until the driver is ready before returning.
     * This ensures that user commands can always be executed, because error criterials like
     * exceptions would assign a null driver and it is possible to create a new driver instance later again.
     */
    async getCMakeDriverInstance(): Promise<CMakeDriver | null> {
        return this.driverStrand.execute(async () => {
            if (!this.useCMakePresets && !this.activeKit) {
                log.debug(localize('not.starting.no.kits', 'Not starting CMake driver: no kit selected'));
                return null;
            }

            const cmake = await this.getCMakeExecutable();
            if (!cmake.isPresent) {
                void vscode.window.showErrorMessage(localize('bad.executable', 'Bad CMake executable: {0}. Check to make sure it is installed or the value of the {1} setting contains the correct path', `"${cmake.path}"`, '"cmake.cmakePath"'));
                telemetry.logEvent('CMakeExecutableNotFound');
                return null;
            }

            if ((await this.cmakeDriver) === null) {
                log.debug(localize('starting.new.cmake.driver', 'Starting new CMake driver'));
                this.cmakeDriver = this.startNewCMakeDriver(cmake);

                try {
                    await this.cmakeDriver;
                } catch (e: any) {
                    this.cmakeDriver = Promise.resolve(null);
                    if (e instanceof BadHomeDirectoryError) {
                        void vscode.window
                            .showErrorMessage(
                                localize('source.directory.does.not.match', 'The source directory {0} does not match the source directory in the CMake cache: {1}.  You will need to run a clean-configure to configure this project.', `"${e.expecting}"`, e.cached),
                                {},
                                { title: localize('clean.configure.title', 'Clean Configure') }
                            )
                            .then(chosen => {
                                if (chosen) {
                                    // There was only one choice: to clean-configure
                                    rollbar.invokeAsync(localize('clean.reconfigure.after.bad.home.dir', 'Clean reconfigure after bad home dir'), async () => {
                                        try {
                                            await fs.unlink(e.badCachePath);
                                        } catch (e2: any) {
                                            log.error(localize('failed.to.remove.bad.cache.file', 'Failed to remove bad cache file: {0} {1}', e.badCachePath, e2));
                                        }
                                        try {
                                            await fs.rmdir(path.join(path.dirname(e.badCachePath), 'CMakeFiles'));
                                        } catch (e2: any) {
                                            log.error(localize('failed.to.remove.cmakefiles.for.cache', 'Failed to remove CMakeFiles for cache: {0} {1}', e.badCachePath, e2));
                                        }
                                        await this.cleanConfigure(ConfigureTrigger.badHomeDir);
                                    });
                                }
                            });
                    } else if (e instanceof NoGeneratorError) {
                        const message = localize('generator.not.found', 'Unable to determine what CMake generator to use. Please install or configure a preferred generator, or update settings.json, your Kit configuration or PATH variable.');
                        log.error(message, e);
                        void vscode.window.showErrorMessage(message);
                    } else {
                        throw e;
                    }
                    return null;
                }

                if (this.codeModelDriverSub) {
                    this.codeModelDriverSub.dispose();
                }
                const drv = await this.cmakeDriver;
                console.assert(drv !== null, 'Null driver immediately after creation?');
                if (drv && !(drv instanceof CMakeLegacyDriver)) {
                    this.codeModelDriverSub = drv.onCodeModelChanged(cm => this._codeModelContent.set(cm));
                }
            }

            return this.cmakeDriver;
        });
    }

    /**
     * Create an instance asynchronously
     * @param extensionContext The extension context
     * @param projectController Required for test explorer to work properly. Setting as optional to avoid breaking tests.
     *
     * The purpose of making this the only way to create an instance is to prevent
     * us from creating uninitialized instances of the CMake Tools extension.
     */
    static async create(workspaceContext: DirectoryContext, sourceDirectory: string, projectController?: ProjectController, isMultiProjectFolder?: boolean): Promise<CMakeProject> {
        log.debug(localize('safely.constructing.cmakeproject', 'Safe constructing new CMakeProject instance'));
        const inst = new CMakeProject(workspaceContext, projectController, isMultiProjectFolder);
        await inst.init(sourceDirectory);
        log.debug(localize('initialization.complete', 'CMakeProject instance initialization complete.'));
        return inst;
    }

    private _activeKit: Kit | null = null;
    get activeKit(): Kit | null {
        return this._activeKit;
    }

    /**
     * The compilation database for this driver.
     */
    private compilationDatabase: CompilationDatabase | null = null;

    private async refreshCompileDatabase(opts: ExpansionOptions): Promise<void> {
        const compdbPaths: string[] = [];
        if (this.workspaceContext.config.mergedCompileCommands && this.workspaceContext.config.copyCompileCommands) {
            log.warning(localize('merge.and.copy.compile.commands', "The {0} setting is ignored when {1} is defined.", 'cmake.copyCompileCommands', 'cmake.mergedCompileCommands'));
        }

        if (this.workspaceContext.config.mergedCompileCommands) {
            // recursively search the build directory for all
            const searchRoot = await this.binaryDir;
            if (await fs.exists(searchRoot)) {
                (await fs.walk(searchRoot)).forEach(e => {
                    if (e.name === 'compile_commands.json') {
                        compdbPaths.push(e.path);
                    }
                });
            }
        } else {
            // single file with known path
            const compdbPath = path.join(await this.binaryDir, 'compile_commands.json');
            if (await fs.exists(compdbPath)) {
                compdbPaths.push(compdbPath);
                if (this.workspaceContext.config.copyCompileCommands) {
                    // Now try to copy the compdb to the user-requested path
                    const copyDest = this.workspaceContext.config.copyCompileCommands;
                    const expandedDest = await expandString(copyDest, opts);
                    if (compdbPath !== expandedDest) {
                        const parentDir = path.dirname(expandedDest);
                        try {
                            log.debug(localize('copy.compile.commands', 'Copying {2} from {0} to {1}', compdbPath, expandedDest, 'compile_commands.json'));
                            await fs.mkdir_p(parentDir);
                            try {
                                await fs.copyFile(compdbPath, expandedDest);
                            } catch (e: any) {
                                // Just display the error. It's the best we can do.
                                void vscode.window.showErrorMessage(localize('failed.to.copy', 'Failed to copy {0} to {1}: {2}', `"${compdbPath}"`, `"${expandedDest}"`, e.toString()));
                            }
                        } catch (e: any) {
                            void vscode.window.showErrorMessage(localize('failed.to.create.parent.directory.1',
                                'Tried to copy {0} to {1}, but failed to create the parent directory {2}: {3}',
                                `"${compdbPath}"`, `"${expandedDest}"`, `"${parentDir}"`, e.toString()));
                        }
                    }
                }
            } else if (this.workspaceContext.config.copyCompileCommands) {
                log.debug(localize('cannot.copy.compile.commands', 'Cannot copy {1} because it does not exist at {0}', compdbPath, 'compile_commands.json'));
            }
        }
        if (!this.workspaceContext.config.loadCompileCommands) {
            this.compilationDatabase = null;
        } else if (compdbPaths.length > 0) {
            try {
                // Read the compilation database, and update our db property
                const newDB = await CompilationDatabase.fromFilePaths(compdbPaths);
                this.compilationDatabase = newDB;
                // Now try to dump the compdb to the user-requested path
                const mergeDest = this.workspaceContext.config.mergedCompileCommands;
                if (!mergeDest) {
                    return;
                }
                let expandedDest = await expandString(mergeDest, opts);
                const pardir = path.dirname(expandedDest);
                try {
                    await fs.mkdir_p(pardir);
                } catch (e: any) {
                    void vscode.window.showErrorMessage(localize('failed.to.create.parent.directory.2',
                        'Tried to copy compilation database to {0}, but failed to create the parent directory {1}: {2}',
                        `"${expandedDest}"`, `"${pardir}"`, e.toString()));
                    return;
                }
                if (await fs.exists(expandedDest) && (await fs.stat(expandedDest)).isDirectory()) {
                    // Emulate the behavior of copyFile() with writeFile() so that
                    // mergedCompileCommands works like copyCompileCommands for
                    // target paths which lead to existing directories.
                    expandedDest = path.join(expandedDest, "merged_compile_commands.json");
                }
                try {
                    await fs.writeFile(expandedDest, CompilationDatabase.toJson(newDB));
                } catch (e: any) {
                    // Just display the error. It's the best we can do.
                    void vscode.window.showErrorMessage(localize('failed.to.merge', 'Failed to write merged compilation database to {0}: {1}', `"${expandedDest}"`, e.toString()));
                    return;
                }
            } catch (e: any) {
                // Just display the error. It's the best we can do.
                void vscode.window.showErrorMessage(localize('load.compile.commands', 'Failed while trying to ingest the compile_commands.json: {0}', e.toString()));
                return;
            }
        }
    }

    /**
     * Implementation of `cmake.configure`
     * trigger: describes the circumstance that caused this configure to be run.
     *          In order to avoid a breaking change in the CMake Tools API,
     *          this parameter can default to that scenario.
     *          All other configure calls in this extension are able to provide
     *          proper trigger information.
     */
    configure(extraArgs: string[] = []): Thenable<ConfigureResult> {
        return this.configureInternal(ConfigureTrigger.api, extraArgs, ConfigureType.Normal);
    }

    async configureInternal(trigger: ConfigureTrigger = ConfigureTrigger.api, extraArgs: string[] = [], type: ConfigureType = ConfigureType.Normal, debuggerInformation?: DebuggerInformation): Promise<ConfigureResult> {
        const drv: CMakeDriver | null = await this.getCMakeDriverInstance();

        // Don't show a progress bar when the extension is using Cache for configuration.
        // Using cache for configuration happens only one time.
        if (drv && drv.shouldUseCachedConfiguration(trigger)) {
            const result: ConfigureResult = await drv.configure(trigger, []);
            if (result.result === 0) {
                await this.refreshCompileDatabase(drv.expansionOptions);
            } else {
                log.showChannel(true);
            }
            await this.cTestController.refreshTests(drv);
            this.onReconfiguredEmitter.fire();
            return result;
        }

        if (trigger === ConfigureTrigger.configureWithCache) {
            log.debug(localize('no.cache.available', 'Unable to configure with existing cache'));
            return { result: -1, resultType: ConfigureResultType.NoCache };
        }

        const res = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Window,
                title: localize('configuring.project', 'Configuring project'),
                cancellable: true
            },
            async (progress, cancel) => {
                progress.report({ message: localize('preparing.to.configure', 'Preparing to configure') });
                const cancelInformation: ConfigureCancelInformation = {
                    canceled: false
                };
                cancel.onCancellationRequested(() => {
                    // We need to update the canceled information by reference before starting the cancel to ensure it's updated before the process is cancelled.
                    cancelInformation.canceled = true;
                    rollbar.invokeAsync(localize('stop.on.cancellation', 'Stop on cancellation'), () => this.cancelConfiguration());
                });

                let forciblyCanceled: boolean = false;

                // if there is a debugger information, we are debugging. Set up a listener for stopping a cmake debug session.
                if (debuggerInformation) {
                    const trackerFactoryDisposable = vscode.debug.registerDebugAdapterTrackerFactory("cmake", new DebugTrackerFactory(async () => {
                        // We need to update the canceled information by reference before starting the cancel to ensure it's updated before the process is cancelled.
                        cancelInformation.canceled = true;
                        forciblyCanceled = true;
                        await this.cancelConfiguration();
                        trackerFactoryDisposable.dispose();
                    }));
                }

                if (type !== ConfigureType.ShowCommandOnly) {
                    log.info(localize('run.configure', 'Configuring project: {0}', this.folderName), extraArgs);
                }

                try {
                    return this.doConfigure(type, progress, async consumer => {
                        const isConfiguringKey = 'cmake:isConfiguring';
                        if (drv) {
                            let oldProgress = 0;
                            const progressSub = drv.onProgress(pr => {
                                const newProgress = 100 * (pr.progressCurrent - pr.progressMinimum) / (pr.progressMaximum - pr.progressMinimum);
                                const increment = newProgress - oldProgress;
                                if (increment >= 1) {
                                    oldProgress += increment;
                                    progress.report({ increment });
                                }
                            });
                            try {
                                progress.report({ message: this.folderName });
                                let result: ConfigureResult;
                                await setContextAndStore(isConfiguringKey, true);
                                if (type === ConfigureType.Cache) {
                                    result = await drv.configure(trigger, [], consumer, cancelInformation, debuggerInformation);
                                } else {
                                    switch (type) {
                                        case ConfigureType.Normal:
                                            result = await drv.configure(trigger, extraArgs, consumer, cancelInformation);
                                            break;
                                        case ConfigureType.NormalWithDebugger:
                                            result = await drv.configure(trigger, extraArgs, consumer, cancelInformation, debuggerInformation);
                                            break;
                                        case ConfigureType.Clean:
                                            result = await drv.cleanConfigure(trigger, extraArgs, consumer, cancelInformation);
                                            break;
                                        case ConfigureType.CleanWithDebugger:
                                            result = await drv.cleanConfigure(trigger, extraArgs, consumer, cancelInformation, debuggerInformation);
                                            break;
                                        case ConfigureType.ShowCommandOnly:
                                            result = await drv.configure(trigger, extraArgs, consumer, cancelInformation, undefined, false, true);
                                            break;
                                        default:
                                            rollbar.error(localize('unexpected.configure.type', 'Unexpected configure type'), { type });
                                            result = await this.configureInternal(trigger, extraArgs, ConfigureType.Normal);
                                            break;
                                    }
                                    await setContextAndStore(isConfiguringKey, false);
                                }

                                const cmakeConfiguration = vscode.workspace.getConfiguration('cmake');
                                const showDebuggerConfigurationString = "showConfigureWithDebuggerNotification";

                                if (result.result === 0) {
                                    await enableFullFeatureSet(true);
                                    await this.refreshCompileDatabase(drv.expansionOptions);
                                } else if (result.result !== 0 && (await this.getCMakeExecutable()).isDebuggerSupported && cmakeConfiguration.get(showDebuggerConfigurationString) && !forciblyCanceled && !cancelInformation.canceled && result.resultType === ConfigureResultType.NormalOperation) {
                                    log.showChannel(true);
                                    const yesButtonTitle: string = localize(
                                        "yes.configureWithDebugger.button",
                                        "Debug"
                                    );
                                    const doNotShowAgainTitle = localize('options.configureWithDebuggerOnFail.do.not.show', "Don't Show Again");
                                    void vscode.window.showErrorMessage<MessageItem>(
                                        localize('configure.failed.tryWithDebugger', 'Configure failed. Would you like to attempt to configure with the CMake Debugger?'),
                                        {title: yesButtonTitle},
                                        {title: localize('no.configureWithDebugger.button', 'Cancel')},
                                        {title: doNotShowAgainTitle})
                                        .then(async chosen => {
                                            if (chosen) {
                                                if (chosen.title === yesButtonTitle) {
                                                    await vscode.debug.startDebugging(undefined, {
                                                        name: localize("cmake.debug.name", "CMake Debugger"),
                                                        request: "launch",
                                                        type: "cmake",
                                                        cmakeDebugType: "configure",
                                                        pipeName: getDebuggerPipeName(),
                                                        trigger: ConfigureTrigger.configureFailedConfigureWithDebuggerButton,
                                                        fromCommand: true
                                                    });
                                                } else if (chosen.title === doNotShowAgainTitle) {
                                                    await cmakeConfiguration.update(showDebuggerConfigurationString, false, vscode.ConfigurationTarget.Global);
                                                }
                                            }
                                        });
                                }

                                await this.cTestController.refreshTests(drv);
                                this.onReconfiguredEmitter.fire();
                                return result;
                            } finally {
                                await setContextAndStore(isConfiguringKey, false);
                                progress.report({ message: localize('finishing.configure', 'Finishing configure') });
                                progressSub.dispose();
                            }
                        } else {
                            progress.report({ message: localize('configure.failed', 'Failed to configure project') });
                            return { result: -1, resultType: ConfigureResultType.NormalOperation };
                        }
                    });
                } catch (e: any) {
                    const error = e as Error;
                    progress.report({ message: error.message });
                    return { result: -1, resultType: ConfigureResultType.NormalOperation };
                }
            }
        );
        // check if the an error occured during the configuration
        if (res.result !== 0) {
            log.showChannel(true);
        }
        return res;
    }

    /**
     * Implementation of `cmake.cleanConfigure()`
     * trigger: describes the circumstance that caused this configure to be run.
     *          In order to avoid a breaking change in the CMake Tools API,
     *          this parameter can default to that scenario.
     *          All other configure calls in this extension are able to provide
     *          proper trigger information.
     */
    cleanConfigure(trigger: ConfigureTrigger = ConfigureTrigger.api) {
        return this.configureInternal(trigger, [], ConfigureType.Clean);
    }

    /**
     * Implementation of `cmake.cleanConfigureWithDebugger()`
     * trigger: describes the circumstance that caused this configure to be run.
     *          In order to avoid a breaking change in the CMake Tools API,
     *          this parameter can default to that scenario.
     *          All other configure calls in this extension are able to provide
     *          proper trigger information.
     */
    cleanConfigureWithDebugger(trigger: ConfigureTrigger = ConfigureTrigger.api, debuggerInformation?: DebuggerInformation) {
        return this.configureInternal(trigger, [], ConfigureType.CleanWithDebugger, debuggerInformation);
    }

    /**
     * Save all open files. "maybe" because the user may have disabled auto-saving
     * with `config.saveBeforeBuild`.
     */
    async maybeAutoSaveAll(showCommandOnly?: boolean): Promise<boolean> {
        // Save open files before we configure/build
        if (this.workspaceContext.config.saveBeforeBuild) {
            if (!showCommandOnly) {
                log.debug(localize('saving.open.files.before', 'Saving open files before configure/build'));
            }

            const cmakeConfiguration = vscode.workspace.getConfiguration('cmake');
            const showSaveFailedNotificationString = "showNotAllDocumentsSavedQuestion";

            const saveGood = await vscode.workspace.saveAll();
            if (!saveGood && cmakeConfiguration.get(showSaveFailedNotificationString)) {
                log.debug(localize('saving.open.files.failed', 'Saving open files failed'));
                const yesButtonTitle: string = localize('yes.button', 'Yes');
                const yesAndDoNotShowAgain: string = localize('do.not.show.not.saved.again', "Yes (don't show again)");
                const chosen =
                    await vscode.window.showErrorMessage<vscode.MessageItem>(
                        localize(
                            "not.saved.continue.anyway",
                            "Not all open documents were saved. Would you like to continue anyway?"
                        ),
                        {
                            title: yesButtonTitle,
                            isCloseAffordance: false
                        },
                        {
                            title: yesAndDoNotShowAgain,
                            isCloseAffordance: false
                        },
                        {
                            title: localize("no.button", "No"),
                            isCloseAffordance: true
                        }
                    );

                if (chosen?.title === yesAndDoNotShowAgain) {
                    await cmakeConfiguration.update(showSaveFailedNotificationString, false, vscode.ConfigurationTarget.Global);
                }
                return chosen !== undefined && (chosen.title === yesButtonTitle || chosen.title === yesAndDoNotShowAgain);
            }
        }
        return true;
    }

    /**
     * Wraps pre/post configure logic around an actual configure function
     * @param cb The actual configure callback. Called to do the configure
     */
    private async doConfigure(type: ConfigureType, progress: ProgressHandle, cb: (consumer: CMakeOutputConsumer) => Promise<ConfigureResult>): Promise<ConfigureResult> {
        progress.report({ message: localize('saving.open.files', 'Saving open files') });
        if (!await this.maybeAutoSaveAll(type === ConfigureType.ShowCommandOnly)) {
            return { result: -1, resultType: ConfigureResultType.Other };
        }
        if (!this.useCMakePresets) {
            if (!this.activeKit) {
                await vscode.window.showErrorMessage(localize('cannot.configure.no.kit', 'Cannot configure: No kit is active for this CMake project'));
                log.debug(localize('no.kit.abort', 'No kit selected. Abort configure'));
                return { result: -1, resultType: ConfigureResultType.Other };
            }
            // Make sure variant manager has initialized before checking for variant
            if (!this.variantManager.hasInitialized()) {
                await this.variantManager.initialize(this.folderName);
            }
            if (!this.variantManager.haveVariant) {
                progress.report({ message: localize('waiting.on.variant', 'Waiting on variant selection') });
                await this.variantManager.selectVariant();
                if (!this.variantManager.haveVariant) {
                    log.debug(localize('no.variant.abort', 'No variant selected. Abort configure'));
                    return { result: -1, resultType: ConfigureResultType.Other };
                }
            }
        } else if (!this.configurePreset) {
            await vscode.window.showErrorMessage(localize('cannot.configure.no.config.preset', 'Cannot configure: No configure preset is active for this CMake project'));
            log.debug(localize('no.preset.abort', 'No preset selected. Abort configure'));
            return { result: -1, resultType: ConfigureResultType.Other };
        }
        log.showChannel();
        const consumer = new CMakeOutputConsumer(this.sourceDir, cmakeLogger);
        const result = await cb(consumer);
        populateCollection(collections.cmake, consumer.diagnostics);
        return result;
    }

    /**
     * Get the name of the "all" target; that is, the target name for which CMake
     * will build all default targets.
     *
     * This is required because simply using `all` as the target name is incorrect
     * for some generators, such as Visual Studio and Xcode.
     *
     * This is async because it depends on checking the active generator name
     */
    get allTargetName() {
        return this.allTargetNameAsync();
    }
    private async allTargetNameAsync(): Promise<string> {
        const drv = await this.getCMakeDriverInstance();
        if (drv) {
            return drv.allTargetName;
        } else {
            if (!this.useCMakePresets && !this.activeKit) {
                return localize('targets.status', '[N/A - Select Kit]');
            }
            return '';
        }
    }

    /**
     * Check if the current project needs to be (re)configured
     */
    private async needsReconfigure(): Promise<boolean> {
        const drv = await this.getCMakeDriverInstance();
        if (!drv) {
            return true;
        }

        let needsReconfigure: boolean = await drv.checkNeedsReconfigure();
        if (!needsReconfigure && !await fs.exists(drv.binaryDir)) {
            needsReconfigure = true;
            log.info(localize('cmake.cache.dir.missing', 'The folder containing the CMake cache is missing. The cache will be regenerated.'));
        }

        const skipConfigureIfCachePresent = this.workspaceContext.config.skipConfigureIfCachePresent;
        if (skipConfigureIfCachePresent && needsReconfigure && await fs.exists(drv.cachePath)) {
            log.info(localize(
                'warn.skip.configure.if.cache.present',
                'The extension determined that a configuration is needed at this moment but we are skipping because the setting cmake.skipConfigureIfCachePresent is ON. Make sure the CMake cache is in sync with the latest configuration changes.'));
            return false;
        }

        return needsReconfigure;
    }

    async ensureConfigured(): Promise<number | null> {
        const drv = await this.getCMakeDriverInstance();
        if (!drv) {
            return null;
        }
        // First, save open files
        if (!await this.maybeAutoSaveAll()) {
            return -1;
        }
        if (await this.needsReconfigure()) {
            return (await this.configureInternal(ConfigureTrigger.compilation, [], ConfigureType.Normal)).result;
        } else {
            return 0;
        }
    }

    // Reconfigure if the saved file is a cmake file.
    async doCMakeFileChangeReconfigure(uri: vscode.Uri) {
        const filePath = util.platformNormalizePath(uri.fsPath);
        const driver: CMakeDriver | null = await this.getCMakeDriverInstance();

        // If we detect a change in the CMake cache file, refresh the webview
        if (this.cacheEditorWebview && driver && filePath === util.platformNormalizePath(driver.cachePath)) {
            await this.cacheEditorWebview.refreshPanel();
        }

        const sourceDirectory = util.platformNormalizePath(this.sourceDir);

        let isCmakeFile: boolean;
        if (driver && driver.cmakeFiles.length > 0) {
            // If CMake file information is available from the driver, use it
            isCmakeFile = driver.cmakeFiles.some(f => filePath === util.platformNormalizePath(path.resolve(this.sourceDir, f)));
        } else {
            // Otherwise, fallback to a simple check (does not cover CMake include files)
            isCmakeFile = false;
            if (filePath.endsWith("cmakelists.txt")) {
                const allcmakelists: string[] | undefined = await util.getAllCMakeListsPaths(this.folderPath);
                // Look for the CMakeLists.txt files that are in the sourceDirectory root.
                isCmakeFile = (filePath === path.join(sourceDirectory, "cmakelists.txt")) ||
                    (allcmakelists?.find(file => filePath === util.platformNormalizePath(file)) !== undefined);
            }
        }

        if (isCmakeFile) {
            // CMakeLists.txt change event: its creation or deletion are relevant,
            // so update full/partial feature set view for this folder.
            await updateFullFeatureSet();
            if (driver && !driver.configOrBuildInProgress()) {
                if (driver.config.configureOnEdit) {
                    log.debug(localize('cmakelists.save.trigger.reconfigure', "Detected saving of CMakeLists.txt, attempting automatic reconfigure..."));
                    if (this.workspaceContext.config.clearOutputBeforeBuild) {
                        log.clearOutputChannel();
                    }
                    await this.configureInternal(ConfigureTrigger.cmakeListsChange, [], ConfigureType.Normal);
                }
            } else {
                log.warning(localize('cmakelists.save.could.not.reconfigure',
                    'Changes were detected in CMakeLists.txt but we could not reconfigure the project because another operation is already in progress.'));
                log.debug(localize('needs.reconfigure', 'The project needs to be reconfigured so that the changes saved in CMakeLists.txt have effect.'));
            }
        }
    }

    async tasksBuildCommandDrv(drv: CMakeDriver): Promise<string | null> {
        const targets = await this.getDefaultBuildTargets();
        const buildargs = await drv.getCMakeBuildCommand(targets || undefined);
        return (buildargs) ? buildCmdStr(buildargs.command, buildargs.args) : null;
    }

    /**
     * Implementation of `cmake.tasksBuildCommand`
     */
    async tasksBuildCommand(): Promise<string | null> {
        const drv = await this.getCMakeDriverInstance();
        return drv ? this.tasksBuildCommandDrv(drv) : null;
    }

    private activeBuild: Promise<number> = Promise.resolve(0);

    /**
     * Implementation of `cmake.build`
     */
    async runBuild(targets?: string[], showCommandOnly?: boolean, taskConsumer?: proc.OutputConsumer, isBuildCommand?: boolean): Promise<number> {
        if (!showCommandOnly) {
            log.info(localize('run.build', 'Building folder: {0}', await this.binaryDir || this.folderName), (targets && targets.length > 0) ? targets.join(', ') : '');
        }
        let drv: CMakeDriver | null;
        if (showCommandOnly) {
            drv = await this.getCMakeDriverInstance();
            if (!drv) {
                throw new Error(localize('failed.to.get.cmake.driver', 'Failed to get CMake driver'));
            }
            const buildCmd = await drv.getCMakeBuildCommand(targets || await this.getDefaultBuildTargets());
            if (buildCmd) {
                log.showChannel();
                log.info(buildCmdStr(buildCmd.command, buildCmd.args));
            } else {
                throw new Error(localize('failed.to.get.build.command', 'Failed to get build command'));
            }
            return 0;
        }

        const configResult = await this.ensureConfigured();
        if (configResult === null) {
            throw new Error(localize('unable.to.configure', 'Build failed: Unable to configure the project'));
        } else if (configResult !== 0) {
            return configResult;
        }
        drv = await this.getCMakeDriverInstance();
        if (!drv) {
            throw new Error(localize('driver.died.after.successful.configure', 'CMake driver died immediately after successful configure'));
        }
        let newTargets = targets;
        let targetName: string;
        const defaultBuildTargets = await this.getDefaultBuildTargets();
        if (this.useCMakePresets) {
            newTargets = (newTargets && newTargets.length > 0) ? newTargets : defaultBuildTargets;
            targetName = `${this.buildPreset?.displayName || this.buildPreset?.name || ''}${newTargets ? (': ' + newTargets.join(', ')) : ''}`;
            targetName = targetName || this.buildPreset?.displayName || this.buildPreset?.name || '';
        } else {
            newTargets = (newTargets && newTargets.length > 0) ? newTargets : defaultBuildTargets!;
            targetName = newTargets.join(', ');
        }

        let consumer: CMakeBuildConsumer | undefined;
        const isBuildingKey = 'cmake:isBuilding';
        try {
            this.statusMessage.set(localize('building.status', 'Building'));
            this.isBusy.set(true);
            let rc: number | null;
            if (taskConsumer) {
                buildLogger.info(localize('starting.build', 'Starting build'));
                await setContextAndStore(isBuildingKey, true);
                rc = await drv!.build(newTargets, taskConsumer, isBuildCommand);
                if (rc !== 0) {
                    log.showChannel(true); // in case build has failed
                }
                await setContextAndStore(isBuildingKey, false);
                if (rc === null) {
                    buildLogger.info(localize('build.was.terminated', 'Build was terminated'));
                } else {
                    buildLogger.info(localize('build.finished.with.code', 'Build finished with exit code {0}', rc));
                }
                return rc === null ? -1 : rc;
            } else {
                consumer = new CMakeBuildConsumer(buildLogger, drv.config);
                return await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Window,
                        title: localize('building.target', 'Building: {0}', targetName),
                        cancellable: true
                    },
                    async (progress, cancel) => {
                        let oldProgress = 0;
                        consumer!.onProgress(pr => {
                            const increment = pr.value - oldProgress;
                            if (increment >= 1) {
                                progress.report({ increment, message: `${pr.value}%` });
                                oldProgress += increment;
                            }
                        });
                        cancel.onCancellationRequested(() => rollbar.invokeAsync(localize('stop.on.cancellation', 'Stop on cancellation'), () => this.stop()));
                        log.showChannel();
                        buildLogger.info(localize('starting.build', 'Starting build'));
                        await setContextAndStore(isBuildingKey, true);
                        const rc = await drv!.build(newTargets, consumer, isBuildCommand);
                        await setContextAndStore(isBuildingKey, false);
                        if (rc !== 0) {
                            log.showChannel(true); // in case build has failed
                        }
                        if (rc === null) {
                            buildLogger.info(localize('build.was.terminated', 'Build was terminated'));
                        } else {
                            buildLogger.info(localize('build.finished.with.code', 'Build finished with exit code {0}', rc));
                        }
                        const fileDiags: FileDiagnostic[] | undefined = drv!.config.parseBuildDiagnostics ? await consumer!.compileConsumer.resolveDiagnostics(drv!.binaryDir, drv!.sourceDir) : [];
                        if (fileDiags) {
                            populateCollection(collections.build, fileDiags);
                        }
                        await this.refreshCompileDatabase(drv!.expansionOptions);
                        return rc === null ? -1 : rc;
                    }
                );
            }
        } finally {
            await setContextAndStore(isBuildingKey, false);
            this.statusMessage.set(localize('ready.status', 'Ready'));
            this.isBusy.set(false);
            if (consumer) {
                consumer.dispose();
            }
        }
    }
    /**
     * Implementation of `cmake.build`
     */
    async build(targets?: string[], showCommandOnly?: boolean, isBuildCommand: boolean = true): Promise<number> {
        this.activeBuild = this.runBuild(targets, showCommandOnly, undefined, isBuildCommand);
        return this.activeBuild;
    }

    /**
     * Attempt to execute the compile command associated with the file. If it
     * fails for _any reason_, returns `null`. Otherwise returns the terminal in
     * which the compilation is running
     * @param filePath The path to a file to try and compile
     */
    async tryCompileFile(filePath: string): Promise<vscode.Terminal | null> {
        const configResult = await this.ensureConfigured();
        if (configResult === null || configResult !== 0) {
            // Config failed?
            return null;
        }
        if (!this.compilationDatabase) {
            return null;
        }
        const cmd = this.compilationDatabase.get(filePath);
        if (!cmd) {
            return null;
        }
        const drv = await this.getCMakeDriverInstance();
        if (!drv) {
            return null;
        }
        return drv.runCompileCommand(cmd);
    }

    async editCache(): Promise<void> {
        const drv = await this.getCMakeDriverInstance();
        if (!drv) {
            void vscode.window.showErrorMessage(localize('set.up.before.edit.cache', 'Set up your CMake project before trying to edit the cache.'));
            return;
        }

        if (!await fs.exists(drv.cachePath)) {
            const doConfigure = !!(await vscode.window.showErrorMessage(
                localize('project.not.yet.configured', 'This project has not yet been configured'),
                localize('configure.now.button', 'Configure Now')));
            if (doConfigure) {
                if ((await this.configureInternal()).result !== 0) {
                    return;
                }
            } else {
                return;
            }
        }

        void vscode.workspace.openTextDocument(vscode.Uri.file(drv.cachePath))
            .then(doc => void vscode.window.showTextDocument(doc));
    }

    /**
   * Implementation of `cmake.EditCacheUI`
   */
    async editCacheUI(): Promise<number> {
        if (!this.cacheEditorWebview) {
            const drv = await this.getCMakeDriverInstance();
            if (!drv) {
                void vscode.window.showErrorMessage(localize('cache.load.failed', 'No CMakeCache.txt file has been found. Please configure project first!'));
                return 1;
            }

            this.cacheEditorWebview = new ConfigurationWebview(drv.cachePath, () => {
                void this.configureInternal(ConfigureTrigger.commandEditCacheUI, [], ConfigureType.Cache);
            });
            await this.cacheEditorWebview.initPanel();

            this.cacheEditorWebview.panel.onDidDispose(() => {
                this.cacheEditorWebview = undefined;
            });
        } else {
            this.cacheEditorWebview.panel.reveal();
        }

        return 0;
    }

    async buildWithTarget(): Promise<number> {
        const target = await this.showTargetSelector();
        if (target === null) {
            return -1;
        }
        let targets: string | string[] | undefined = target;
        if (target === this.targetsInPresetName) {
            targets = this.buildPreset?.targets;
        }
        return this.build(util.isString(targets) ? [targets] : targets);
    }

    private readonly targetsInPresetName = localize('targests.in.preset', '[Targets In Preset]');

    async showTargetSelector(): Promise<string | null> {
        const drv = await this.getCMakeDriverInstance();
        if (!drv) {
            void vscode.window.showErrorMessage(localize('set.up.before.selecting.target', 'Set up your CMake project before selecting a target.'));
            return '';
        }

        if (this.useCMakePresets && this.buildPreset?.targets) {
            const targets = [this.targetsInPresetName];
            targets.push(...(util.isString(this.buildPreset.targets) ? [this.buildPreset.targets] : this.buildPreset.targets));
            const sel = await vscode.window.showQuickPick(targets, { placeHolder: localize('select.active.target.tooltip', 'Select the default build target') });
            return sel || null;
        }

        if (!drv.targets.length) {
            return await vscode.window.showInputBox({ prompt: localize('enter.target.name', 'Enter a target name') }) || null;
        } else {
            const choices = drv.uniqueTargets.map((t): vscode.QuickPickItem => {
                switch (t.type) {
                    case 'named': {
                        return {
                            label: t.name,
                            description: localize('target.to.build.description', 'Target to build')
                        };
                    }
                    case 'rich': {
                        return { label: t.name, description: t.targetType, detail: t.filepath };
                    }
                }
            });
            const sel = await vscode.window.showQuickPick(choices, { placeHolder: localize('select.active.target.tooltip', 'Select the default build target') });
            return sel ? sel.label : null;
        }
    }

    /**
     * Implementaiton of `cmake.clean`
     */
    async clean(): Promise<number> {
        return this.build(['clean'], false, false);
    }

    /**
     * Implementation of `cmake.cleanRebuild`
     */
    async cleanRebuild(): Promise<number> {
        const cleanResult = await this.clean();
        if (cleanResult !== 0) {
            return cleanResult;
        }
        return this.build();
    }

    public async runCTestCustomized(driver: CMakeDriver, testPreset?: preset.TestPreset, consumer?: proc.OutputConsumer) {
        return this.cTestController.runCTest(driver, true, testPreset, consumer);
    }

    private async preTest(fromWorkflow: boolean = false): Promise<CMakeDriver> {
        if (extensionManager !== undefined && extensionManager !== null && !fromWorkflow) {
            extensionManager.cleanOutputChannel();
        }
        const buildResult = await this.build(undefined, false, false);
        if (buildResult !== 0) {
            throw new Error(localize('build.failed', 'Build failed.'));
        }

        const drv = await this.getCMakeDriverInstance();
        if (!drv) {
            throw new Error(localize('driver.died.after.build.succeeded', 'CMake driver died immediately after build succeeded.'));
        }
        return drv;
    }

    async ctest(fromWorkflow: boolean = false): Promise<number> {
        const drv = await this.preTest(fromWorkflow);
        const retc = await this.cTestController.runCTest(drv);
        return (retc) ? 0 : -1;
    }

    async cpack(fromWorkflow: boolean = false): Promise<number> {
        this.isBusy.set(true);
        const drv = await this.preTest(fromWorkflow);
        const retc = await this.cPackageController.runCPack(drv);
        this.isBusy.set(false);
        return (retc) ? 0 : -1;
    }

    async workflow(): Promise<number> {
        // Don't call this.preTest for workflow (as all other types of presets do above).
        // The workflow handles itself any configure or building needed. It can even hurt to run preTest here (which triggers a build),
        // before the workflow preset has a chance to setup the desired configure and other parameters.
        const drv = await this.getCMakeDriverInstance();
        if (!drv) {
            throw new Error(localize('driver.died.before.workflow', 'CMake driver died before starting workflow.'));
        }

        // We shouldn't set isBusy here, because the workflow is composed of phases that each set this flag.
        return (await this.workflowController.runWorkflow(drv, this.workflowPreset, this.configurePreset, this.buildPreset, this.testPreset, this.packagePreset)) ? 0 : -1;
    }

    async revealTestExplorer() {
        if (!await this.cTestController.revealTestExplorer()) {
            await this.refreshTests();
            return this.cTestController.revealTestExplorer();
        }
    }

    async refreshTests(): Promise<number> {
        const drv = await this.preTest();
        return this.cTestController.refreshTests(drv);
    }

    addTestExplorerRoot(folder: string) {
        return this.cTestController.addTestExplorerRoot(folder);
    }

    removeTestExplorerRoot(folder: string) {
        return this.cTestController.removeTestExplorerRoot(folder);
    }

    public async runCPack(driver: CMakeDriver, packagePreset?: preset.PackagePreset, consumer?: proc.OutputConsumer) {
        return this.cPackageController.runCPack(driver, packagePreset, consumer);
    }

    public async runWorkflow(driver: CMakeDriver, workflowPreset?: preset.WorkflowPreset, consumer?: proc.OutputConsumer) {
        return this.workflowController.runWorkflow(driver, workflowPreset, this.configurePreset, this.buildPreset, this.testPreset, this.packagePreset, consumer);
    }

    /**
     * Implementation of `cmake.install`
     */
    async install(): Promise<number> {
        return this.build(['install'], false, false);
    }

    /**
     * Implementation of `cmake.stop`
     */
    async stop(): Promise<boolean> {
        const drv = await this.cmakeDriver;
        if (!drv) {
            return false;
        }

        return drv.stopCurrentProcess().then(async () => {
            await this.activeBuild;
            this.cmakeDriver = Promise.resolve(null);
            this.isBusy.set(false);
            return true;
        }, () => false);
    }

    async cancelConfiguration(): Promise<boolean> {
        const drv = await this.cmakeDriver;
        if (!drv) {
            return false;
        }

        return drv.stopCurrentProcess().then(async () => {
            await this.activeBuild;
            this.cmakeDriver = Promise.resolve(null);
            return true;
        }, () => false);
    }

    /**
     * Implementation of `cmake.setVariant`
     */
    async setVariant(name?: string) {
        // Make this function compatibile with return code style...
        // Make sure the variant manager is initialized first
        if (!this.variantManager.hasInitialized()) {
            await this.variantManager.initialize(this.folderName);
        }

        if (await this.variantManager.selectVariant(name)) {
            if (this.workspaceContext.config.automaticReconfigure) {
                await this.configureInternal(ConfigureTrigger.setVariant, [], ConfigureType.Normal);
            }
            return 0; // succeeded
        }
        return 1; // failed
    }

    /**
     * The target that will be built with a regular build invocation
     */
    public get defaultBuildTarget(): string | null {
        return this.workspaceContext.state.getDefaultBuildTarget(this.folderName, this.isMultiProjectFolder);
    }
    private async setDefaultBuildTarget(v: string) {
        await this.workspaceContext.state.setDefaultBuildTarget(this.folderName, v, this.isMultiProjectFolder);
        this.targetName.set(v);
    }

    public async getDefaultBuildTargets(): Promise<string[] | undefined> {
        const defaultTarget = this.defaultBuildTarget;
        let targets: string | string[] | undefined = defaultTarget || undefined;
        if (this.useCMakePresets && (!defaultTarget || defaultTarget === this.targetsInPresetName)) {
            targets = this.buildPreset?.targets;
        }
        if (!this.useCMakePresets && !defaultTarget) {
            targets = await this.allTargetName;
        }
        return util.isString(targets) ? [targets] : targets;
    }

    /**
     * Set the default target to build. Implementation of `cmake.setDefaultTarget`
     * @param target If specified, set this target instead of asking the user
     */
    async setDefaultTarget(target?: string | null) {
        if (!target) {
            target = await this.showTargetSelector();
        }
        if (!target) {
            return;
        }
        await this.setDefaultBuildTarget(target);
    }

    /**
     * Implementation of `cmake.getBuildTargetName`
     */
    async buildTargetName(): Promise<string | null> {
        if (this.useCMakePresets) {
            return this.defaultBuildTarget || this.targetsInPresetName;
        }
        return this.defaultBuildTarget || this.allTargetName;
    }

    /**
     * Implementation of `cmake.selectLaunchTarget`
     */
    async selectLaunchTarget(name?: string): Promise<string | null> {
        return this.setLaunchTargetByName(name);
    }

    /**
     * Used by vscode and as test interface
     */
    async setLaunchTargetByName(name?: string | null) {
        if (await this.needsReconfigure()) {
            const rc = await this.configureInternal(ConfigureTrigger.launch, [], ConfigureType.Normal);
            if (rc.result !== 0) {
                return null;
            }
        }
        const executableTargets = await this.executableTargets;
        if (executableTargets.length === 0) {
            return null;
        } if (executableTargets.length === 1) {
            const target = executableTargets[0];
            await this.workspaceContext.state.setLaunchTargetName(this.folderName, target.name, this.isMultiProjectFolder);
            this._launchTargetName.set(target.name);
            return target.path;
        }

        const choices = executableTargets.map(e => ({
            label: e.name,
            description: '',
            detail: e.path
        }));
        let chosen: { label: string; detail: string } | undefined;
        if (!name) {
            chosen = await vscode.window.showQuickPick(choices, { placeHolder: localize('select.a.launch.target', 'Select a launch target for {0}', this.folderName) });
        } else {
            chosen = choices.find(choice => choice.label === name);
        }
        if (!chosen) {
            return null;
        }
        await this.workspaceContext.state.setLaunchTargetName(this.folderName, chosen.label, this.isMultiProjectFolder);
        this._launchTargetName.set(chosen.label);
        return chosen.detail;
    }

    async getCurrentLaunchTarget(): Promise<ExecutableTarget | null> {
        const targetName = this.workspaceContext.state.getLaunchTargetName(this.folderName, this.isMultiProjectFolder);
        const target = (await this.executableTargets).find(e => e.name === targetName);

        if (!target) {
            return null;
        }
        return target;
    }

    /**
     * Implementation of `cmake.launchTargetPath`. This also ensures the target exists if `cmake.buildBeforeRun` is set.
     */
    async launchTargetPath(): Promise<string | null> {
        const executable = await this.prepareLaunchTargetExecutable();
        if (!executable) {
            log.showChannel();
            log.warning('=======================================================');
            log.warning(localize('no.executable.target.found.to.launch', 'No executable target was found to launch. Please check:'));
            log.warning(` - ${localize('have.you.called.add_executable', 'Have you called add_executable() in your CMake project?')}`);
            log.warning(` - ${localize('have.you.configured', 'Have you executed a successful CMake configure?')}`);
            log.warning(localize('no.program.will.be.executed', 'No program will be executed'));
            return null;
        }
        return executable.path;
    }

    /**
     * Implementation of `cmake.launchTargetDirectory`. This also ensures the target exists if `cmake.buildBeforeRun` is set.
     */
    async launchTargetDirectory(): Promise<string | null> {
        const targetPath = await this.launchTargetPath();
        if (targetPath === null) {
            return null;
        }
        return path.dirname(targetPath);
    }

    /**
     * Implementation of `cmake.launchTargetFilename`. This also ensures the target exists if `cmake.buildBeforeRun` is set.
     */
    async launchTargetFilename(): Promise<string | null> {
        const targetPath = await this.launchTargetPath();
        if (targetPath === null) {
            return null;
        }
        return path.basename(targetPath);
    }

    /**
     * Implementation of `cmake.getLaunchTargetPath`. This does not ensure the target exists.
     */
    async getLaunchTargetPath(): Promise<string | null> {
        if (await this.needsReconfigure()) {
            const rc = await this.configureInternal(ConfigureTrigger.launch, [], ConfigureType.Normal);
            if (rc.result !== 0) {
                return null;
            }
        }
        const target = await this.getOrSelectLaunchTarget();
        if (!target) {
            log.showChannel();
            log.warning('=======================================================');
            log.warning(localize('no.executable.target.found.to.launch', 'No executable target was found to launch. Please check:'));
            log.warning(` - ${localize('have.you.called.add_executable', 'Have you called add_executable() in your CMake project?')}`);
            log.warning(` - ${localize('have.you.configured', 'Have you executed a successful CMake configure?')}`);
            log.warning(localize('no.program.will.be.executed', 'No program will be executed'));
            return null;
        }

        return target.path;
    }

    /**
     * Implementation of `cmake.getLaunchTargetDirectory`. This does not ensure the target exists.
     */
    async getLaunchTargetDirectory(): Promise<string | null> {
        const targetPath = await this.getLaunchTargetPath();
        if (targetPath === null) {
            return null;
        }
        return path.dirname(targetPath);
    }

    /**
     * Implementation of `cmake.getLaunchTargetFilename`. This does not ensure the target exists.
     */
    async getLaunchTargetFilename(): Promise<string | null> {
        const targetPath = await this.getLaunchTargetPath();
        if (targetPath === null) {
            return null;
        }
        return path.basename(targetPath);
    }

    /**
     * Implementation of `cmake.buildType`
     */
    async currentBuildType(): Promise<string | null> {
        let buildType: string | null = null;
        if (this.useCMakePresets) {
            if (this.buildPreset) {
                if (this.buildPreset.configuration) {
                    // The `configuration` is set for multi-config generators, and is optional for single-config generators.
                    buildType = this.buildPreset.configuration;
                } else {
                    try {
                        // Get the value from cache for multi-config generators
                        const cache: CMakeCache = await CMakeCache.fromPath(await this.cachePath);
                        const buildTypes: string[] | undefined = cache.get('CMAKE_CONFIGURATION_TYPES')?.as<string>().split(';');
                        if (buildTypes && buildTypes.length > 0) {
                            buildType = buildTypes[0];
                        }
                    } catch (e: any) {
                    }
                }
            }
            if (!buildType && this.configurePreset && this.configurePreset.cacheVariables) {
                // Single config generators set the build type in config preset.
                buildType = preset.getStringValueFromCacheVar(this.configurePreset.cacheVariables["CMAKE_BUILD_TYPE"]);
            }
        } else {
            // Make sure the variant manager is initialized first
            if (!this.variantManager.hasInitialized()) {
                await this.variantManager.initialize(this.folderName);
            }

            buildType = this.variantManager.activeVariantOptions.buildType || null;
        }
        return buildType;
    }

    /**
     * Implementation of `cmake.buildDirectory`
     */
    async buildDirectory(): Promise<string | null> {
        const binaryDir = await this.binaryDir;
        if (binaryDir) {
            return binaryDir;
        } else {
            return null;
        }
    }

    /**
     * Implementation of `cmake.appendBuildDirectoryToWorkspace`
     */
    async appendBuildDirectoryToWorkspace() {
        const binaryDir = await this.buildDirectory();
        if (binaryDir) {
            const binaryDirUri = vscode.Uri.file(binaryDir);
            vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0, 0, { uri: binaryDirUri });
        } else {
            void vscode.window.showErrorMessage(localize('unable.to.get.build.directory', 'Unable to get the build directory.'));
        }
    }

    /**
     * Implementation of `cmake.buildKit`
     */
    async buildKit(): Promise<string | null> {
        if (this.activeKit) {
            return this.activeKit.name;
        } else {
            return null;
        }
    }

    async prepareLaunchTargetExecutable(name?: string): Promise<ExecutableTarget | null> {
        let chosen: ExecutableTarget;

        // Ensure that we've configured the project already. If we haven't, `getOrSelectLaunchTarget` won't see any
        // executable targets and may show an uneccessary prompt to the user
        const isReconfigurationNeeded = await this.needsReconfigure();
        if (isReconfigurationNeeded) {
            const rc = await this.configureInternal(ConfigureTrigger.launch, [], ConfigureType.Normal);
            if (rc.result !== 0) {
                log.debug(localize('project.configuration.failed', 'Configuration of project failed.'));
                return null;
            }
        }

        if (name) {
            const found = (await this.executableTargets).find(e => e.name === name);
            if (!found) {
                return null;
            }
            chosen = found;
        } else {
            const current = await this.getOrSelectLaunchTarget();
            if (!current) {
                return null;
            }
            chosen = current;
        }

        const buildOnLaunch = this.workspaceContext.config.buildBeforeRun;
        if (buildOnLaunch || isReconfigurationNeeded) {
            if (this.isInstallTarget(chosen.name)) {
                const installResult = await this.install();
                if (installResult !== 0) {
                    log.debug(localize('install.failed', 'Install failed'));
                    return null;
                }
            } else {
                const buildTargets = await this.getDefaultBuildTargets() || [];
                const allTargetName = await this.allTargetName;
                if (!buildTargets.includes(allTargetName) && !buildTargets.includes(chosen.name)) {
                    buildTargets.push(chosen.name);
                }

                const buildResult = await this.build(buildTargets);
                if (buildResult !== 0) {
                    log.debug(localize('build.failed', 'Build failed'));
                    return null;
                }
            }

        }
        return chosen;
    }

    isInstallTarget(target: string): boolean {
        return target.split(' (').length !== 1;
    }

    async getOrSelectLaunchTarget(): Promise<ExecutableTarget | null> {
        const current = await this.getCurrentLaunchTarget();
        if (current) {
            return current;
        }
        // Ask the user if we don't already have a target
        await this.selectLaunchTarget();
        return this.getCurrentLaunchTarget();
    }

    /**
     * Both debugTarget and launchTarget called this function, so it's refactored out
     * Array.concat's performance would not beat the Dict.merge a lot.
     * This is also the point to fixing the issue #1987
     */
    async getTargetLaunchEnvironment(drv: CMakeDriver | null, debugEnv?: DebuggerEnvironmentVariable[]): Promise<Environment> {
        let env = util.fromDebuggerEnvironmentVars(debugEnv);

        // Add environment variables from ConfigureEnvironment.
        const configureEnv = await drv?.getConfigureEnvironment();

        if ((drv?.useCMakePresets ?? false) && (checkConfigureOverridesPresent(this.workspaceContext.config) ?? false)) {
            log.info(localize('launch.with.overrides', `NOTE: You are launching a target and there are some environment overrides being applied from your VS Code settings.`));
        }

        env = EnvironmentUtils.merge([configureEnv, env]);

        if (debugEnv) {
            const options = {... await this.getExpansionOptions(), envOverride: env, penvOverride: configureEnv };
            for (const envPair of debugEnv) {
                env[envPair.name] = await expandString(envPair.value, options);
            }
        }
        return env;
    }

    /**
     * Implementation of `cmake.debugTarget`
     */
    async debugTarget(name?: string): Promise<vscode.DebugSession | null> {
        const drv = await this.getCMakeDriverInstance();
        if (!drv) {
            void vscode.window.showErrorMessage(localize('set.up.and.build.project.before.debugging', 'Set up and build your CMake project before debugging.'));
            return null;
        }
        if (drv instanceof CMakeLegacyDriver) {
            void vscode.window
                .showWarningMessage(localize('target.debugging.unsupported', 'Target debugging is no longer supported with the legacy driver'), {
                    title: localize('learn.more.button', 'Learn more'),
                    isLearnMore: true
                })
                .then(item => {
                    if (item && item.isLearnMore) {
                        open('https://vector-of-bool.github.io/docs/vscode-cmake-tools/debugging.html');
                    }
                });
            return null;
        }

        const targetExecutable = await this.prepareLaunchTargetExecutable(name);
        if (!targetExecutable) {
            log.error(localize('failed.to.prepare.target', 'Failed to prepare executable target with name {0}', `"${name}"`));
            return null;
        }

        let debugConfig;
        try {
            const cache = await CMakeCache.fromPath(drv.cachePath);
            debugConfig = await debuggerModule.getDebugConfigurationFromCache(cache, targetExecutable, process.platform,
                this.workspaceContext.config.debugConfig?.MIMode,
                this.workspaceContext.config.debugConfig?.miDebuggerPath);
            log.debug(localize('debug.configuration.from.cache', 'Debug configuration from cache: {0}', JSON.stringify(debugConfig)));
        } catch (error: any) {
            void vscode.window
                .showErrorMessage(error.message, {
                    title: localize('debugging.documentation.button', 'Debugging documentation'),
                    isLearnMore: true
                })
                .then(item => {
                    if (item && item.isLearnMore) {
                        open('https://vector-of-bool.github.io/docs/vscode-cmake-tools/debugging.html');
                    }
                });
            log.debug(localize('problem.getting.debug', 'Problem getting debug configuration from cache.'), error);
            return null;
        }

        if (debugConfig === null) {
            log.error(localize('failed.to.generate.debugger.configuration', 'Failed to generate debugger configuration'));
            void vscode.window.showErrorMessage(localize('unable.to.generate.debugging.configuration', 'Unable to generate a debugging configuration.'));
            return null;
        }

        // Add debug configuration from settings.
        const userConfig = this.workspaceContext.config.debugConfig;
        Object.assign(debugConfig, userConfig);

        const launchEnv = await this.getTargetLaunchEnvironment(drv, debugConfig.environment);
        debugConfig.environment = util.makeDebuggerEnvironmentVars(launchEnv);
        log.debug(localize('starting.debugger.with', 'Starting debugger with following configuration.'), JSON.stringify({
            workspace: this.workspaceFolder.uri.toString(),
            config: debugConfig
        }));

        const cfg = vscode.workspace.getConfiguration('cmake', this.workspaceFolder.uri).inspect<object>('debugConfig');
        const customSetting = (cfg?.globalValue !== undefined || cfg?.workspaceValue !== undefined || cfg?.workspaceFolderValue !== undefined);
        let dbg = debugConfig.MIMode?.toString();
        if (!dbg && debugConfig.type === "cppvsdbg") {
            dbg = "vsdbg";
        } else {
            dbg = "(unset)";
        }
        const telemetryProperties: telemetry.Properties = {
            customSetting: customSetting.toString(),
            debugger: dbg
        };

        telemetry.logEvent('debug', telemetryProperties);

        await vscode.debug.startDebugging(this.workspaceFolder, debugConfig);
        return vscode.debug.activeDebugSession!;
    }

    private launchTerminals = new Map<number, vscode.Terminal>();
    private launchTerminalTargetName = '_CMAKE_TOOLS_LAUNCH_TERMINAL_TARGET_NAME';
    private launchTerminalPath = '_CMAKE_TOOLS_LAUNCH_TERMINAL_PATH';
    // Watch for the user closing our terminal
    private readonly termCloseSub = vscode.window.onDidCloseTerminal(async term => {
        const processId = await term.processId;
        if (this.launchTerminals.has(processId!)) {
            this.launchTerminals.delete(processId!);
        }
    });

    private async createTerminal(executable: ExecutableTarget): Promise<vscode.Terminal> {
        // Create terminal options
        const userConfig = this.workspaceContext.config.debugConfig;
        const drv = await this.getCMakeDriverInstance();
        const launchEnv = await this.getTargetLaunchEnvironment(drv, userConfig.environment);
        const options: vscode.TerminalOptions = {
            name: `CMake/Launch - ${executable.name}`,
            env: launchEnv,
            cwd: (userConfig && userConfig.cwd) || path.dirname(executable.path)
        };
        if (options && options.env) {
            options.env[this.launchTerminalTargetName] = executable.name;
            options.env[this.launchTerminalPath] = vscode.env.shell;
        }

        const launchBehavior = this.workspaceContext.config.launchBehavior.toLowerCase();
        // Check for terminal re-use
        if (launchBehavior !== "newterminal") {
            for (const [, terminal] of this.launchTerminals) {
                const creationOptions = terminal.creationOptions! as vscode.TerminalOptions;
                // If the environment has changed at all since the last run, dispose of this terminal
                if (JSON.stringify(creationOptions.env) !== JSON.stringify(options.env)) {
                    terminal.dispose();
                    break;
                }

                if (launchBehavior === 'breakandreuseterminal') {
                    terminal.sendText('\u0003');
                }

                return terminal;
            }
        }

        return vscode.window.createTerminal(options);
    }

    /**
     * Implementation of `cmake.launchTarget`
     */
    async launchTarget(name?: string) {
        const executable = await this.prepareLaunchTargetExecutable(name);
        if (!executable) {
            // The user has nothing selected and cancelled the prompt to select
            // a target.
            return null;
        }

        const userConfig = this.workspaceContext.config.debugConfig;
        const terminal: vscode.Terminal = await this.createTerminal(executable);

        let executablePath = shlex.quote(executable.path);
        if (executablePath.startsWith("\"")) {
            let launchTerminalPath = (terminal.creationOptions as vscode.TerminalOptions).env![this.launchTerminalPath];
            if (process.platform === 'win32') {
                executablePath = executablePath.replace(/\\/g, "/");
                launchTerminalPath = launchTerminalPath?.toLocaleLowerCase();
                if (launchTerminalPath?.includes("pwsh.exe") || launchTerminalPath?.includes("powershell")) {
                    executablePath = `.${executablePath}`;
                }
            } else {
                if (launchTerminalPath?.endsWith("pwsh")) {
                    executablePath = `.${executablePath}`;
                }
            }
        }

        terminal.sendText(executablePath, false);

        if (userConfig?.args?.length !== undefined && userConfig.args.length > 0) {
            const args = await expandStrings(userConfig.args, await this.getExpansionOptions());
            args.forEach(arg => terminal.sendText(` ${shlex.quote(arg)}`, false));
        }

        terminal.sendText('', true); // Finally send the newline to complete the command.

        terminal.show(true);

        const processId = await terminal.processId;
        this.launchTerminals.set(processId!, terminal);

        return terminal;
    }

    /**
     * Implementation of `cmake.quickStart`
     */
    public async quickStart(workspaceFolder?: vscode.WorkspaceFolder): Promise<Number> {
        if (!workspaceFolder) {
            workspaceFolder = this.workspaceContext.folder;
        }
        if (!workspaceFolder) {
            void vscode.window.showErrorMessage(localize('no.folder.open', 'No folder is open.'));
            return -2;
        }

        const mainListFile = path.join(this.sourceDir, 'CMakeLists.txt');
        const mainPresetsFile = path.join(this.sourceDir, 'CMakePresets.json');

        if (!await fs.exists(mainListFile)) {
            if (await this.createCMakeListsFile(mainListFile) !== 0) {
                return -1;
            }
            log.info(localize('cmakelists.created', '[Quick Start] CmakeLists.txt created successfully.'));
        } else {
            log.info(localize('cmakelists.exists', '[Quick Start] A CmakeLists.txt already exists, continuing...'));
        }

        // By now, we have a valid CMakeLists.txt so move onto CMakePresets.json
        if (await fs.exists(mainPresetsFile)) {
            log.info(localize('cmakepresets.already.configured', '[Quick Start] A CMakePresets.json is already configured.'));
        } else {
            if (!await this.presetsController.selectConfigurePreset(true)) {
                await this.kitsController.setKitByName(SpecialKits.Unspecified);
                log.info(localize('cmakepresets.not.created', '[Quick Start] CMakePresets.json not created.'));
            } else {
                log.info(localize('cmakepresets.created', '[Quick Start] CMakePresets.json created successfully.'));
            }
        }

        // Regardless of the following configure return code,
        // we want full feature set view for the whole workspace.
        await enableFullFeatureSet(true);
        return (await this.configureInternal(ConfigureTrigger.quickStart, [], ConfigureType.Normal)).result;
    }

    private async createCMakeListsFile(mainListFile: string): Promise<Number> {
        const projectName = await vscode.window.showInputBox({
            prompt: localize('new.project.name', 'Enter a name for the new project'),
            validateInput: (value: string): string => {
                if (!value.length) {
                    return localize('project.name.required', 'A project name is required');
                }
                if (value.includes(' ')) {
                    return localize('project.name.no.spaces', 'Project name cannot contain spaces');
                }
                return '';
            }
        });

        if (!projectName) {
            return -1;
        }

        const targetLang = (await vscode.window.showQuickPick([
            {
                label: 'C++',
                description: localize('create.cpp', 'Create a C++ project')
            },
            {
                label: 'C',
                description: localize('create.c', 'Create a C project')
            }
        ]));

        if (!targetLang) {
            return -1;
        }

        const targetType = await vscode.window.showQuickPick([
            {
                label: 'Library',
                description: localize('create.library', 'Create a library')
            },
            {
                label: 'Executable',
                description: localize('create.executable', 'Create an executable')
            }
        ]);

        if (!targetType) {
            return -1;
        }

        const addlOptions = (await vscode.window.showQuickPick([
            {
                label: 'CPack',
                description: localize('cpack.support', 'CPack support')
            },
            {
                label: 'CTest',
                description: localize('ctest.support', 'CTest support')
            }
        ], { canPickMany: true, placeHolder: localize('select.additional.options', 'Select additional options')}));

        // select current c/cpp files to add as targets, if any. If none, or none are selected, create a new one
        const files = await fs.readdir(this.sourceDir);
        const cppFiles = files.filter(file => path.extname(file) === '.cpp' || path.extname(file) === '.c');
        let selectedFiles: string[] = [];

        if (cppFiles.length > 0) {
            selectedFiles = await vscode.window.showQuickPick(cppFiles, {
                canPickMany: true,
                placeHolder: localize('select.cpp.files', 'Select targets to include in the CMakeLists.txt file')
            }) || [];
        }

        const type = targetType.label;
        const lang = targetLang.label;
        const langName = lang === "C++" ? "C CXX" : "C";
        const langExt  = lang === "C++" ? "cpp" : "c";

        let failedToCreate = false;

        // Create start c/cpp file if none are selected
        if (selectedFiles.length === 0) {
            if (await this.createCppFile(projectName, langExt, type) !== 0) {
                void vscode.window.showErrorMessage(localize('create.file.failed', 'Failed to create a new {0} file. Add target to CMakeLists.txt.', langExt));
                failedToCreate = true;
            }
        }

        let init = [
            'cmake_minimum_required(VERSION 3.5.0)',
            `project(${projectName} VERSION 0.1.0 LANGUAGES ${langName})`,
            '\n'
        ].join('\n');

        if (!failedToCreate) {
            init += [
                type === 'Library' ? `add_library(${projectName} `
                    + (selectedFiles.length === 0 ? `${projectName}.${langExt}` : selectedFiles.join(' ')) + `)`
                    : `add_executable(${projectName} `
                    + (selectedFiles.length === 0 ? `main.${langExt}` : selectedFiles.join(' ')) + `)`,
                '\n'
            ].join('\n');
        }

        if (addlOptions?.some(option => option.label === 'CTest')) {
            init += [
                'include(CTest)',
                'enable_testing()',
                '\n'
            ].join('\n');
        }

        if (addlOptions?.some(option => option.label === 'CPack')) {
            init += [
                'set(CPACK_PROJECT_NAME ${PROJECT_NAME})',
                'set(CPACK_PROJECT_VERSION ${PROJECT_VERSION})',
                'include(CPack)',
                ''
            ].join('\n');
        }

        await fs.writeFile(mainListFile, init);
        const doc = await vscode.workspace.openTextDocument(mainListFile);
        await vscode.window.showTextDocument(doc);

        return 0;
    }

    /**
     * Creates a hello world C++ or C file in the source directory
     */
    private async createCppFile(fileName: string, langExt: string, projType: string): Promise<Number> {
        if (projType === 'Library') {
            if (!(await fs.exists(path.join(this.sourceDir, `${fileName}.${langExt}`)))) {
                await fs.writeFile(path.join(this.sourceDir, `${fileName}.${langExt}`),
                    (langExt === "cpp" ?
                        ([
                            '#include <iostream>',
                            '',
                            'void say_hello(){',
                            `    std::cout << "Hello, from ${fileName}!\\n";`,
                            '}',
                            ''
                        ]) :
                        ([
                            '#include <stdio.h>',
                            '',
                            'void say_hello(){',
                            `    printf("Hello, from ${fileName}!\\n");`,
                            '}',
                            ''
                        ])).join('\n'));
                return 0;
            }
        } else if (projType === 'Executable') {
            if (!(await fs.exists(path.join(this.sourceDir, `main.${langExt}`)))) {
                await fs.writeFile(path.join(this.sourceDir, `main.${langExt}`),
                    (langExt === "cpp" ?
                        ([
                            '#include <iostream>',
                            '',
                            'int main(int, char**){',
                            `    std::cout << "Hello, from ${fileName}!\\n";`,
                            '}',
                            ''
                        ]) :
                        ([
                            '#include <stdio.h>',
                            '',
                            'int main(int, char**){',
                            `    printf("Hello, from ${fileName}!\\n");`,
                            '}',
                            ''
                        ])
                    ).join('\n'));
                return 0;
            }
        }
        return -1;
    }

    /**
     * Implementation of `cmake.resetState`
     */
    async resetState() {
        await this.workspaceContext.state.reset(this.folderName, this.isMultiProjectFolder);
    }

    // Don't get this from the driver. Source dir is required to evaluate presets.
    // Presets contain generator info. Generator info is required for server api.
    private _sourceDir = '';
    get sourceDir() {
        return this._sourceDir;
    }

    async setSourceDir(sourceDir: string) {
        this._sourceDir = sourceDir;
        this.cmakeListsExists = await fs.exists(path.join(this._sourceDir, "CMakeLists.txt"));
    }

    private cmakeListsExists: boolean = false;
    hasCMakeLists(): boolean {
        return this.cmakeListsExists;
    }

    get mainListFile() {
        const drv = this.getCMakeDriverInstance();

        return drv.then(d => {
            if (!d) {
                return '';
            }
            return d.mainListFile;
        });
    }

    get binaryDir() {
        const drv = this.getCMakeDriverInstance();

        return drv.then(d => {
            if (!d) {
                return '';
            }
            return d.binaryDir;
        });
    }

    get cachePath() {
        const drv = this.getCMakeDriverInstance();

        return drv.then(d => {
            if (!d) {
                return '';
            }
            return d.cachePath;
        });
    }

    get targets() {
        const drv = this.getCMakeDriverInstance();

        return drv.then(d => {
            if (!d) {
                return [];
            }
            return d.targets;
        });
    }

    get executableTargets() {
        const drv = this.getCMakeDriverInstance();

        return drv.then(d => {
            if (!d) {
                return [];
            }
            return d.executableTargets;
        });
    }

    async jumpToCacheFile() {
        // Do nothing.
        return null;
    }

    async setBuildType() {
        // Do nothing
        return -1;
    }

    async selectEnvironments() {
        return null;
    }

    async getExpansionOptions(): Promise<ExpansionOptions> {
        const workspaceFolder: string = this.workspaceContext.folder.uri.fsPath;
        return {
            vars: {
                buildKit: '${buildKit}',
                buildType: '${buildType}',
                buildKitVendor: '${buildKitVendor}',
                buildKitTriple: '${buildKitTriple}',
                buildKitVersion: '${buildKitVersion}',
                buildKitHostOs: '${buildKitVendor}',
                buildKitTargetOs: '${buildKitTargetOs}',
                buildKitTargetArch: '${buildKitTargetArch}',
                buildKitVersionMajor: '${buildKitVersionMajor}',
                buildKitVersionMinor: '${buildKitVersionMinor}',
                generator: '${generator}',
                userHome: paths.userHome,
                workspaceFolder: workspaceFolder,
                workspaceFolderBasename: path.basename(workspaceFolder),
                sourceDir: this.sourceDir,
                workspaceHash: '${workspaceHash}',
                workspaceRoot: this.workspaceContext.folder.uri.fsPath,
                workspaceRootFolderName: path.basename(workspaceFolder)
            }
        };
    }

    async getExpandedAdditionalKitFiles(): Promise<string[]> {
        const opts: ExpansionOptions = await this.getExpansionOptions();
        return expandStrings(this.workspaceContext.config.additionalKits, opts);
    }

    async sendFileTypeTelemetry(uri: vscode.Uri): Promise<void> {
        const filePath = util.platformNormalizePath(uri.fsPath);
        const sourceDirectory = util.platformNormalizePath(this.sourceDir);
        // "outside" evaluates whether the modified cmake file belongs to the project.
        let outside: boolean = true;
        let fileType: string | undefined;
        if (filePath.endsWith("cmakelists.txt")) {
            fileType = "CMakeLists";

            // The CMakeLists.txt belongs to the project only if sourceDirectory points to it.
            if (filePath === path.join(sourceDirectory, "cmakelists.txt")) {
                outside = false;
            }
        } else if (filePath.endsWith("cmakecache.txt")) {
            fileType = "CMakeCache";
            const binaryDirectory = util.platformNormalizePath(await this.binaryDir);

            // The CMakeCache.txt belongs to the project only if binaryDirectory points to it.
            if (filePath === path.join(binaryDirectory, "cmakecache.txt")) {
                outside = false;
            }
        } else if (filePath.endsWith(".cmake")) {
            fileType = ".cmake";
            const binaryDirectory = util.platformNormalizePath(await this.binaryDir);

            // Instead of parsing how and from where a *.cmake file is included or imported
            // let's consider one inside the project if it's in the workspace folder (single-project),
            // sourceDirectory or binaryDirectory.
            if ((!this.isMultiProjectFolder && filePath.startsWith(util.platformNormalizePath(this.folderPath))) ||
                filePath.startsWith(sourceDirectory) ||
                filePath.startsWith(binaryDirectory)) {
                outside = false;
            }
        }

        if (fileType) {
            telemetry.logEvent("cmakeFileWrite", { filetype: fileType, outsideActiveFolder: outside.toString() });
        }
    }

    async getDiagnostics(): Promise<DiagnosticsConfiguration> {
        try {
            const drv = await this.getCMakeDriverInstance();
            if (drv) {
                return drv.getDiagnostics();
            }
        } catch {
        }
        return {
            folder: (this.isMultiProjectFolder) ? this.sourceDir : this.workspaceFolder.uri.fsPath || "",
            cmakeVersion: "unknown",
            configured: false,
            generator: "unknown",
            usesPresets: false,
            compilers: {}
        };
    }

    async getSettingsDiagnostics(): Promise<DiagnosticsSettings> {
        try {
            const drv = await this.getCMakeDriverInstance();
            if (drv) {
                return {
                    communicationMode: drv.config.cmakeCommunicationMode,
                    useCMakePresets: drv.config.useCMakePresets,
                    configureOnOpen: drv.config.configureOnOpen
                };
            }
        } catch {
        }
        return {
            communicationMode: 'automatic',
            useCMakePresets: 'auto',
            configureOnOpen: null
        };
    }

    get onUseCMakePresetsChanged() {
        return this.onUseCMakePresetsChangedEmitter.event;
    }

    public hideBuildButton: boolean = false;
    public hideDebugButton: boolean = false;
    public hideLaunchButton: boolean = false;

    doStatusChange(options: OptionConfig) {
        this.hideBuildButton = (options?.advanced?.build?.statusBarVisibility === "hidden" && options?.advanced?.build?.projectStatusVisibility === "hidden") ? true : false;
        this.hideDebugButton = (options?.advanced?.debug?.statusBarVisibility === "hidden" && options?.advanced?.debug?.projectStatusVisibility === "hidden") ? true : false;
        this.hideLaunchButton = (options?.advanced?.launch?.statusBarVisibility === "hidden" && options?.advanced?.launch?.projectStatusVisibility === "hidden") ? true : false;
    }
}

export default CMakeProject;
