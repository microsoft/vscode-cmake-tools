'use strict';

import * as path from 'path';
import * as fs from 'fs';
import * as proc from 'child_process';
import * as os from 'os';
import * as yaml from 'js-yaml';
import * as ajv from 'ajv';
import * as vscode from 'vscode';

import * as async from './async';
import * as diagnostics from './diagnostics';
import {util} from './util';

type Maybe<T> = util.Maybe<T>;

const CMAKETOOLS_HELPER_SCRIPT =
`
get_cmake_property(is_set_up _CMAKETOOLS_SET_UP)
if(NOT is_set_up)
    set_property(GLOBAL PROPERTY _CMAKETOOLS_SET_UP TRUE)
    macro(_cmt_invoke fn)
        file(WRITE "\${CMAKE_BINARY_DIR}/_cmt_tmp.cmake" "
            set(_args \\"\${ARGN}\\")
            \${fn}(\\\${_args})
        ")
        include("\${CMAKE_BINARY_DIR}/_cmt_tmp.cmake" NO_POLICY_SCOPE)
    endmacro()

    set(_cmt_add_executable add_executable)
    set(_previous_cmt_add_executable _add_executable)
    while(COMMAND "\${_previous_cmt_add_executable}")
        set(_cmt_add_executable "_\${_cmt_add_executable}")
        set(_previous_cmt_add_executable _\${_previous_cmt_add_executable})
    endwhile()
    macro(\${_cmt_add_executable} target)
        _cmt_invoke(\${_previous_cmt_add_executable} \${ARGV})
        file(APPEND
            "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.in.txt"
            "executable;\${target};$<TARGET_FILE:\${target}>\n"
            )
        _cmt_generate_system_info()
    endmacro()

    set(_cmt_add_library add_library)
    set(_previous_cmt_add_library _add_library)
    while(COMMAND "\${_previous_cmt_add_library}")
        set(_cmt_add_library "_\${_cmt_add_library}")
        set(_previous_cmt_add_library "_\${_previous_cmt_add_library}")
    endwhile()
    macro(\${_cmt_add_library} target)
        _cmt_invoke(\${_previous_cmt_add_library} \${ARGV})
        get_target_property(type \${target} TYPE)
        if(NOT type MATCHES "^(INTERFACE_LIBRARY|OBJECT_LIBRARY)$")
            get_target_property(imported \${target} IMPORTED)
            get_target_property(alias \${target} ALIAS)
            if(NOT imported AND NOT alias)
                file(APPEND
                    "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.in.txt"
                    "library;\${target};$<TARGET_FILE:\${target}>\n"
                    )
            endif()
        else()
            file(APPEND
                "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.in.txt"
                "interface-library;\${target}\n"
                )
        endif()
        _cmt_generate_system_info()
    endmacro()

    file(WRITE "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.in.txt" "")
    file(GENERATE
        OUTPUT "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.txt"
        INPUT "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.in.txt"
        CONDITION "$<CONFIG:Debug>"
        )

    function(_cmt_generate_system_info)
        get_property(done GLOBAL PROPERTY CMT_GENERATED_SYSTEM_INFO)
        if(NOT done)
            file(APPEND "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.in.txt"
    "system;\${CMAKE_HOST_SYSTEM_NAME};\${CMAKE_SYSTEM_PROCESSOR};\${CMAKE_CXX_COMPILER_ID}\n")
        endif()
        set_property(GLOBAL PROPERTY CMT_GENERATED_SYSTEM_INFO TRUE)
    endfunction()
endif()
`

const open = require('open') as ((url: string, appName?: string, callback?: Function) => void);

export function isTruthy(value: (boolean | string | null | undefined | number)) {
    if (typeof value === 'string') {
        return !(
            value === '' ||
            value === 'FALSE' ||
            value === 'OFF' ||
            value === '0' ||
            value === 'NOTFOUND' ||
            value === 'NO' ||
            value === 'N' ||
            value === 'IGNORE' ||
            value.endsWith('-NOTFOUND')
        );
    }
    return !!value;
}

interface ExecuteOptions {
    silent: boolean;
};

interface ExecutableTarget {
    name: string;
    path: string;
}

export enum EntryType {
    Bool,
    String,
    Path,
    Filepath,
    Internal,
    Uninitialized,
    Static,
};

interface ExecutionResult {
    retc: Number;
    stdout: string;
    stderr: string;
}

interface FileDiagnostic {
    filepath: string;
    diag: vscode.Diagnostic;
}

export class CacheEntry {
    private _type: EntryType = EntryType.Uninitialized;
    private _docs: string = '';
    private _key: string = '';
    private _value: any = null;

    public get type() {
        return this._type;
    }

    public get docs() {
        return this._docs;
    }

    public get key() {
        return this._key;
    }

    public get value() {
        return this._value;
    }

    public as<T>(): T { return this.value; }

    constructor(key: string, value: string, type: EntryType, docs: string) {
        this._key = key ;
        this._value = value;
        this._type = type;
        this._docs = docs;
    }
    // public advanced: boolean = false;
};

export class CMakeCache {
    private _entries: Map<string, CacheEntry>;

    public static async fromPath(path: string): Promise<CMakeCache> {
        const exists = await async.exists(path);
        if (exists) {
            const content = await async.readFile(path);
            const entries = await CMakeCache.parseCache(content.toString());
            return new CMakeCache(path, exists, entries);
        } else {
            return new CMakeCache(path, exists, new Map());
        }
    }

    constructor(path: string, exists: boolean, entries: Map<string, CacheEntry>) {
        this._entries = entries;
        this._path = path;
        this._exists = exists;
    }

    private _exists: boolean = false;
    public get exists() {
        return this._exists;
    }

    private _path: string = '';
    public get path() {
        return this._path;
    }

    public getReloaded(): Promise<CMakeCache> {
        return CMakeCache.fromPath(this.path);
    }

    public static parseCache(content: string): Map<string, CacheEntry> {
        const lines = content.split(/\r\n|\n|\r/)
            .filter(line => !!line.length)
            .filter(line => !/^\s*#/.test(line));

        const entries = new Map<string, CacheEntry>();
        let docs_acc = '';
        for (const line of lines) {
            if (!line)
                continue;
            if (line.startsWith('//')) {
                docs_acc += /^\/\/(.*)/.exec(line)[1] + ' ';
            } else {
                const match = /^(.*?):(.*?)=(.*)/.exec(line);
                console.assert(!!match, "Couldn't handle reading cache entry: " + line);
                const [_, name, typename, valuestr] = match;
                if (!name || !typename)
                    continue;
                if (name.endsWith('-ADVANCED') && valuestr == '1') {
                    // We skip the ADVANCED property variables. They're a little odd.
                } else {
                    const key = name;
                    const type: EntryType = {
                        BOOL: EntryType.Bool,
                        STRING: EntryType.String,
                        PATH: EntryType.Path,
                        FILEPATH: EntryType.Filepath,
                        INTERNAL: EntryType.Internal,
                        UNINITIALIZED: EntryType.Uninitialized,
                        STATIC: EntryType.Static,
                    }[typename];
                    const docs = docs_acc.trim();
                    docs_acc = '';
                    let value: any = valuestr;
                    if (type === EntryType.Bool)
                        value = isTruthy(value);

                    console.assert(type !== undefined, `Unknown cache entry type: ${type}`);
                    entries.set(name, new CacheEntry(key, value, type, docs));
                }
            }
        }

        return entries;
    }

    public get(key: string, defaultValue?: any): Maybe<CacheEntry> {
        if (!this._entries.has(key))
            return null;
        return this._entries.get(key);
    }
}

export namespace WorkspaceCacheFile {
    export async function readCache(path: string, defaultVal: util.WorkspaceCache): Promise<util.WorkspaceCache> {
        console.info('Reloading cmake-tools extension cache data from', path);
        try {
            const buf = await async.readFile(path);
            if (!buf) return defaultVal;
            return JSON.parse(
                buf.toString(),
                (key: string, val) => {
                    if (key === 'keywordSettings') {
                        const acc = new Map<string, string>();
                        for (const key in val) {
                            acc.set(key, val[key]);
                        }
                        return acc;
                    }
                    return val;
                }
            );
        }
        catch(err) {
            return defaultVal;
        }
    }

    export function writeCache(path: string, cache: util.WorkspaceCache) {
        return async.doAsync(
            fs.writeFile,
            path,
            JSON.stringify(
                cache,
                (key, value) => {
                    if (key === 'keywordSettings' && value instanceof Map) {
                        return Array.from((value as Map<string, string>).entries()).reduce(
                            (acc, el) => {
                                acc[el[0]] = el[1];
                                return acc;
                            },
                            {}
                        );
                    }
                    return value;
                },
                2
            )
        );
    }
}

export class ConfigurationReader {
    public readConfig<T>(key: string, default_: Maybe<T> = null) : Maybe<T> {
        const config = vscode.workspace.getConfiguration('cmake');
        const value = config.get(key);
        return (value !== undefined) ? value as T : default_;
    }

    get buildDirectory(): string {
        return this.readConfig<string>('buildDirectory') as string;
    }

    get installPrefix(): Maybe<string> {
        return this.readConfig<string>('installPrefix');
    }

    get sourceDirectory(): string {
        return this.readConfig<string>('sourceDirectory') as string;
    }

    get saveBeforeBuild(): boolean {
        return !!this.readConfig<boolean>('saveBeforeBuild');
    }

    get clearOutputBeforeBuild(): boolean {
        return !!this.readConfig<boolean>('clearOutputBeforeBuild');
    }

    get configureSettings(): any {
        return this.readConfig<Object>('configureSettings');
    }

    get initialBuildType(): Maybe<string> {
        return this.readConfig<string>('initialBuildType');
    }

    get preferredGenerators(): string[] {
        return this.readConfig<string[]>('preferredGenerators') || [];
    }

    get generator(): Maybe<string> {
        const platform = {
            win32: 'windows',
            darwin: 'osx',
            linux: 'linux'
        }[os.platform()];
        return this.readConfig<string>(`generator.${platform}`, this.readConfig<string>('generator.all'));
    }

    get toolset(): Maybe<string> {
        const platform = {
            win32: 'windows',
            darwin: 'osx',
            linux: 'linux'
        }[os.platform()];
        return this.readConfig<string>(`toolset.${platform}`, this.readConfig<string>(`toolset.all`));
    }

    get configureArgs(): string[] {
        return this.readConfig<string[]>('configureArgs') as string[];
    }

    get buildArgs(): string[] {
        return this.readConfig<string[]>('buildArgs') as string[];
    }

    get buildToolArgs(): string[] {
        return this.readConfig<string[]>('buildToolArgs') as string[];
    }

    get parallelJobs(): Maybe<number> {
        return this.readConfig<number>('parallelJobs');
    }

    get ctest_parallelJobs(): Maybe<number> {
        return this.readConfig<number>('ctest.parallelJobs');
    }

    get parseBuildDiagnostics(): boolean {
        return !!this.readConfig<boolean>('parseBuildDiagnostics');
    }

    get cmakePath(): string {
        return this.readConfig<string>('cmakePath') as string;
    }

    // TODO: Implement a DebugConfig interface type
    // get debugConfig(): DebugConfig {
    //     return this._read<DebugConfig>('debugConfig');
    // }

    get experimental_enableTargetDebugging(): boolean {
        return !!this.readConfig<boolean>('experimental.enableTargetDebugging');
    }
}

export class CMakeTools {
    private _context: vscode.ExtensionContext;
    private _channel: vscode.OutputChannel;
    private _diagnostics: vscode.DiagnosticCollection;
    private _cmakeToolsStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.5);
    private _buildButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.4);
    private _targetButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.3);
    private _debugButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.2);
    private _debugTargetButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.1);
    private _warningMessage = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3);
    private _lastConfigureSettings = {};
    private _needsReconfigure = false;
    private _buildDiags: vscode.DiagnosticCollection;
    private _workspaceCacheContent: util.WorkspaceCache;
    private _workspaceCachePath = path.join(vscode.workspace.rootPath, '.vscode', '.cmaketools.json');
    private _targets: string[];
    private _variantWatcher: vscode.FileSystemWatcher;
    public os: Maybe<string>;
    public systemProcessor: Maybe<string>;
    public compilerId: Maybe<string>;
    public config: ConfigurationReader = new ConfigurationReader();

    private _cmakeCache: CMakeCache;
    public get cmakeCache() {
        return this._cmakeCache;
    }
    public set cmakeCache(cache: CMakeCache) {
        this._cmakeCache = cache;
        this._refreshStatusBarItems();
    }

    private _currentChildProcess: Maybe<proc.ChildProcess>;
    public get currentChildProcess(): Maybe<proc.ChildProcess> {
        return this._currentChildProcess;
    }
    public set currentChildProcess(v: Maybe<proc.ChildProcess>) {
        this._currentChildProcess = v;
        this._refreshStatusBarItems();
    }

    /**
     * A property that determines whether we are currently running a job
     * or not.
     */
    public get isBusy(): boolean {
        return !!this.currentChildProcess;
    }
    /**
     * @brief The status message for the status bar.
     *
     * When this value is changed, we update our status bar item to show the
     * statusMessage. This could be something like 'Configuring...',
     * 'Building...' etc.
     */
    private _statusMessage: string = '';
    public get statusMessage(): string {
        return this._statusMessage;
    }
    public set statusMessage(v: string) {
        this._statusMessage = v;
        this._refreshStatusBarItems();
    }

    /**
     * @brief The build type (configuration) which the user has most recently
     * selected.
     *
     * The build type is passed to CMake when configuring and building the
     * project. For multiconf generators, such as visual studio with msbuild,
     * the build type is not determined at configuration time. We need to store
     * the build type that the user wishes to use here so that when a user
     * invokes cmake.build, we will be able to build with the desired
     * configuration. This value is also reflected on the status bar item that
     * the user can click to change the build type.
     */
    public get selectedBuildType(): Maybe<string> {
        const cached = this.activeVariant.buildType;
        return cached ? cached : null;
    }

    public get debugTargetsEnabled(): boolean {
        return this.config.experimental_enableTargetDebugging;
    }

    /**
     * @brief The default target to build when no target is specified
     */
    private _defaultBuildTarget: string;
    public get defaultBuildTarget(): string {
        return this._defaultBuildTarget;
    }
    public set defaultBuildTarget(v: string) {
        this._defaultBuildTarget = v;
        this._refreshStatusBarItems();
    }

    private async reloadCMakeCache() {
        if (this.cmakeCache && this.cmakeCache.path === this.cachePath) {
            this.cmakeCache = await this.cmakeCache.getReloaded();
        } else {
            this.cmakeCache = await CMakeCache.fromPath(this.cachePath);
        }
        return this.cmakeCache;
    }

    private _executableTargets: ExecutableTarget[];
    public get executableTargets() {
        return this._executableTargets;
    }

    public set executableTargets(value: ExecutableTarget[]) {
        this._executableTargets = value;
        if (!value) {
            this.currentDebugTarget = null;
            return;
        }
        // Check if the currently selected debug target is no longer a target
        if (value.findIndex(e => e.name === this.currentDebugTarget) < 0) {
            if (value.length) {
                this.currentDebugTarget = value[0].name;
            } else {
                this.currentDebugTarget = null;
            }
        }
        // If we didn't have a debug target, set the debug target to the first target
        if (this.currentDebugTarget === null && value.length) {
            this.currentDebugTarget = value[0].name;
        }
    }

    private _currentDebugTarget: Maybe<string>;
    public get currentDebugTarget(): Maybe<string> {
        return this._currentDebugTarget;
    }
    public set currentDebugTarget(v: Maybe<string>) {
        this._currentDebugTarget = v;
        this._refreshStatusBarItems();
    }

    private async _reloadMetaData() {
        if (await async.exists(this.metaPath)) {
            const buffer = await async.readFile(this.metaPath);
            const content = buffer.toString();
            const tuples = content
                .split('\n')
                .map(l => l.trim())
                .filter(l => !!l.length)
                .map(l => l.split(';'));
            this.executableTargets = tuples
                .filter(tup => tup[0] === 'executable')
                .map(tup => ({
                    name: tup[1],
                    path: tup[2],
                }));
            const [_, os, proc, cid] = tuples.find(tup => tup[0] === 'system');
            this.os = os || null;
            this.systemProcessor = proc || null;
            this.compilerId = cid || null;
        } else {
            this.executableTargets = [];
            this.os = null;
            this.systemProcessor = null;
            this.compilerId = null;
        }
    }

    private _reloadConfiguration() {
        const new_settings = this.config.configureSettings;
        this._needsReconfigure = JSON.stringify(new_settings) !== JSON.stringify(this._lastConfigureSettings);
        this._lastConfigureSettings = new_settings;
        // A config change could require reloading the CMake Cache (ie. changing the build path)
        this._setupCMakeCacheWatcher();
        // Use may have disabled build diagnostics.
        if (!this.config.parseBuildDiagnostics) {
            this._buildDiags.clear();
        }
        if (this.debugTargetsEnabled && !this._metaWatcher) {
            this._setupMetaWatcher();
        }
        this._refreshStatusBarItems();
    }

    private _wsCacheWatcher: vscode.FileSystemWatcher;
    private _setupWorkspaceCacheWatcher() {
        if (this._wsCacheWatcher) {
            this._wsCacheWatcher.dispose();
        }
        const watch = this._wsCacheWatcher = vscode.workspace.createFileSystemWatcher(this._workspaceCachePath);
        watch.onDidChange(this._refreshWorkspaceCacheContent.bind(this));
        watch.onDidCreate(this._refreshWorkspaceCacheContent.bind(this));
    }

    private _writeWorkspaceCacheContent() {
        return WorkspaceCacheFile.writeCache(this._workspaceCachePath, this._workspaceCacheContent);
    }

    private async _refreshWorkspaceCacheContent() {
        this._workspaceCacheContent = await WorkspaceCacheFile.readCache(this._workspaceCachePath, {variant:null});
        this._writeWorkspaceCacheContent();
        this._setupCMakeCacheWatcher();
        if (this._workspaceCacheContent.variant) {
            this.activeVariantCombination = this._workspaceCacheContent.variant;
        }
        this._refreshStatusBarItems();
    }

    private _cmCacheWatcher: vscode.FileSystemWatcher;

    private _setupCMakeCacheWatcher() {
        if (this._cmCacheWatcher) {
            this._cmCacheWatcher.dispose();
        }
        this._cmCacheWatcher = vscode.workspace.createFileSystemWatcher(this.cachePath);
        this._cmCacheWatcher.onDidChange(this.reloadCMakeCache.bind(this));
        this._cmCacheWatcher.onDidCreate(this.reloadCMakeCache.bind(this));
        this._cmCacheWatcher.onDidDelete(() => {
            this.reloadCMakeCache().then(() => {
                this._refreshStatusBarItems();
            });
        });
        return this.reloadCMakeCache();
    }

    private _metaWatcher: vscode.FileSystemWatcher;

    private _setupMetaWatcher() {
        if (this._metaWatcher) {
            this._metaWatcher.dispose();
        }
        this._metaWatcher = vscode.workspace.createFileSystemWatcher(this.metaPath);
        this._metaWatcher.onDidChange(this._reloadMetaData.bind(this));
        this._metaWatcher.onDidCreate(this._reloadMetaData.bind(this));
        this._metaWatcher.onDidDelete(this._reloadMetaData.bind(this));
        this._reloadMetaData();
    }

    private async _reloadVariants() {
        const schema_path = this._context.asAbsolutePath('schemas/variants-schema.json');
        const schema = JSON.parse((await async.readFile(schema_path)).toString());
        const validate = new ajv({
            allErrors: true,
            format: 'full',
        }).compile(schema);

        const workdir = vscode.workspace.rootPath;
        const yaml_file = path.join(workdir, 'cmake-variants.yaml');
        const json_file = path.join(workdir, 'cmake-variants.json');
        let variants: any;
        if (await async.exists(yaml_file)) {
            const content = (await async.readFile(yaml_file)).toString();
            try {
                variants = yaml.load(content);
            } catch(e) {
                vscode.window.showErrorMessage(`${yaml_file} is syntactically invalid.`);
                variants = util.DEFAULT_VARIANTS;
            }
        } else if (await async.exists(json_file)) {
            const content = (await async.readFile(json_file)).toString();
            try {
                variants = JSON.parse(content);
            } catch(e) {
                vscode.window.showErrorMessage(`${json_file} is syntactically invalid.`);
                variants = util.DEFAULT_VARIANTS;
            }
        } else {
            variants = util.DEFAULT_VARIANTS;
        }
        const validated = validate(variants);
        if (!validated) {
            const errors = validate.errors as ajv.ErrorObject[];
            const error_strings = errors.map(err => `${err.dataPath}: ${err.message}`);
            vscode.window.showErrorMessage(`Invalid cmake-variants: ${error_strings.join('; ')}`);
        } else {
            const sets = new Map() as util.VariantSet;
            for (const key in variants) {
                const sub = variants[key];
                const def = sub['-default'];
                const desc = sub['-description'];
                const choices = new Map<string, util.VariantConfigurationOptions>();
                for (const name in sub) {
                    if (!name || ['-default', '-description'].indexOf(name) !== -1) {
                        continue;
                    }
                    const settings = sub[name] as util.VariantConfigurationOptions;
                    choices.set(name, settings);
                }
                sets.set(key, {
                    description: desc,
                    default: def,
                    choices: choices
                });
            }
            this.buildVariants = sets;
        }
    }

    private _buildVariants : util.VariantSet;
    public get buildVariants() : util.VariantSet {
        return this._buildVariants;
    }
    public set buildVariants(v : util.VariantSet) {
        this._buildVariants = v;
        this._refreshStatusBarItems();
    }

    public get activeVariant() : util.VariantConfigurationOptions {
        const vari = this._workspaceCacheContent.variant;
        if (!vari) {
            return {};
        }
        const kws = vari.keywordSettings;
        if (!kws) {
            return {};
        }
        const vars = this.buildVariants;
        const data = Array.from(kws.entries()).map(
            ([param, setting]) => {
                if (!vars.has(param)) {
                    debugger;
                    throw 12;
                }
                const choices = vars.get(param).choices;
                if (!choices.has(setting)) {
                    debugger;
                    throw 12;
                }
                return choices.get(setting);
            }
        );
        const result: util.VariantConfigurationOptions = data.reduce(
            (el, acc) => ({
                buildType: el.buildType || acc.buildType,
                generator: el.generator || acc.generator,
                linkage: el.linkage || acc.linkage,
                toolset: el.toolset || acc.toolset,
                settings: Object.assign(acc.settings || {}, el.settings || {})
            }),
            {}
        )
        return result;
    }

    private _variantKeywordSettings : Map<string, string>;
    public get variantKeywordSettings() : Map<string, string> {
        return this._variantKeywordSettings;
    }
    public set variantKeywordSettings(v : Map<string, string>) {
        this._variantKeywordSettings = v;
    }

    private _activeVariantCombination : util.VariantCombination;
    public get activeVariantCombination() : util.VariantCombination {
        return this._activeVariantCombination;
    }
    public set activeVariantCombination(v : util.VariantCombination) {
        this._activeVariantCombination = v;
        this._workspaceCacheContent.variant = v;
        this._writeWorkspaceCacheContent();
        this._refreshStatusBarItems();
    }

    private async _init(ctx: vscode.ExtensionContext): Promise<void> {
        this._channel = vscode.window.createOutputChannel('CMake/Build');
        this._channel = vscode.window.createOutputChannel('CMake/Build');
        this._diagnostics = vscode.languages.createDiagnosticCollection('cmake-diags');
        this._buildDiags = vscode.languages.createDiagnosticCollection('cmake-build-diags');

        const watcher = this._variantWatcher = vscode.workspace.createFileSystemWatcher(path.join(vscode.workspace.rootPath, 'cmake-variants.*'));
        watcher.onDidChange(this._reloadVariants.bind(this));
        watcher.onDidCreate(this._reloadVariants.bind(this));
        watcher.onDidDelete(this._reloadVariants.bind(this));
        await this._reloadVariants();

        this._workspaceCacheContent = await WorkspaceCacheFile.readCache(this._workspaceCachePath, {variant: null});
        if (this._workspaceCacheContent.variant) {
            this._activeVariantCombination = this._workspaceCacheContent.variant;
        }

        // Load up the CMake cache
        await this._setupCMakeCacheWatcher();
        this._currentChildProcess = null;
        if (this.debugTargetsEnabled) {
            this._setupMetaWatcher();
        }
        this._reloadConfiguration();

        await this._refreshTargetList();
        this.statusMessage = 'Ready';

        this._lastConfigureSettings = this.config.configureSettings;
        this._needsReconfigure = true;
        vscode.workspace.onDidChangeConfiguration(() => {
            console.log('Reloading CMakeTools after configuration change');
            this._reloadConfiguration();
        });

        const dontBother = ctx.globalState.get<Maybe<boolean>>('debugTargets.neverBother');
        if (!this.debugTargetsEnabled && !dontBother && Math.random() < 0.1) {
            vscode.window.showInformationMessage(
                'Did you know CMake Tools now provides experimental debugger integration?',
                {
                    title: 'Don\'t bother me again',
                    action: 'never'
                },
                {
                    title: 'Tell me more',
                    action: 'open_link'
                }).then(chosen => {
                    if (chosen.action === 'never') {
                        ctx.globalState.update('debugTargets.neverBother', true);
                    } else if (chosen.action === 'open_link') {
                        open('https://github.com/vector-of-bool/vscode-cmake-tools/blob/develop/docs/target_debugging.md');
                    }
                });
        }
    }

    constructor(ctx: vscode.ExtensionContext) {
        this._context = ctx;
        this._init(ctx);
    }

    /**
     * @brief Refreshes the content of the status bar items.
     *
     * This only changes the visible content, and doesn't manipulate the state
     * of the extension.
     */
    private _refreshStatusBarItems() {
        this._cmakeToolsStatusItem.command = 'cmake.setBuildType';
        const varset = this.activeVariantCombination || {label: 'Unknown'}
        this._cmakeToolsStatusItem.text = `CMake: ${this.projectName}: ${varset.label || 'Unknown'}: ${this.statusMessage}`;

        if (this.cmakeCache &&
                this.cmakeCache.exists &&
                this.isMultiConf &&
                this.config.buildDirectory.includes('${buildType}')
            ) {
            vscode.window.showWarningMessage('It is not advised to use ${buildType} in the cmake.buildDirectory settings when the generator supports multiple build configurations.');
        }

        async.exists(path.join(this.sourceDir, 'CMakeLists.txt')).then(exists => {
            if (exists) {
                this._cmakeToolsStatusItem.show();
                this._buildButton.show();
                this._targetButton.show();
                if (this.debugTargetsEnabled) {
                    this._debugButton.show();
                    this._debugTargetButton.show();
                }
            } else {
                this._cmakeToolsStatusItem.hide();
                this._buildButton.hide();
                this._targetButton.hide();
                this._debugButton.hide();
                this._debugTargetButton.hide();
            }
            if (!this.debugTargetsEnabled) {
                this._debugButton.hide();
                this._debugTargetButton.hide();
            }
        });

        this._buildButton.text = this.isBusy ? '$(x) Stop' : `$(gear) Build:`;
        this._buildButton.command = this.isBusy ? 'cmake.stop' : 'cmake.build';
        this._targetButton.text = this.defaultBuildTarget || this.allTargetName;
        this._targetButton.command = 'cmake.setDefaultTarget';
        this._targetButton.tooltip = 'Click to change the default target'
        this._debugButton.text = '$(bug)';
        this._debugButton.command = 'cmake.debugTarget';
        this._debugButton.tooltip = 'Run the debugger on the selected target executable';
        this._debugTargetButton.text = this.currentDebugTarget || '[No target selected for debugging]';
        this._debugTargetButton.command = 'cmake.selectDebugTarget';
    }

    public get projectName() {
        if (!this.cmakeCache || !this.cmakeCache.exists) {
            return 'Unconfigured';
        }
        const cached = this.cmakeCache.get('CMAKE_PROJECT_NAME');
        return cached ? cached.as<string>() : 'Unnamed Project';
    }

    /**
     * @brief Reload the list of available targets
     */
    private async _refreshTargetList(): Promise<string[]> {
        this._targets = [];
        const cachepath = this.cachePath;
        if (!this.cmakeCache.exists) {
            return this._targets;
        }
        this.statusMessage = 'Refreshing targets...';
        const generator = this.activeGenerator;
        if (generator && /(Unix|MinGW|NMake) Makefiles|Ninja/.test(generator)) {
            const result = await this.execute(['--build', this.binaryDir, '--target', 'help'], {
                silent: true
            });
            const lines = result.stdout.split('\n');
            const important_lines = (generator.endsWith('Makefiles')
                ? lines.filter(l => l.startsWith('... '))
                : lines.filter(l => l.indexOf(': ') !== -1))
                    .filter(l => !l.includes('All primary targets'));
            this._targets = important_lines
                .map(l => generator.endsWith('Makefiles')
                        ? l.substr(4)
                        : l)
                .map(l => / /.test(l) ? l.substr(0, l.indexOf(' ')) : l)
                .map(l => l.replace(':', ''));
        }
        this.statusMessage = 'Ready';
        return this._targets;
    }

    /**
     * @brief Parses a diagnostic message from GCC
     *
     * @returns A FileDiagnostic obtained from the message, or null if no
     *      message could be decoded.
     */
    public parseGCCDiagnostic(line: string): Maybe<FileDiagnostic> {
        const diag = diagnostics.parseGCCDiagnostic(line);
        if (!diag) {
            return null;
        }
        const abspath = path.isAbsolute(diag.file)
            ? diag.file
            : path.normalize(path.join(this.binaryDir, diag.file));
        const vsdiag = new vscode.Diagnostic(
            new vscode.Range(diag.line, diag.column, diag.line, diag.column),
            diag.message,
            {
                error: vscode.DiagnosticSeverity.Error,
                warning: vscode.DiagnosticSeverity.Warning,
                note: vscode.DiagnosticSeverity.Information,
            }[diag.severity]
        );
        vsdiag.source = 'GCC';
        return {
            filepath: abspath,
            diag: vsdiag,
        };
    }

    /**
     * @brief Parse GNU-style linker errors
     */
    public parseGNULDDiagnostic(line: string): Maybe<FileDiagnostic> {
        const diag = diagnostics.parseGNULDDiagnostic(line);
        if (!diag) {
            return null;
        }
        const abspath = path.isAbsolute(diag.file) ? diag.file : path.normalize(path.join(this.binaryDir, diag.file));
        const vsdiag = new vscode.Diagnostic(
            new vscode.Range(diag.line, 0, diag.line, Number.POSITIVE_INFINITY),
            diag.message,
            {
                error: vscode.DiagnosticSeverity.Error,
                warning: vscode.DiagnosticSeverity.Warning,
                note: vscode.DiagnosticSeverity.Information,
            }[diag.severity]
        );
        vsdiag.source = 'Link';
        return {
            filepath: abspath,
            diag: vsdiag,
        };
    }

    /**
     * @brief Obtains a reference to a TextDocument given the name of the file
     */
    private getTextDocumentByFileName(file: string): Maybe<vscode.TextDocument> {
        const documents = vscode.workspace.textDocuments;
        let document: Maybe<vscode.TextDocument> = null;
        if (documents.length != 0) {
            const filtered = documents.filter((doc: vscode.TextDocument) => {
                return doc.fileName.toUpperCase() === file.toUpperCase()
            });
            if (filtered.length != 0) {
                document = filtered[0];
            }
        }
        return document;
    }

    /**
     * @brief Gets the range of the text of a specific line in the given file.
     */
    private getTrimmedLineRange(file: string, line: number): vscode.Range {
        const document = this.getTextDocumentByFileName(file);
        if (document && (line < document.lineCount)) {
            const text = document.lineAt(line).text + '\n';
            let start = 0;
            let end = text.length - 1;
            let is_space = (i) => { return /\s/.test(text[i]); };
            while ((start < text.length) && is_space(start))++start;
            while ((end >= start) && is_space(end))--end;

            return new vscode.Range(line, start, line, end);
        } else
            return new vscode.Range(line, 0, line, 0);
    }

    /**
     * @brief Parses an MSVC diagnostic.
     *
     * @returns a FileDiagnostic from the given line, or null if no diagnostic
     *      could be parsed
     */
    public parseMSVCDiagnostic(line: string): Maybe<FileDiagnostic> {
        const msvc_re = /^\s*(?!\d+>)\s*([^\s>].*)\((\d+|\d+,\d+|\d+,\d+,\d+,\d+)\):\s+(error|warning|info)\s+(\w{1,2}\d+)\s*:\s*(.*)$/;
        const res = msvc_re.exec(line);
        if (!res)
            return null;
        const file = res[1];
        const location = res[2];
        const severity = res[3];
        const code = res[4];
        const message = res[5];
        const abspath = path.isAbsolute(file)
            ? file
            : path.normalize(path.join(this.binaryDir, file));
        const loc = (() => {
            const parts = location.split(',');
            if (parts.length === 1)
                return this.getTrimmedLineRange(file, Number.parseInt(parts[0]) - 1);
            if (parseFloat.length === 2)
                return new vscode.Range(
                    Number.parseInt(parts[0]) - 1,
                    Number.parseInt(parts[1]) - 1,
                    Number.parseInt(parts[0]) - 1,
                    Number.parseInt(parts[1]) - 1
                );
            if (parseFloat.length === 4)
                return new vscode.Range(
                    Number.parseInt(parts[0]) - 1,
                    Number.parseInt(parts[1]) - 1,
                    Number.parseInt(parts[2]) - 1,
                    Number.parseInt(parts[3]) - 1
                );
            throw new Error('Unable to determine location of MSVC error');
        })();
        const diag = new vscode.Diagnostic(
            loc,
            message,
            {
                error: vscode.DiagnosticSeverity.Error,
                warning: vscode.DiagnosticSeverity.Warning,
                info: vscode.DiagnosticSeverity.Information,
            }[severity]
        );
        diag.code = code;
        diag.source = 'MSVC';
        return {
            filepath: abspath,
            diag: diag,
        };
    }

    /**
     * @brief Parses a line of compiler output to try and find a diagnostic
     *      message.
     */
    public parseDiagnosticLine(line: string): Maybe<FileDiagnostic> {
        return this.parseGCCDiagnostic(line) ||
            this.parseGNULDDiagnostic(line) ||
            this.parseMSVCDiagnostic(line);
    }

    /**
     * @brief Takes a reference to a compiler execution output and parses
     *      the diagnostics therein.
     */
    public parseDiagnostics(result: ExecutionResult) {
        const compiler = this.cmakeCache.get('CMAKE_CXX_COMPILER_ID') || this.cmakeCache.get('CMAKE_C_COMPILER_ID');
        const lines = result.stdout.split('\n').map(line => line.trim());
        const diags = lines.map(line => this.parseDiagnosticLine(line)).filter(item => !!item);
        const diags_acc = {};
        for (const diag of diags) {
            if (!diag)
                continue;
            if (!(diag.filepath in diags_acc))
                diags_acc[diag.filepath] = [];
            diags_acc[diag.filepath].push(diag.diag);
        }

        for (const filepath in diags_acc) {
            this._buildDiags.set(vscode.Uri.file(filepath), diags_acc[filepath]);
        }
    }

    /**
     * @brief Read the source directory from the config
     */
    public get sourceDir(): string {
        const dir = this.config.sourceDirectory.replace('${workspaceRoot}', vscode.workspace.rootPath);
        return util.normalizePath(dir);
    }

    /**
     * @brief Get the path to the root CMakeLists.txt
     */
    public get mainListFile(): string {
        const listfile = path.join(this.sourceDir, 'CMakeLists.txt');
        return util.normalizePath(listfile);
    }

    /**
     * @brief Get the path to the binary dir
     */
    public get binaryDir(): string {
        const dir = this.config.buildDirectory
            .replace('${workspaceRoot}', vscode.workspace.rootPath)
            .replace('${buildType}', this.selectedBuildType || 'Unknown');
        return util.normalizePath(dir);
    }

    /**
     * @brief Get the path to the CMakeCache file in the build directory
     */
    public get cachePath(): string {
        const file = path.join(this.binaryDir, 'CMakeCache.txt');
        return util.normalizePath(file);
    }

    /**
     * @brief Get the path to the metadata file
     */
    public get metaPath(): string {
        const meta = path.join(this.binaryDir, 'CMakeToolsMeta.txt');
        return util.normalizePath(meta);
    }

    /**
     * @brief Determine if the project is using a multi-config generator
     */
    public get isMultiConf() {
        return !!this.cmakeCache.get('CMAKE_CONFIGURATION_TYPES');
    }

    public get activeGenerator(): Maybe<string> {
        const gen = this.cmakeCache.get('CMAKE_GENERATOR');
        return gen
            ? gen.as<string>()
            : null;
    }

    /**
     * @brief Get the name of the "all" target
     */
    public get allTargetName() {
        if (!this.cmakeCache || !this.cmakeCache.exists)
            return 'all';
        const gen = this.activeGenerator;
        return (gen && /Visual Studio/.test(gen)) ? 'ALL_BUILD' : 'all';
    }

    /**
     * @brief Execute a CMake command. Resolves to the result of the execution.
     */
    public execute(args: string[], options?: ExecuteOptions): Promise<ExecutionResult> {
        return new Promise<ExecutionResult>((resolve, _) => {
            const silent: boolean = options && options.silent || false;
            console.info('Execute cmake with arguments:', args);
            const pipe = proc.spawn(this.config.cmakePath, args);
            const status = msg => vscode.window.setStatusBarMessage(msg, 4000);
            if (!silent) {
                this.currentChildProcess = pipe;
                status('Executing CMake...');
                this._channel.appendLine(
                    '[vscode] Executing cmake command: cmake '
                    // We do simple quoting of arguments with spaces.
                    // This is only shown to the user,
                    // and doesn't have to be 100% correct.
                    + args
                        .map(a => a.replace('"', '\"'))
                        .map(a => /[ \n\r\f;\t]/.test(a) ? `"${a}"` : a)
                        .join(' ')
                );
            }
            let stderr_acc = '';
            let stdout_acc = '';
            pipe.stdout.on('data', (data: Uint8Array) => {
                const str = data.toString();
                console.log('cmake [stdout]: ' + str.trim());
                if (!silent) {
                    this._channel.append(str);
                    status(str.trim());
                }
                stdout_acc += str;
            });
            pipe.stderr.on('data', (data: Uint8Array) => {
                const str = data.toString();
                console.log('cmake [stderr]: ' + str.trim());
                if (!silent) {
                    status(str.trim());
                    this._channel.append(str);
                }
                stderr_acc += str;
            });
            pipe.on('close', (retc: Number) => {
                console.log('cmake exited with return code ' + retc);
                if (silent) {
                    resolve({
                        retc: retc,
                        stdout: stdout_acc,
                        stderr: stderr_acc
                    });
                    return;
                }
                this._channel.appendLine('[vscode] CMake exited with status ' + retc);
                if (retc !== null) {
                    status('CMake exited with status ' + retc);
                    if (retc !== 0) {
                        this._warningMessage.color = 'yellow';
                        this._warningMessage.text = `$(alert) CMake failed with status ${retc}. See CMake/Build output for details`;
                        this._warningMessage.show();
                        setTimeout(() => this._warningMessage.hide(), 5000);
                    }
                }

                let rest = stderr_acc;
                const diag_re = /CMake (.*?) at (.*?):(\d+) \((.*?)\):\s+((?:.|\n)*?)\s*\n\n\n((?:.|\n)*)/;
                const diags: Object = {};
                while (true) {
                    if (!rest.length) break;
                    const found = diag_re.exec(rest);
                    if (!found) break;
                    const [level, filename, linestr, command, what, tail] = found.slice(1);
                    if (!filename || !linestr || !what || !level)
                        continue;
                    const filepath =
                        path.isAbsolute(filename)
                            ? filename
                            : path.join(vscode.workspace.rootPath, filename);

                    const line = Number.parseInt(linestr) - 1;
                    if (!(filepath in diags)) {
                        diags[filepath] = [];
                    }
                    const file_diags: vscode.Diagnostic[] = diags[filepath];
                    const diag = new vscode.Diagnostic(
                        new vscode.Range(
                            line,
                            0,
                            line,
                            Number.POSITIVE_INFINITY
                        ),
                        what,
                        {
                            "Warning": vscode.DiagnosticSeverity.Warning,
                            "Error": vscode.DiagnosticSeverity.Error,
                        }[level]
                    );
                    diag.source = 'CMake (' + command + ')';
                    file_diags.push(diag);
                    rest = tail || '';
                }

                this._diagnostics.clear();
                for (const filepath in diags) {
                    this._diagnostics.set(vscode.Uri.file(filepath), diags[filepath]);
                }
                this.currentChildProcess = null;
                resolve({
                    retc: retc,
                    stdout: stdout_acc,
                    stderr: stderr_acc
                });
            });
        });
    };

    // Test that a command exists
    public async testHaveCommand(command, args: string[] = ['--version']): Promise<Boolean> {
        return await new Promise<Boolean>((resolve, _) => {
            const pipe = proc.spawn(command, args);
            pipe.on('error', () => resolve(false));
            pipe.on('exit', () => resolve(true));
        });
    }

    // Given a list of CMake generators, returns the first one available on this system
    public async pickGenerator(candidates: string[]): Promise<Maybe<string>> {
        // The user can override our automatic selection logic in their config
        const generator = this.config.generator;
        if (generator) {
            // User has explicitly requested a certain generator. Use that one.
            return generator;
        }
        for (const gen of candidates) {
            if (!gen)
                continue;
            const delegate = {
                Ninja: async function () {
                    return await this.testHaveCommand('ninja-build') || await this.testHaveCommand('ninja');
                },
                "MinGW Makefiles": async function () {
                    return process.platform === 'win32' && await this.testHaveCommand('make');
                },
                "NMake Makefiles": async function () {
                    return process.platform === 'win32' && await this.testHaveCommand('nmake', ['/?']);
                },
                'Unix Makefiles': async function () {
                    return process.platform !== 'win32' && await this.testHaveCommand('make');
                }
            }[gen];
            if (delegate === undefined) {
                const vsMatcher = /^Visual Studio (\d{2}) (\d{4})($|\sWin64$|\sARM$)/;
                if (vsMatcher.test(gen) && process.platform === 'win32')
                    return gen;
                vscode.window.showErrorMessage('Unknown CMake generator "' + gen + '"');
                continue;
            }
            if (await delegate.bind(this)())
                return gen;
            else
                console.log('Generator "' + gen + '" is not supported');
        }
        return null;
    }

    private async _prebuild() {
        if (this.config.clearOutputBeforeBuild) {
            this._channel.clear();
        }

        if (this.config.saveBeforeBuild && vscode.workspace.textDocuments.some(doc => doc.isDirty)) {
            this._channel.appendLine("[vscode] Saving unsaved text documents...");
            await vscode.workspace.saveAll();
        }
    }

    public get numJobs(): number {
        const jobs = this.config.parallelJobs;
        if (!!jobs) {
            return jobs;
        }
        return os.cpus().length + 2;
    }

    public get numCTestJobs(): number {
        const ctest_jobs = this.config.ctest_parallelJobs;
        if (!ctest_jobs) {
            return this.numJobs;
        }
        return ctest_jobs;
    }

    public async configure(extra_args: string[] = [], run_prebuild = true): Promise<Number> {
        if (this.isBusy) {
            vscode.window.showErrorMessage('A CMake task is already running. Stop it before trying to configure.');
            return -1;
        }

        if (!this.sourceDir) {
            vscode.window.showErrorMessage('You do not have a source directory open');
            return -1;
        }

        const cmake_list = this.mainListFile;
        if (!(await async.exists(cmake_list))) {
            const do_quickstart = !!(
                await vscode.window.showErrorMessage(
                    'You do not have a CMakeLists.txt',
                    "Quickstart a new CMake project"
                )
            );
            if (do_quickstart)
                await this.quickStart();
            return -1;
        }

        if (run_prebuild)
            await this._prebuild();

        const cmake_cache = this.cachePath;
        this._channel.show();
        const settings_args: string[] = [];
        if (!this.cmakeCache.exists) {
            this._channel.appendLine("[vscode] Setting up new CMake configuration");
            const generator = await this.pickGenerator(this.config.preferredGenerators);
            if (generator) {
                this._channel.appendLine('[vscode] Configuring using the "' + generator + '" CMake generator');
                settings_args.push("-G" + generator);
            } else {
                console.error("None of the preferred generators was selected");
            }
            // this.selectedBuildType = this.config<string>("initialBuildType", "Debug");
        }

        const toolset = this.config.toolset;
        if (toolset) {
            settings_args.push('-T' + toolset);
        }

        if (!await this.isMultiConf) {
            settings_args.push('-DCMAKE_BUILD_TYPE=' + this.selectedBuildType);
        }

        const settings = Object.assign({}, this.config.configureSettings);

        const variant = this.activeVariant;
        if (variant) {
            Object.assign(settings, variant.settings || {});
            settings.BUILD_SHARED = variant.linkage === 'shared';
        }

        if (!(await async.exists(this.binaryDir))) {
            await fs.mkdir(this.binaryDir);
        }

        if (this.debugTargetsEnabled) {
            const helpers_dir = path.join(this.binaryDir, 'CMakeTools');
            if (!(await async.exists(helpers_dir))) {
                await fs.mkdir(helpers_dir);
            }
            const helpers = path.join(helpers_dir, 'CMakeToolsHelpers.cmake')
            await async.doAsync(fs.writeFile, helpers, CMAKETOOLS_HELPER_SCRIPT);
            const old_path = settings['CMAKE_PREFIX_PATH'] as Array<string> || [];
            settings['CMAKE_MODULE_PATH'] = Array.from(old_path).concat([
                helpers_dir.replace(/\\/g, path.posix.sep)
            ]);
        }

        for (const key in settings) {
            let value = settings[key];
            if (value === true || value === false)
                value = value ? "TRUE" : "FALSE";
            if (typeof(value) === 'string')
                value = (value as string)
                    .replace(';', '\\;')
                    .replace('${workspaceRoot}', vscode.workspace.rootPath)
                    .replace('${buildType}', this.selectedBuildType || 'Unknown');
            if (value instanceof Array)
                value = value.join(';');
            settings_args.push("-D" + key + "=" + value.toString());
        }
        let prefix = this.config.installPrefix;
        if (prefix && prefix !== "") {
            prefix = prefix
                .replace('${workspaceRoot}', vscode.workspace.rootPath)
                .replace('${buildType}', this.selectedBuildType || 'Unknown');
            settings_args.push("-DCMAKE_INSTALL_PREFIX=" + prefix);
        }

        const binary_dir = this.binaryDir;
        this.statusMessage = 'Configuring...';
        const result = await this.execute(
            ['-H' + this.sourceDir.replace(/\\/g, path.posix.sep),
             '-B' + binary_dir.replace(/\\/g, path.posix.sep)]
                .concat(settings_args)
                .concat(extra_args)
                .concat(this.config.configureArgs)
        );
        this.statusMessage = 'Ready';
        if (!result.retc) {
            this.reloadCMakeCache()
            this._refreshTargetList();
            this._reloadMetaData();
        }
        return result.retc;
    }

    public async build(target_: Maybe<string> = null): Promise<Number> {
        let target = target_;
        if (!target_) {
            target = this.defaultBuildTarget || this.allTargetName;
        }
        if (!this.sourceDir) {
            vscode.window.showErrorMessage('You do not have a source directory open');
            return -1;
        }

        if (this.isBusy) {
            vscode.window.showErrorMessage('A CMake task is already running. Stop it before trying to build.');
            return -1;
        }

        const cachepath = this.cachePath;
        if (!(await async.exists(cachepath))) {
            const retc = await this.configure();
            if (retc !== 0) {
                return retc;
            }
            await this.reloadCMakeCache();
            // We just configured which may change what the "all" target is.
            if (!target_) {
                target = this.defaultBuildTarget || this.allTargetName;
            }
        }
        if (!target) {
            throw new Error('Unable to determine target to build. Something has gone horribly wrong!');
        }
        await this._prebuild();
        if (this._needsReconfigure) {
            const retc = await this.configure([], false);
            if (!!retc)
                return retc;
        }
        // Pass arguments based on a particular generator
        const gen = this.activeGenerator;
        const generator_args = (() => {
            if (!gen)
                return [];
            else if (/(Unix|MinGW) Makefiles|Ninja/.test(gen) && target !== 'clean')
                return ['-j', this.numJobs.toString()];
            else if (/Visual Studio/.test(gen))
                return ['/m', '/property:GenerateFullPaths=true'];
            else
                return [];
        })();
        this._channel.show();
        this.statusMessage = 'Building...';
        const result = await this.execute([
            '--build', this.binaryDir,
            '--target', target,
            '--config', this.selectedBuildType || 'Debug',
        ]
            .concat(this.config.buildArgs)
            .concat([
                '--'
            ]
                .concat(generator_args)
                .concat(this.config.buildToolArgs)
            )
        );
        this.statusMessage = 'Ready';
        if (this.config.parseBuildDiagnostics) {
            this._buildDiags.clear();
            await this.parseDiagnostics(result);
        }
        if (!result.retc) {
            this.reloadCMakeCache();
            this._refreshTargetList();
            this._reloadMetaData();
        }
        return result.retc;
    }

    public install() {
        return this.build('install');
    }

    public clean() {
        return this.build('clean');
    }

    public async cleanConfigure(): Promise<Number> {
        const build_dir = this.binaryDir;
        const cache = this.cachePath;
        const cmake_files = path.join(build_dir, 'CMakeFiles');
        if (await async.exists(cache)) {
            this._channel.appendLine('[vscode] Removing ' + cache);
            await async.unlink(cache);
        }
        if (await async.exists(cmake_files)) {
            this._channel.appendLine('[vscode] Removing ' + cmake_files);
            await async.unlink(cmake_files);
        }
        return await this.configure();
    }

    public async jumpToCacheFile(): Promise<Maybe<vscode.TextEditor>> {
        if (!(await async.exists(this.cachePath))) {
            const do_conf = !!(await vscode.window.showErrorMessage('This project has not yet been configured.', 'Configure Now'));
            if (do_conf) {
                if (await this.configure() !== 0)
                    return null;
            }
        }

        const cache = await vscode.workspace.openTextDocument(this.cachePath);
        return await vscode.window.showTextDocument(cache);
    }

    public async cleanRebuild(): Promise<Number> {
        const clean_result = await this.clean();
        if (clean_result)
            return clean_result;
        return await this.build();
    }

    public showTargetSelector(): Thenable<string> {
        return this._targets
            ? vscode.window.showQuickPick(this._targets)
            : vscode.window.showInputBox({
                prompt: 'Enter a target name'
            });
    }

    public async buildWithTarget(): Promise<Number> {
        const target = await this.showTargetSelector();
        if (target === null || target === undefined)
            return -1;
        return await this.build(target);
    }

    public async setDefaultTarget() {
        const new_default = await this.showTargetSelector();
        if (!new_default)
            return;
        this.defaultBuildTarget = new_default;
    }

    public async setBuildType(): Promise<Number> {
        const variants =
            Array.from(this.buildVariants.entries()).map(
                ([key, variant]) =>
                    Array.from(variant.choices.entries()).map(
                        ([value_name, value]) => ({
                            settingKey: key,
                            settingValue: value_name,
                            settings: value
                        })
                    )
            );
        const product = util.product(variants);
        const items = product.map(
            optionset => ({
                label: optionset.map(
                    o => o.settings.oneWordSummary
                        ? o.settings.oneWordSummary
                        : `${o.settingKey}=${o.settingValue}`
                ).join('+'),
                keywordSettings: new Map<string, string>(
                    optionset.map(
                        param => [param.settingKey, param.settingValue] as [string, string]
                    )
                ),
                description: optionset.map(o => o.settings.description).join(' + '),
            })
        );
        const chosen: util.VariantCombination = await vscode.window.showQuickPick(items);
        if (!chosen)
            return -1; // User cancelled
        this.activeVariantCombination = chosen;
        const old_build_path = this.binaryDir;
        if (this.binaryDir !== old_build_path) {
            await this._setupCMakeCacheWatcher();
        }

        return await this.configure();
    }

    public async debugTarget() {
        if (!this.debugTargetsEnabled) {
            vscode.window.showErrorMessage('Debugging of targets is experimental and must be manually enabled in settings.json');
            return;
        }
        if (!this.executableTargets) {
            vscode.window.showWarningMessage('No targets are available for debugging. Be sure you have included the CMakeToolsProject in your CMake project.');
            return;
        }
        const target = this.executableTargets.find(e => e.name === this.currentDebugTarget);
        if (!target) {
            vscode.window.showErrorMessage(`The current debug target "${this.currentDebugTarget}" no longer exists. Select a new target to debug.`);
            return;
        }
        const build_retc = await this.build(target.name);
        if (build_retc !== 0)
            return;
        const config = {
            name: `Debugging Target ${target.name}`,
            targetArchitecture: /64/.test(this.systemProcessor || 'x64')
                ? 'x64'
                : 'x86',
            type: (this.compilerId && this.compilerId.includes('MSVC'))
                ? 'cppvsdbg'
                : 'cppdbg',
        }
        const configs = this.config.readConfig<any>("debugConfig");
        Object.assign(config, configs.all);
        config['program'] = target.path;
        vscode.commands.executeCommand('vscode.startDebug', config);
    }

    public async selectDebugTarget() {
        if (!this.debugTargetsEnabled) {
            vscode.window.showErrorMessage('Debugging of targets is experimental and must be manually enabled in settings.json');
            return;
        }
        if (!this.executableTargets) {
            vscode.window.showWarningMessage('No targets are available for debugging. Be sure you have included the CMakeToolsProject in your CMake project.');
            return;
        }
        const target = await vscode.window.showQuickPick(
            this.executableTargets.map(e => ({
                label: e.name,
                description: e.path,
            })));
        if (!target) {
            return;
        }
        this.currentDebugTarget = target.label;
    }

    public async ctest (): Promise<Number> {
        this._channel.show();
        return (await this.execute(['-E', 'chdir', this.binaryDir, 'ctest', '-j' + this.numCTestJobs, '--output-on-failure'])).retc;
    }

    public async quickStart (): Promise<Number> {
        if (await async.exists(this.mainListFile)) {
            vscode.window.showErrorMessage('This workspace already contains a CMakeLists.txt!');
            return -1;
        }

        const project_name = await vscode.window.showInputBox({
            prompt: 'Enter a name for the new project',
            validateInput: (value: string): string => {
                if (!value.length)
                    return 'A project name is required';
                return '';
            },
        });
        if (!project_name)
            return -1;

        const target_type = (await vscode.window.showQuickPick([
            {
                label: 'Library',
                description: 'Create a library',
            }, {
                label: 'Executable',
                description: 'Create an executable'
            }
        ]));

        if (!target_type)
            return -1;

        const type = target_type.label;

        const init = [
            'cmake_minimum_required(VERSION 3.0.0)',
            `project(${project_name} VERSION 0.0.0)`,
            '',
            'include(CTest)',
            'enable_testing()',
            '',
            {
                Library: `add_library(${project_name} ${project_name}.cpp)`,
                Executable: `add_executable(${project_name} main.cpp)`,
            }[type],
            '',
            'set(CPACK_PROJECT_NAME ${PROJECT_NAME})',
            'set(CPACK_PROJECT_VERSION ${PROJECT_VERSION})',
            'include(CPack)',
            '',
        ].join('\n');

        if (type === 'Library') {
            if (!(await async.exists(path.join(this.sourceDir, project_name + '.cpp')))) {
                await async.doAsync(
                    fs.writeFile,
                    path.join(this.sourceDir, project_name + '.cpp'),
                    [
                        '#include <iostream>',
                        '',
                        `void say_hello(){ std::cout << "Hello, from ${project_name}!\\n"; }`,
                        '',
                    ].join('\n')
                );
            }
        } else {
            if (!(await async.exists(path.join(this.sourceDir, 'main.cpp')))) {
                await async.doAsync(
                    fs.writeFile,
                    path.join(this.sourceDir, 'main.cpp'),
                    [
                        '#include <iostream>',
                        '',
                        'int main(int, char**)',
                        '{',
                        '   std::cout << "Hello, world!\\n";',
                        '}',
                        '',
                    ].join('\n')
                );
            }
        }
        await async.doAsync(fs.writeFile, this.mainListFile, init);
        const doc = await vscode.workspace.openTextDocument(this.mainListFile);
        await vscode.window.showTextDocument(doc);
        return this.configure();
    }

    public stop() {
        const child = this.currentChildProcess;
        if (!child)
            return;
        // Stopping the process isn't as easy as it may seem. cmake --build will
        // spawn child processes, and CMake won't forward signals to its
        // children. As a workaround, we list the children of the cmake process
        // and also send signals to them.
        this._killTree(child.pid);
    }

    public async _killTree(pid: number) {
        let children: number[] = [];
        if (process.platform !== 'win32') {
            const stdout = (await async.execute('pgrep', ['-P', pid.toString()])).stdout.trim();
            if (!!stdout.length) {
                children = stdout.split('\n').map(line => Number.parseInt(line));
            }
        }
        for (const other of children) {
            if (other)
                await this._killTree(other);
        }
        process.kill(pid, 'SIGINT');
    }
}
