/**
 * Provides a typed interface to CMake Tools' configuration options. You'll want
 * to import the `config` default export, which is an instance of the
 * `ConfigurationReader` class.
 */ /** */

import * as logging from '@cmt/logging';
import * as util from '@cmt/util';
import * as os from 'os';
import * as telemetry from '@cmt/telemetry';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { CppDebugConfiguration } from './debugger';
import { Environment } from './environmentVariables';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
export function defaultNumJobs (): number {
    return os.cpus().length + 2;
}

const log = logging.createLogger('config');

export type LogLevelKey = 'trace' | 'debug' | 'info' | 'note' | 'warning' | 'error' | 'fatal';
export type CMakeCommunicationMode = 'legacy' | 'serverApi' | 'fileApi' | 'automatic';
export type StatusBarOptionVisibility = "visible" | "compact" | "icon" | "hidden" | "inherit";
export type StatusBarInheritOptionVisibility = "visible" | "compact" | "icon" | "hidden";
export type StatusBarStaticOptionVisibility = "visible" | "icon" | "hidden" | "inherit";
export type StatusBarInheritStaticOptionVisibility = "visible" | "icon" | "hidden";
export type StatusBarTextOptionVisibility = "visible" | "compact" | "hidden" | "inherit";
export type StatusBarInheritTextOptionVisibility = "visible" | "compact" | "hidden";
export type StatusBarIconOptionVisibility = "visible" | "hidden" | "inherit";
export type StatusBarInheritIconOptionVisibility = "visible" | "hidden" | "inherit";
export type ProjectStatusOptionVisibility = "visible" | "hidden";
export type TouchBarOptionVisibility = "default" | "hidden";
export type UseCMakePresets = 'always' | 'never' | 'auto';

export interface AdvancedTouchBarConfig {
    configure?: TouchBarOptionVisibility;
    build?: TouchBarOptionVisibility;
    debug?: TouchBarOptionVisibility;
    launch?: TouchBarOptionVisibility;
}

export interface TouchBarConfig {
    advanced?: AdvancedTouchBarConfig;
    visibility: TouchBarOptionVisibility;
}

export interface AdvancedOptionConfig {
    configure?: {
        projectStatusVisibility?: ProjectStatusOptionVisibility;
    };
    configurePreset?: {
        projectStatusVisibility?: ProjectStatusOptionVisibility;
        statusBarVisibility?: StatusBarOptionVisibility;
        inheritDefault?: StatusBarInheritOptionVisibility;
        statusBarLength?: number;
    };
    buildPreset?: {
        projectStatusVisibility?: ProjectStatusOptionVisibility;
        statusBarVisibility?: StatusBarOptionVisibility;
        inheritDefault?: StatusBarInheritOptionVisibility;
        statusBarLength?: number;
    };
    testPreset?: {
        projectStatusVisibility?: ProjectStatusOptionVisibility;
        statusBarVisibility?: StatusBarOptionVisibility;
        inheritDefault?: StatusBarInheritOptionVisibility;
        statusBarLength?: number;
    };
    packagePreset?: {
        statusBarVisibility?: StatusBarOptionVisibility;
        inheritDefault?: StatusBarInheritOptionVisibility;
        statusBarLength?: number;
    };
    workflowPreset?: {
        statusBarVisibility?: StatusBarOptionVisibility;
        inheritDefault?: StatusBarInheritOptionVisibility;
        statusBarLength?: number;
    };
    kit?: {
        projectStatusVisibility?: ProjectStatusOptionVisibility;
        statusBarVisibility?: StatusBarOptionVisibility;
        inheritDefault?: StatusBarInheritOptionVisibility;
        statusBarLength?: number;
    };
    variant?: {
        projectStatusVisibility?: ProjectStatusOptionVisibility;
        statusBarVisibility?: StatusBarOptionVisibility;
        inheritDefault?: StatusBarInheritOptionVisibility;
    };
    folder?: {
        projectStatusVisibility?: ProjectStatusOptionVisibility;
        statusBarVisibility?: StatusBarOptionVisibility;
        inheritDefault?: StatusBarInheritOptionVisibility;
        statusBarLength?: number;
    };
    buildTarget?: {
        projectStatusVisibility?: ProjectStatusOptionVisibility;
        statusBarVisibility?: StatusBarTextOptionVisibility;
        inheritDefault?: StatusBarInheritTextOptionVisibility;
        statusBarLength?: number;
    };
    build?: {
        projectStatusVisibility?: ProjectStatusOptionVisibility;
        statusBarVisibility?: StatusBarStaticOptionVisibility;
        inheritDefault?: StatusBarInheritStaticOptionVisibility;
    };
    launchTarget?: {
        projectStatusVisibility?: ProjectStatusOptionVisibility;
        statusBarVisibility?: StatusBarTextOptionVisibility;
        inheritDefault?: StatusBarInheritTextOptionVisibility;
        statusBarLength?: number;
    };
    debug?: {
        projectStatusVisibility?: ProjectStatusOptionVisibility;
        statusBarVisibility?: StatusBarIconOptionVisibility;
        inheritDefault?: StatusBarInheritIconOptionVisibility;
    };
    launch?: {
        projectStatusVisibility?: ProjectStatusOptionVisibility;
        statusBarVisibility?: StatusBarIconOptionVisibility;
        inheritDefault?: StatusBarInheritIconOptionVisibility;
    };
    ctest?: {
        projectStatusVisibility?: ProjectStatusOptionVisibility;
        color?: boolean;
        statusBarVisibility?: StatusBarOptionVisibility;
        inheritDefault?: StatusBarInheritOptionVisibility;
        statusBarLength?: number;
    };
    cpack?: {
        projectStatusVisibility?: ProjectStatusOptionVisibility;
        color?: boolean;
        statusBarVisibility?: StatusBarOptionVisibility;
        inheritDefault?: StatusBarInheritOptionVisibility;
        statusBarLength?: number;
    };
    workflow?: {
        projectStatusVisibility?: ProjectStatusOptionVisibility;
        color?: boolean;
        statusBarVisibility?: StatusBarOptionVisibility;
        inheritDefault?: StatusBarInheritOptionVisibility;
        statusBarLength?: number;
    };
}

export interface OptionConfig {
    advanced?: AdvancedOptionConfig;
    statusBarVisibility: StatusBarOptionVisibility;
}

export interface ExtensionConfigurationSettings {
    autoSelectActiveFolder: boolean;
    cmakePath: string;
    buildDirectory: string;
    installPrefix: string | null;
    sourceDirectory: string | string[];
    saveBeforeBuild: boolean;
    buildBeforeRun: boolean;
    clearOutputBeforeBuild: boolean;
    configureSettings: { [key: string]: boolean | number | string | string[] | util.CMakeValue };
    cacheInit: string | string[] | null;
    preferredGenerators: string[];
    generator: string | null;
    toolset: string | null;
    platform: string | null;
    configureArgs: string[];
    buildArgs: string[];
    buildToolArgs: string[];
    parallelJobs: number | undefined;
    ctestPath: string;
    ctest: { parallelJobs: number; allowParallelJobs: boolean; testExplorerIntegrationEnabled: boolean };
    parseBuildDiagnostics: boolean;
    enabledOutputParsers: string[];
    debugConfig: CppDebugConfiguration;
    defaultVariants: object;
    ctestArgs: string[];
    ctestDefaultArgs: string[];
    environment: Environment;
    configureEnvironment: Environment;
    buildEnvironment: Environment;
    testEnvironment: Environment;
    cpackEnvironment: Environment;
    cpackPath: string;
    cpackArgs: string[];
    mingwSearchDirs: string[]; // Deprecated in 1.14, replaced by additionalCompilerSearchDirs, but kept for backwards compatibility
    additionalCompilerSearchDirs: string[];
    emscriptenSearchDirs: string[];
    mergedCompileCommands: string | null;
    copyCompileCommands: string | null;
    loadCompileCommands: boolean;
    configureOnOpen: boolean | null;
    configureOnEdit: boolean;
    skipConfigureIfCachePresent: boolean | null;
    useCMakeServer: boolean;
    cmakeCommunicationMode: CMakeCommunicationMode;
    showSystemKits: boolean;
    ignoreKitEnv: boolean;
    buildTask: boolean;
    outputLogEncoding: string;
    enableTraceLogging: boolean;
    loggingLevel: LogLevelKey;
    additionalKits: string[];
    touchbar: TouchBarConfig;
    showOptionsMovedNotification: boolean;
    options: OptionConfig;
    useCMakePresets: UseCMakePresets;
    allowCommentsInPresetsFile: boolean;
    allowUnsupportedPresetsVersions: boolean;
    launchBehavior: string;
    ignoreCMakeListsMissing: boolean;
    automaticReconfigure: boolean;
    pinnedCommands: string[];
    enableAutomaticKitScan: boolean;
}

type EmittersOf<T> = {
    readonly [Key in keyof T]: vscode.EventEmitter<T[Key]>;
};

/**
 * This class exposes a number of readonly properties which can be used to
 * access configuration options. Each property corresponds to a value in
 * `settings.json`. See `package.json` for CMake Tools to see the information
 * on each property. An underscore in a property name corresponds to a dot `.`
 * in the setting name.
 */
export class ConfigurationReader implements vscode.Disposable {
    private updateSubscription?: vscode.Disposable;

    constructor(private readonly configData: ExtensionConfigurationSettings) {}

    dispose() {
        if (this.updateSubscription) {
            this.updateSubscription.dispose();
        }
    }

    /**
     * Get a configuration object relevant to the given workspace directory. This
     * supports multiple workspaces having differing configs.
     *
     * @param folder A directory to use for the config
     */
    static create(folder?: vscode.WorkspaceFolder): ConfigurationReader {
        const configData = ConfigurationReader.loadConfig(folder);
        const reader = new ConfigurationReader(configData);
        reader.updateSubscription = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('cmake', folder?.uri)) {
                const newConfigData = ConfigurationReader.loadConfig(folder);
                const updatedKeys = reader.update(newConfigData);

                if (updatedKeys.length > 0) {
                    const telemetryProperties: telemetry.Properties = {
                        isSet: updatedKeys.join(";")
                    };

                    telemetry.logEvent("settings", telemetryProperties);
                }
            }
        });
        return reader;
    }

    static loadConfig(folder?: vscode.WorkspaceFolder): ExtensionConfigurationSettings {
        const configData = vscode.workspace.getConfiguration('cmake', folder?.uri) as any as
            ExtensionConfigurationSettings;
        const platformMap = {
            win32: 'windows',
            darwin: 'osx',
            linux: 'linux'
        } as { [k: string]: string };
        const platform = platformMap[process.platform];
        const forPlatform = (configData as any)[platform] as ExtensionConfigurationSettings | undefined;
        return { ...configData, ...(forPlatform || {}) };
    }

    update(newConfigData: ExtensionConfigurationSettings): string[] {
        return this.updatePartial(newConfigData);
    }

    updatePartial(newConfigData: Partial<ExtensionConfigurationSettings>, fireEvent: boolean = true): string[] {
        const keys: string[] = [];
        const oldValues = { ...this.configData };
        Object.assign(this.configData, newConfigData);
        for (const keyObject of Object.getOwnPropertyNames(newConfigData)) {
            const key = keyObject as keyof ExtensionConfigurationSettings;
            if (!(key in this.emitters)) {
                continue;  // Extension config we load has some additional properties we don't care about.
            }
            const newValue = this.configData[key];
            const oldValue = oldValues[key];
            if (util.compare(newValue, oldValue) !== util.Ordering.Equivalent) {
                if (fireEvent) {
                    const em: vscode.EventEmitter<ExtensionConfigurationSettings[typeof key]> = this.emitters[key];
                    // The key is defined by this point.
                    const temp = newConfigData[key];
                    if (temp !== undefined) {
                        em.fire(temp);
                    }
                }
                keys.push(key);
            }
        }

        return keys;
    }

    get autoSelectActiveFolder(): boolean {
        return this.configData.autoSelectActiveFolder;
    }
    buildDirectory(multiProject: boolean, workspaceFolder?: vscode.ConfigurationScope): string {
        if (multiProject && this.isDefaultValue('buildDirectory', workspaceFolder)) {
            return '${sourceDirectory}/build';
        }
        return this.configData.buildDirectory;
    }
    get installPrefix(): string | null {
        return this.configData.installPrefix;
    }
    get sourceDirectory(): string[] {
        if (!Array.isArray(this.configData.sourceDirectory)) {
            return [this.configData.sourceDirectory];
        } else {
            return this.configData.sourceDirectory;
        }
    }
    get saveBeforeBuild(): boolean {
        return !!this.configData.saveBeforeBuild;
    }
    get buildBeforeRun(): boolean {
        return this.configData.buildBeforeRun;
    }
    get clearOutputBeforeBuild(): boolean {
        return !!this.configData.clearOutputBeforeBuild;
    }
    get configureSettings(): {[key: string]: boolean | number | string | string[] | util.CMakeValue} {
        return this.configData.configureSettings;
    }
    get cacheInit() {
        return this.configData.cacheInit;
    }
    get preferredGenerators(): string[] {
        return this.configData.preferredGenerators;
    }
    get generator(): string | null {
        return this.configData.generator;
    }
    get toolset(): string | null {
        return this.configData.toolset;
    }
    get platform(): string | null {
        return this.configData.platform;
    }
    get configureArgs(): string[] {
        return this.configData.configureArgs;
    }
    get buildArgs(): string[] {
        return this.configData.buildArgs;
    }
    get buildToolArgs(): string[] {
        return this.configData.buildToolArgs;
    }
    get parallelJobs(): number | undefined {
        return this.configData.parallelJobs;
    }
    get ctestParallelJobs(): number | null {
        return this.configData.ctest.parallelJobs;
    }
    get ctestAllowParallelJobs(): boolean {
        return this.configData.ctest.allowParallelJobs;
    }
    get testExplorerIntegrationEnabled(): boolean {
        return this.configData.ctest.testExplorerIntegrationEnabled;
    }
    get parseBuildDiagnostics(): boolean {
        return !!this.configData.parseBuildDiagnostics;
    }
    get enableOutputParsers(): string[] | null {
        return this.configData.enabledOutputParsers;
    }
    get pinnedCommands(): string[] | null {
        return this.configData.pinnedCommands;
    }
    get rawCMakePath(): string {
        return this.configData.cmakePath;
    }
    get rawCTestPath(): string {
        return this.configData.ctestPath;
    }
    get rawCPackPath(): string {
        return this.configData.cpackPath;
    }
    get debugConfig(): CppDebugConfiguration {
        return this.configData.debugConfig;
    }
    get environment() {
        return this.configData.environment;
    }
    get configureEnvironment() {
        return this.configData.configureEnvironment;
    }
    get buildEnvironment() {
        return this.configData.buildEnvironment;
    }
    get testEnvironment() {
        return this.configData.testEnvironment;
    }
    get defaultVariants(): Object {
        return this.configData.defaultVariants;
    }
    get ctestArgs(): string[] {
        return this.configData.ctestArgs;
    }
    get ctestDefaultArgs(): string[] {
        return this.configData.ctestDefaultArgs;
    }
    get cpackEnvironment() {
        return this.configData.cpackEnvironment;
    }
    get cpackArgs(): string[] {
        return this.configData.cpackArgs;
    }
    get configureOnOpen() {
        if (util.isCodespaces() && this.configData.configureOnOpen === null) {
            return true;
        }
        return this.configData.configureOnOpen;
    }
    get configureOnEdit() {
        return this.configData.configureOnEdit;
    }
    get skipConfigureIfCachePresent() {
        return this.configData.skipConfigureIfCachePresent;
    }
    get useCMakeServer(): boolean {
        return this.configData.useCMakeServer;
    }

    /**
     * Use folder.useCMakePresets() to check the actual decision on if we are using CMake presets.
     */
    get useCMakePresets(): UseCMakePresets {
        return this.configData.useCMakePresets;
    }
    get allowCommentsInPresetsFile(): boolean {
        return this.configData.allowCommentsInPresetsFile;
    }

    get allowUnsupportedPresetsVersions(): boolean {
        return this.configData.allowUnsupportedPresetsVersions;
    }

    get ignoreCMakeListsMissing(): boolean {
        return this.configData.ignoreCMakeListsMissing;
    }

    get cmakeCommunicationMode(): CMakeCommunicationMode {
        let communicationMode = this.configData.cmakeCommunicationMode;
        if (communicationMode === "automatic" && this.useCMakeServer) {
            log.warning(localize('please.upgrade.configuration', 'The setting {0} is replaced by {1}. Please upgrade your configuration.', '"useCMakeServer"', '"cmakeCommunicationMode"'));
            communicationMode = 'serverApi';
        }
        return communicationMode;
    }

    get numJobs(): number | undefined {
        if (this.parallelJobs === undefined) {
            return undefined;
        } else if (this.parallelJobs === 0) {
            return defaultNumJobs();
        } else {
            return this.parallelJobs;
        }
    }

    get numCTestJobs(): number {
        const ctestJobs = this.ctestParallelJobs;
        if (!ctestJobs) {
            return this.numJobs || defaultNumJobs();
        }
        return ctestJobs;
    }

    get additionalCompilerSearchDirs(): string[] {
        // mingwSearchDirs is deprecated, but we still use it if additionalCompilerSearchDirs is not set for backwards compatibility
        if (this.configData.additionalCompilerSearchDirs.length === 0 && this.configData.mingwSearchDirs.length > 0) {
            log.warning(localize('please.upgrade.configuration', 'The setting {0} is replaced by {1}. Please upgrade your configuration.', '"mingwSearchDirs"', '"additionalCompilerSearchDirs"'));
            return this.configData.mingwSearchDirs;
        }
        return this.configData.additionalCompilerSearchDirs;
    }
    get additionalKits(): string[] {
        return this.configData.additionalKits;
    }
    get emscriptenSearchDirs(): string[] {
        return this.configData.emscriptenSearchDirs;
    }
    get mergedCompileCommands(): string | null {
        return this.configData.mergedCompileCommands;
    }
    get copyCompileCommands(): string | null {
        return this.configData.copyCompileCommands;
    }
    get loadCompileCommands(): boolean {
        return this.configData.loadCompileCommands;
    }
    get showSystemKits(): boolean {
        return this.configData.showSystemKits;
    }
    get ignoreKitEnv(): boolean {
        return this.configData.ignoreKitEnv;
    }
    get buildTask(): boolean {
        return this.configData.buildTask;
    }
    get outputLogEncoding(): string {
        return this.configData.outputLogEncoding;
    }
    get enableTraceLogging(): boolean {
        return this.configData.enableTraceLogging;
    }

    get loggingLevel(): LogLevelKey {
        if (process.env['CMT_LOGGING_LEVEL']) {
            return process.env['CMT_LOGGING_LEVEL']! as LogLevelKey;
        }
        return this.configData.loggingLevel;
    }

    get touchbar(): TouchBarConfig {
        return this.configData.touchbar;
    }

    get options() {
        return this.configData.options;
    }

    get launchBehavior(): string {
        return this.configData.launchBehavior;
    }

    get automaticReconfigure(): boolean {
        return this.configData.automaticReconfigure;
    }

    get enableAutomaticKitScan(): boolean {
        return this.configData.enableAutomaticKitScan;
    }

    private readonly emitters: EmittersOf<ExtensionConfigurationSettings> = {
        autoSelectActiveFolder: new vscode.EventEmitter<boolean>(),
        cmakePath: new vscode.EventEmitter<string>(),
        buildDirectory: new vscode.EventEmitter<string>(),
        installPrefix: new vscode.EventEmitter<string | null>(),
        sourceDirectory: new vscode.EventEmitter<string|string[]>(),
        saveBeforeBuild: new vscode.EventEmitter<boolean>(),
        buildBeforeRun: new vscode.EventEmitter<boolean>(),
        clearOutputBeforeBuild: new vscode.EventEmitter<boolean>(),
        configureSettings: new vscode.EventEmitter<{ [key: string]: any }>(),
        cacheInit: new vscode.EventEmitter<string | string[] | null>(),
        preferredGenerators: new vscode.EventEmitter<string[]>(),
        generator: new vscode.EventEmitter<string | null>(),
        toolset: new vscode.EventEmitter<string | null>(),
        platform: new vscode.EventEmitter<string | null>(),
        configureArgs: new vscode.EventEmitter<string[]>(),
        buildArgs: new vscode.EventEmitter<string[]>(),
        buildToolArgs: new vscode.EventEmitter<string[]>(),
        parallelJobs: new vscode.EventEmitter<number>(),
        ctestPath: new vscode.EventEmitter<string>(),
        cpackPath: new vscode.EventEmitter<string>(),
        ctest: new vscode.EventEmitter<{ parallelJobs: number; allowParallelJobs: boolean; testExplorerIntegrationEnabled: boolean }>(),
        parseBuildDiagnostics: new vscode.EventEmitter<boolean>(),
        enabledOutputParsers: new vscode.EventEmitter<string[]>(),
        debugConfig: new vscode.EventEmitter<CppDebugConfiguration>(),
        defaultVariants: new vscode.EventEmitter<object>(),
        ctestArgs: new vscode.EventEmitter<string[]>(),
        ctestDefaultArgs: new vscode.EventEmitter<string[]>(),
        cpackArgs: new vscode.EventEmitter<string[]>(),
        environment: new vscode.EventEmitter<Environment>(),
        configureEnvironment: new vscode.EventEmitter<Environment>(),
        buildEnvironment: new vscode.EventEmitter<Environment>(),
        testEnvironment: new vscode.EventEmitter<Environment>(),
        cpackEnvironment: new vscode.EventEmitter<Environment>(),
        mingwSearchDirs: new vscode.EventEmitter<string[]>(), // Deprecated in 1.14, replaced by additionalCompilerSearchDirs, but kept for backwards compatibility
        additionalCompilerSearchDirs: new vscode.EventEmitter<string[]>(),
        emscriptenSearchDirs: new vscode.EventEmitter<string[]>(),
        mergedCompileCommands: new vscode.EventEmitter<string | null>(),
        copyCompileCommands: new vscode.EventEmitter<string | null>(),
        loadCompileCommands: new vscode.EventEmitter<boolean>(),
        configureOnOpen: new vscode.EventEmitter<boolean | null>(),
        configureOnEdit: new vscode.EventEmitter<boolean>(),
        skipConfigureIfCachePresent: new vscode.EventEmitter<boolean | null>(),
        useCMakeServer: new vscode.EventEmitter<boolean>(),
        cmakeCommunicationMode: new vscode.EventEmitter<CMakeCommunicationMode>(),
        showSystemKits: new vscode.EventEmitter<boolean>(),
        ignoreKitEnv: new vscode.EventEmitter<boolean>(),
        buildTask: new vscode.EventEmitter<boolean>(),
        outputLogEncoding: new vscode.EventEmitter<string>(),
        enableTraceLogging: new vscode.EventEmitter<boolean>(),
        loggingLevel: new vscode.EventEmitter<LogLevelKey>(),
        additionalKits: new vscode.EventEmitter<string[]>(),
        touchbar: new vscode.EventEmitter<TouchBarConfig>(),
        showOptionsMovedNotification: new vscode.EventEmitter<boolean>(),
        options: new vscode.EventEmitter<OptionConfig>(),
        useCMakePresets: new vscode.EventEmitter<UseCMakePresets>(),
        allowCommentsInPresetsFile: new vscode.EventEmitter<boolean>(),
        allowUnsupportedPresetsVersions: new vscode.EventEmitter<boolean>(),
        ignoreCMakeListsMissing: new vscode.EventEmitter<boolean>(),
        launchBehavior: new vscode.EventEmitter<string>(),
        automaticReconfigure: new vscode.EventEmitter<boolean>(),
        pinnedCommands: new vscode.EventEmitter<string[]>(),
        enableAutomaticKitScan: new vscode.EventEmitter<boolean>()
    };

    /**
     * Watch for changes on a particular setting
     * @param setting The name of the setting to watch
     * @param cb A callback when the setting changes
     */
    onChange<K extends keyof ExtensionConfigurationSettings>(setting: K, cb: (value: ExtensionConfigurationSettings[K]) => any): vscode.Disposable {
        // Can't use vscode.EventEmitter<ExtensionConfigurationSettings[K]> here, potentially because K and keyof ExtensionConfigurationSettings
        // may not be the same...
        const emitter: vscode.EventEmitter<any> = this.emitters[setting];
        const awaitableCallback = (value: ExtensionConfigurationSettings[K]) => {
            activeChangeEvents.scheduleAndTrackTask(() => cb(value));
        };
        return emitter.event(awaitableCallback);
    }

    isDefaultValue<K extends keyof ExtensionConfigurationSettings>(setting: K, configurationScope?: vscode.ConfigurationScope) {
        const settings = vscode.workspace.getConfiguration('cmake', configurationScope);
        const value = settings.inspect(setting);
        return value?.globalValue === undefined && value?.workspaceValue === undefined && value?.workspaceFolderValue === undefined;
    }

    getSettingsChangePromise() {
        return activeChangeEvents.getAwaiter();
    }
}

/**
 * Tracks work that is done as a result of a settings change.
 */
class PromiseTracker {
    private promises: Set<any> = new Set();

    constructor() {
    }

    public scheduleAndTrackTask(cb: () => any): void {
        const selfDestructWrapper = util.scheduleTask(() => {
            const result = cb();
            return result;
        }).then(() => {
            this.promises.delete(selfDestructWrapper);
        });
        this.promises.add(selfDestructWrapper);
    }

    public getAwaiter(): Promise<any[]> {
        return Promise.all(this.promises);
    }
}

const activeChangeEvents: PromiseTracker = new PromiseTracker();

/**
 * Get a promise that will resolve when the current set of settings change handlers have completed.
 */
export function getSettingsChangePromise(): Promise<any[]> {
    return activeChangeEvents.getAwaiter();
}

export function checkConfigureOverridesPresent(config: ConfigurationReader): boolean {
    if (config.configureArgs.length > 0 || Object.values(config.configureEnvironment).length > 0 || checkGeneralEnvironmentOverridesPresent(config)) {
        return true;
    }

    return false;
}

export function checkBuildOverridesPresent(config: ConfigurationReader): boolean {
    if (config.buildArgs.length > 0 || config.buildToolArgs.length > 0
        || Object.values(config.buildEnvironment).length > 0 || checkGeneralEnvironmentOverridesPresent(config)) {
        return true;
    }

    return false;
}

export function checkTestOverridesPresent(config: ConfigurationReader): boolean {
    if (Object.values(config.testEnvironment).length > 0 || config.ctestArgs.length > 0 || checkGeneralEnvironmentOverridesPresent(config)) {
        return true;
    }

    return false;
}

export function checkPackageOverridesPresent(config: ConfigurationReader): boolean {
    if (Object.values(config.cpackEnvironment).length > 0 || config.cpackArgs.length > 0 || checkGeneralEnvironmentOverridesPresent(config)) {
        return true;
    }

    return false;
}

export function checkGeneralEnvironmentOverridesPresent(config: ConfigurationReader): boolean {
    return Object.values(config.environment).length > 0;
}
