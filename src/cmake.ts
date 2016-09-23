'use strict';

import * as path from 'path';
import * as fs from 'fs';
import * as proc from 'child_process';
import * as os from 'os';

import * as vscode from 'vscode';

import * as async from './async';

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
        if(NOT type STREQUAL "INTERFACE_LIBRARY")
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

export function isTruthy(value) {
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

    constructor(key?: string, value?: string, type?: EntryType, docs?: string) {
        this._key = key;
        this._value = value;
        this._type = type;
        this._docs = docs;
    }
    // public advanced: boolean = false;
};

export class CMakeCache {
    private _entries: Map<string, CacheEntry>;

    private _lastModifiedTime: Date = null;

    public static fromPath = async function(path: string): Promise<CMakeCache> {
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
            if (line.startsWith('//')) {
                docs_acc += /^\/\/(.*)/.exec(line)[1] + ' ';
            } else {
                const match = /^(.*?):(.*?)=(.*)/.exec(line);
                console.assert(!!match, "Couldn't handle reading cache entry: " + line);
                const [_, name, typename, valuestr] = match;
                if (name.endsWith('-ADVANCED') && valuestr == '1') {
                    // We skip the ADVANCED property variables. They're a little odd.
                } else {
                    const key = name;
                    const type = {
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

    public get(key: string, defaultValue?: any): CacheEntry {
        if (!this._entries.has(key))
            return null;
        return this._entries.get(key);
    }
}

// cache for cmake-tools extension
// JSON file with path ${workspaceRoot}/.vscode/.cmaketools.json
interface ToolsCacheData {
    selectedBuildType: string;
}

export class ToolsCacheFile {
    public static readCache = async function(path: string, defaultVal: ToolsCacheData): Promise<ToolsCacheData> {
        console.info('Reloading cmake-tools extension cache data from', path);
        try {
            const buf = await async.readFile(path);
            if (!buf) return defaultVal;
            return JSON.parse(buf.toString());
        }
        catch(err) {
            return defaultVal;
        }
    }

    public static writeCache(path: string, cache: ToolsCacheData) {
        return async.doAsync(fs.writeFile, path, JSON.stringify(cache));
    }
}

export class CMakeTools {
    private _channel: vscode.OutputChannel;
    private _diagnostics: vscode.DiagnosticCollection;
    private _cmakeToolsStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.010);
    private _buildButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.005);
    private _targetButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.003);
    private _debugButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.002);
    private _debugTargetButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3);
    private _lastConfigureSettings = {};
    private _needsReconfigure = false;
    private _buildDiags: vscode.DiagnosticCollection;
    private _extCacheContent: ToolsCacheData;
    private _extCachePath = path.join(vscode.workspace.rootPath, '.vscode', '.cmaketools.json');
    private _targets: string[];
    public os: string;
    public systemProcessor: string;
    public compilerId: string;

    private _cmakeCache: CMakeCache;
    public get cmakeCache() {
        return this._cmakeCache;
    }
    public set cmakeCache(cache: CMakeCache) {
        this._cmakeCache = cache;
        this._refreshStatusBarItems();
        if (!this.isMultiConf) {
            const bt = cache.get('CMAKE_BUILD_TYPE');
            if (bt) {
                this.selectedBuildType = bt.as<string>();
            }
        }
    }

    private _currentChildProcess: proc.ChildProcess;
    public get currentChildProcess(): proc.ChildProcess {
        return this._currentChildProcess;
    }
    public set currentChildProcess(v: proc.ChildProcess) {
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
    public get selectedBuildType(): string {
        return this._extCacheContent.selectedBuildType;
    }
    public set selectedBuildType(v: string) {
        const changed = this.selectedBuildType !== v;
        this._extCacheContent.selectedBuildType = v;
        if (changed) {
            this._writeCacheContent()
                .then(this._refreshStatusBarItems.bind(this))
                .then(() => {
                    if (this.cachePath !== this.cmakeCache.path) {
                        this._refreshTargetList.bind(this)
                    }
                });
        }
    }

    public get debugTargetsEnabled(): boolean {
        return this.config<boolean>('experimental.enableDebugTargets');
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

    private reloadCMakeCache() {
        return (
        (this.cmakeCache && this.cmakeCache.path === this.cachePath)
            ? this.cmakeCache.getReloaded()
            : CMakeCache.fromPath(this.cachePath)
        ).then(cache => {
            this.cmakeCache = cache;
        });
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
        if (this.currentDebugTarget === null && value.length) {
            this.currentDebugTarget = value[0].name;
        }
    }

    private _currentDebugTarget: string;
    public get currentDebugTarget(): string {
        return this._currentDebugTarget;
    }
    public set currentDebugTarget(v: string) {
        this._currentDebugTarget = v;
        this._refreshStatusBarItems();
    }

    private _reloadMetaData() {
        return async.exists(this.metaPath).then(exists => {
            if (exists) {
                return async.readFile(this.metaPath).then(buffer => {
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
                    var _;
                    [_, this.os, this.systemProcessor, this.compilerId] = tuples.find(tup => tup[0] === 'system');
                });
            } else {
                this.executableTargets = null;
                this.os = null;
                this.systemProcessor = null;
                this.compilerId = null;
            }
        });
    }

    private _reloadConfiguration() {
        const new_settings = this.config<Object>('configureSettings');
        this._needsReconfigure = JSON.stringify(new_settings) !== JSON.stringify(this._lastConfigureSettings);
        this._lastConfigureSettings = new_settings;
        // A config change could require reloading the CMake Cache (ie. changing the build path)
        this._setupCMakeCacheWatcher();
        // Use may have disabled build diagnostics.
        if (!this.config<boolean>('parseBuildDiagnostics')) {
            this._buildDiags.clear();
        }
        if (this.debugTargetsEnabled && !this._metaWatcher) {
            this._setupMetaWatcher();
        }
        this._refreshStatusBarItems();
    }

    private _writeCacheContent() {
        return ToolsCacheFile.writeCache(this._extCachePath, this._extCacheContent);
    }

    private _refreshToolsCacheContent = async function() {
        const self: CMakeTools = this;
        self._extCacheContent = await ToolsCacheFile.readCache(self._extCachePath, {
            selectedBuildType: self.config<string>('initialBuildType')
        });
        self._writeCacheContent();
        self._setupCMakeCacheWatcher();
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
                this.selectedBuildType = this.config<string>('initialBuildType');
            });
        });
        this.reloadCMakeCache();
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

    constructor() {
        this._channel = vscode.window.createOutputChannel('CMake/Build');
        this._diagnostics = vscode.languages.createDiagnosticCollection('cmake-diags');
        this._buildDiags = vscode.languages.createDiagnosticCollection('cmake-build-diags');
        this._extCacheContent = {selectedBuildType: null};

        // Load up the CMake cache
        CMakeCache.fromPath(this.cachePath).then(cache => {
            this._setupCMakeCacheWatcher();
            this._cmakeCache = cache; // Here we explicitly work around our setter
            this.currentChildProcess = null; // Inits the content of the buildButton
            if (this.debugTargetsEnabled) {
                this._setupMetaWatcher();
            }
            this._reloadConfiguration();
            const prom: Promise<any> = (cache.exists && !this.isMultiConf
                ? Promise.resolve(this.selectedBuildType = cache.get('CMAKE_BUILD_TYPE').as<string>())
                : this._refreshToolsCacheContent().then(cache => {
                    this.selectedBuildType = this._extCacheContent.selectedBuildType || this.config<string>('initialBuildType');
                }));
            prom.then(() => {
                this.statusMessage = 'Ready';
            });
        })

        this._lastConfigureSettings = this.config<Object>('configureSettings');
        this._needsReconfigure = true;
        vscode.workspace.onDidChangeConfiguration(() => {
            console.log('Reloading CMakeTools after configuration change');
            this._reloadConfiguration();
        });
    }

    /**
     * @brief Refreshes the content of the status bar items.
     *
     * This only changes the visible content, and doesn't manipulate the state
     * of the extension.
     */
    private _refreshStatusBarItems() {
        this._cmakeToolsStatusItem.command = 'cmake.setBuildType';
        this._cmakeToolsStatusItem.text = `CMake: ${this.projectName}: ${this.selectedBuildType || 'Unknown'}: ${this.statusMessage}`;

        if (this.cmakeCache.exists &&
                this.isMultiConf &&
                this.config<string>('buildDirectory').includes('${buildType}')
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
    private _refreshTargetList = async function(): Promise<string[]> {
        const self: CMakeTools = this;
        self._targets = [];
        const cachepath = self.cachePath;
        if (!self.cmakeCache.exists) {
            return self._targets;
        }
        self.statusMessage = 'Refreshing targets...';
        const generator = self.activeGenerator;
        if (/(Unix|MinGW|NMake) Makefiles|Ninja/.test(generator)) {
            const result = await self.execute(['--build', self.binaryDir, '--target', 'help'], {
                silent: true
            });
            const lines = result.stdout.split('\n');
            const important_lines = generator.endsWith('Makefiles')
                ? lines.filter(l => l.startsWith('... '))
                : lines.filter(l => l.indexOf(': ') !== -1);
            self._targets = important_lines
                .map(l => l.substr(4))
                .map(l => / /.test(l) ? l.substr(0, l.indexOf(' ')) : l);
        }
        self.statusMessage = 'Ready';
        return self._targets;
    }

    /**
     * @brief Parses a diagnostic message from GCC
     *
     * @returns A FileDiagnostic obtained from the message, or null if no
     *      message could be decoded.
     */
    public parseGCCDiagnostic(line: string): FileDiagnostic {
        const gcc_re = /^(.*):(\d+):(\d+):\s+(warning|error|note):\s+(.*)$/;
        const res = gcc_re.exec(line);
        if (!res)
            return null;
        const file = res[1];
        const lineno = Number.parseInt(res[2]) - 1;
        const column = Number.parseInt(res[3]) - 1;
        const severity = res[4];
        const message = res[5];
        const abspath = path.isAbsolute(file)
            ? file
            : path.normalize(path.join(this.binaryDir, file));
        const diag = new vscode.Diagnostic(
            new vscode.Range(lineno, column, lineno, column),
            message,
            {
                error: vscode.DiagnosticSeverity.Error,
                warning: vscode.DiagnosticSeverity.Warning,
                note: vscode.DiagnosticSeverity.Information,
            }[severity]
        );
        diag.source = 'GCC';
        return {
            filepath: abspath,
            diag: diag,
        };
    }

    /**
     * @brief Obtains a reference to a TextDocument given the name of the file
     */
    private getTextDocumentByFileName(file: string): vscode.TextDocument {
        const documents = vscode.workspace.textDocuments;
        let document: vscode.TextDocument = null;
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
    public parseMSVCDiagnostic(line: string): FileDiagnostic {
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
    public parseDiagnosticLine(line: string): FileDiagnostic {
        return this.parseGCCDiagnostic(line) ||
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
            if (!(diag.filepath in diags_acc))
                diags_acc[diag.filepath] = [];
            diags_acc[diag.filepath].push(diag.diag);
        }

        for (const filepath in diags_acc) {
            this._buildDiags.set(vscode.Uri.file(filepath), diags_acc[filepath]);
        }
    }

    /**
     * @brief Obtain a configuration entry from the cmake section.
     *
     * @tparam T The type that will be taken from the config
     * @param defaultValue The default value to return if the config entry does not exist
     */
    public config<T>(key: string, defaultValue?: any): T {
        return vscode.workspace.getConfiguration('cmake').get<T>(key, defaultValue);
    }

    /**
     * @brief Read the source directory from the config
     */
    public get sourceDir(): string {
        return this.config<string>('sourceDirectory').replace('${workspaceRoot}', vscode.workspace.rootPath);
    }

    /**
     * @brief Get the path to the root CMakeLists.txt
     */
    public get mainListFile(): string {
        return path.join(this.sourceDir, 'CMakeLists.txt');
    }

    /**
     * @brief Get the path to the binary dir
     */
    public get binaryDir(): string {
        return this.config<string>('buildDirectory')
            .replace('${workspaceRoot}', vscode.workspace.rootPath)
            .replace('${buildType}', this.selectedBuildType);
    }

    /**
     * @brief Get the path to the CMakeCache file in the build directory
     */
    public get cachePath(): string {
        return path.join(this.binaryDir, 'CMakeCache.txt');
    }

    /**
     * @brief Get the path to the metadata file
     */
    public get metaPath(): string {
        return path.join(this.binaryDir, 'CMakeToolsMeta.txt');
    }

    /**
     * @brief Determine if the project is using a multi-config generator
     */
    public get isMultiConf() {
        return !!this.cmakeCache.get('CMAKE_CONFIGURATION_TYPES');
    }

    public get activeGenerator() {
        const gen = this.cmakeCache.get('CMAKE_GENERATOR');
        return gen
            ? gen.as<string>()
            : null;
    }

    /**
     * @brief Get the name of the "all" target
     */
    public get allTargetName() {
        if (!this.cmakeCache.exists)
            return 'all';
        return /Visual Studio/.test(this.activeGenerator) ? 'ALL_BUILD' : 'all';
    }

    /**
     * @brief Execute a CMake command. Resolves to the result of the execution.
     */
    public execute(args: string[], options?: ExecuteOptions): Promise<ExecutionResult> {
        return new Promise<ExecutionResult>((resolve, _) => {
            const silent: boolean = options && options.silent;
            console.info('Execute cmake with arguments:', args);
            const pipe = proc.spawn(this.config<string>('cmakePath', 'cmake'), args);
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
                        vscode.window.showWarningMessage('CMake exited with non-zero return code ' + retc + '. See CMake/Build output for details');
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
                    rest = tail;
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
    public testHaveCommand = async function (command, args: string[] = ['--version']): Promise<Boolean> {
        return await new Promise<Boolean>((resolve, _) => {
            const pipe = proc.spawn(command, args);
            pipe.on('error', () => resolve(false));
            pipe.on('exit', () => resolve(true));
        });
    }

    // Given a list of CMake generators, returns the first one available on this system
    public pickGenerator = async function (candidates: string[]): Promise<string> {
        const self: CMakeTools = this;
        for (const gen of candidates) {
            const delegate = {
                Ninja: async function () {
                    return await self.testHaveCommand('ninja-build') || await self.testHaveCommand('ninja');
                },
                "MinGW Makefiles": async function () {
                    return process.platform === 'win32' && await self.testHaveCommand('make');
                },
                "NMake Makefiles": async function () {
                    return process.platform === 'win32' && await self.testHaveCommand('nmake', ['/?']);
                },
                'Unix Makefiles': async function () {
                    return process.platform !== 'win32' && await self.testHaveCommand('make');
                }
            }[gen];
            if (delegate === undefined) {
                const vsMatcher = /^Visual Studio (\d{2}) (\d{4})($|\sWin64$|\sARM$)/;
                if (vsMatcher.test(gen) && process.platform === 'win32')
                    return gen;
                vscode.window.showErrorMessage('Unknown CMake generator "' + gen + '"');
                continue;
            }
            if (await delegate())
                return gen;
            else
                console.log('Generator "' + gen + '" is not supported');
        }
        return null;
    }

    private _prebuild = async function () {
        const self: CMakeTools = this;
        if (self.config<boolean>("clearOutputBeforeBuild")) {
            self._channel.clear();
        }

        if (self.config<boolean>("saveBeforeBuild") && vscode.workspace.textDocuments.some(doc => doc.isDirty)) {
            self._channel.appendLine("[vscode] Saving unsaved text documents...");
            await vscode.workspace.saveAll();
        }
    }

    public get numJobs(): number {
        const jobs = this.config<number>("parallelJobs");
        if (!!jobs) {
            return jobs;
        }
        return os.cpus().length + 2;
    }

    public get numCTestJobs(): number {
        const ctest_jobs = this.config<number>("ctest.parallelJobs");
        if (ctest_jobs === 0) {
            return this.numJobs;
        }
        return ctest_jobs;
    }

    public configure = async function (extra_args: string[] = [], run_prebuild = true): Promise<Number> {
        const self: CMakeTools = this;

        if (self.isBusy) {
            vscode.window.showErrorMessage('A CMake task is already running. Stop it before trying to configure.');
            return;
        }

        if (!self.sourceDir) {
            vscode.window.showErrorMessage('You do not have a source directory open');
            return;
        }

        const cmake_list = self.mainListFile;
        if (!(await async.exists(cmake_list))) {
            const do_quickstart = !!(
                await vscode.window.showErrorMessage(
                    'You do not have a CMakeLists.txt',
                    "Quickstart a new CMake project"
                )
            );
            if (do_quickstart)
                await self.quickStart();
            return;
        }

        if (run_prebuild)
            await self._prebuild();

        const cmake_cache = self.cachePath;
        self._channel.show();
        const settings_args = [];
        if (!self.cmakeCache.exists) {
            self._channel.appendLine("[vscode] Setting up new CMake configuration");
            const generator = await self.pickGenerator(self.config<string[]>("preferredGenerators"));
            if (generator) {
                self._channel.appendLine('[vscode] Configuring using the "' + generator + '" CMake generator');
                settings_args.push("-G" + generator);
            } else {
                console.error("None of the preferred generators was selected");
            }
            self.selectedBuildType = self.config<string>("initialBuildType", "Debug");
        }

        settings_args.push('-DCMAKE_BUILD_TYPE=' + self.selectedBuildType);

        const settings = Object.assign({}, self.config<Object>("configureSettings"));

        if (!(await async.exists(self.binaryDir))) {
            await fs.mkdir(self.binaryDir);
        }

        if (self.debugTargetsEnabled) {
            const helpers_dir = path.join(self.binaryDir, 'CMakeTools');
            if (!(await async.exists(helpers_dir))) {
                await fs.mkdir(helpers_dir);
            }
            const helpers = path.join(helpers_dir, 'CMakeToolsHelpers.cmake')
            await async.doAsync(fs.writeFile, helpers, CMAKETOOLS_HELPER_SCRIPT);
            const old_path = settings['CMAKE_PREFIX_PATH'] as Array<string> || [];
            settings['CMAKE_MODULE_PATH'] = Array.from(old_path).concat([helpers_dir]);
        }

        for (const key in settings) {
            let value = settings[key];
            if (value === true || value === false)
                value = value ? "TRUE" : "FALSE";
            if (typeof(value) === 'string')
                value = (value as string).replace(';', '\\;');
            if (value instanceof Array)
                value = value.join(';');
            value = value
                .replace('${workspaceRoot}', vscode.workspace.rootPath)
                .replace('${buildType}', this.selectedBuildType);
            settings_args.push("-D" + key + "=" + value);
        }
        let prefix = self.config<string>("installPrefix");
        if (prefix && prefix !== "") {
            prefix = prefix
                .replace('${workspaceRoot}', vscode.workspace.rootPath)
                .replace('${buildType}', this.selectedBuildType);
            settings_args.push("-DCMAKE_INSTALL_PREFIX=" + prefix);
        }

        const binary_dir = self.binaryDir;
        self.statusMessage = 'Configuring...';
        const result = await self.execute(
            ['-H' + self.sourceDir, '-B' + binary_dir]
                .concat(settings_args)
                .concat(extra_args)
        );
        self.statusMessage = 'Ready';
        return result.retc;
    }

    public build = async function (target: string = null): Promise<Number> {
        const self: CMakeTools = this;
        if (target === null) {
            target = self.defaultBuildTarget || self.allTargetName;
        }
        if (!self.sourceDir) {
            vscode.window.showErrorMessage('You do not have a source directory open');
            return;
        }

        if (self.isBusy) {
            vscode.window.showErrorMessage('A CMake task is already running. Stop it before trying to build.');
            return;
        }

        const cachepath = self.cachePath;
        if (!(await async.exists(cachepath))) {
            const retc = await self.configure();
            if (retc !== 0) {
                return retc;
            }
        }
        await self._prebuild();
        if (self._needsReconfigure) {
            const retc = await self.configure([], false);
            if (!!retc)
                return retc;
        }
        // Pass arguments based on a particular generator
        const gen = self.activeGenerator;
        const generator_args = (() => {
            if (/(Unix|MinGW) Makefiles|Ninja/.test(gen) && target !== 'clean')
                return ['-j', self.numJobs.toString()];
            else if (/Visual Studio/.test(gen))
                return ['/m', '/property:GenerateFullPaths=true'];
            else
                return [];
        })();
        self._channel.show();
        self.statusMessage = 'Building...';
        const result = await self.execute([
            '--build', self.binaryDir,
            '--target', target,
            '--config', self.selectedBuildType,
            '--'].concat(generator_args));
        self.statusMessage = 'Ready';
        if (self.config<boolean>('parseBuildDiagnostics')) {
            self._buildDiags.clear();
            await self.parseDiagnostics(result);
        }
        return result.retc;
    }

    public install() {
        return this.build('install');
    }

    public clean() {
        return this.build('clean');
    }

    public cleanConfigure = async function (): Promise<Number> {
        const self: CMakeTools = this;
        const build_dir = self.binaryDir;
        const cache = self.cachePath;
        const cmake_files = path.join(build_dir, 'CMakeFiles');
        if (await async.exists(cache)) {
            self._channel.appendLine('[vscode] Removing ' + cache);
            await async.unlink(cache);
        }
        if (await async.exists(cmake_files)) {
            self._channel.appendLine('[vscode] Removing ' + cmake_files);
            await async.unlink(cmake_files);
        }
        return await self.configure();
    }

    public jumpToCacheFile = async function (): Promise<vscode.TextEditor> {
        const self: CMakeTools = this;
        if (!(await async.exists(self.cachePath))) {
            const do_conf = !!(await vscode.window.showErrorMessage('This project has not yet been configured.', 'Configure Now'));
            if (do_conf) {
                if (await self.configure() !== 0)
                    return;
            }
        }

        const cache = await vscode.workspace.openTextDocument(self.cachePath);
        return await vscode.window.showTextDocument(cache);
    }

    public cleanRebuild = async function (): Promise<Number> {
        const self: CMakeTools = this;
        const clean_result = await self.clean();
        if (clean_result)
            return clean_result;
        return await self.build();
    }

    public showTargetSelector(): Thenable<string> {
        return this._targets
            ? vscode.window.showQuickPick(this._targets)
            : vscode.window.showInputBox({
                prompt: 'Enter a target name'
            });
    }

    public buildWithTarget = async function (): Promise<Number> {
        const self: CMakeTools = this;
        const target = await self.showTargetSelector();
        if (target === null || target === undefined)
            return -1;
        return await self.build(target);
    }

    public setDefaultTarget = async function () {
        const self: CMakeTools = this;
        const new_default = await self.showTargetSelector();
        if (!new_default)
            return;
        self.defaultBuildTarget = new_default;
    }

    public setBuildType = async function (): Promise<Number> {
        const self: CMakeTools = this;
        let chosen = null;
        if (self.cmakeCache.exists && self.isMultiConf) {
            const types = self.cmakeCache.get('CMAKE_CONFIGURATION_TYPES').as<string>().split(';');
            chosen = await vscode.window.showQuickPick(types);
        } else {
            chosen = await vscode.window.showQuickPick([
                {
                    label: 'Release',
                    description: 'Optimized build with no debugging information',
                }, {
                    label: 'Debug',
                    description: 'Default build type. No optimizations. Contains debug information',
                }, {
                    label: 'MinSizeRel',
                    description: 'Release build tweaked for minimum binary code size',
                }, {
                    label: 'RelWithDebInfo',
                    description: 'Same as "Release", but also generates debugging information',
                }
            ]);
            chosen = chosen ? chosen.label : null;
        }
        if (chosen === null)
            return -1;

        self.selectedBuildType = chosen;
        return await self.configure();
    }

    public debugTarget = async function() {
        const self: CMakeTools = this;
        if (!self.debugTargetsEnabled) {
            vscode.window.showErrorMessage('Debugging of targets is experimental and must be manually enabled in settings.json');
            return;
        }
        if (!self.executableTargets) {
            vscode.window.showWarningMessage('No targets are available for debugging. Be sure you have included the CMakeToolsProject in your CMake project.');
            return;
        }
        const target = self.executableTargets.find(e => e.name === self.currentDebugTarget);
        if (!target) {
            vscode.window.showErrorMessage(`The current debug target "${self.currentDebugTarget}" no longer exists. Select a new target to debug.`);
            return;
        }
        const build_retc = await self.build(target.name);
        if (build_retc !== 0)
            return;
        const config = {
            name: `Debugging Target ${target.name}`,
            targetArchitecture: /64/.test(self.systemProcessor)
                ? 'x64'
                : 'x86',
            type: self.compilerId.includes('MSVC')
                ? 'cppvsdbg'
                : 'cppdbg',
        }
        const configs = self.config<any>("debugConfig");
        Object.assign(config, configs.all);
        config['program'] = target.path;
        vscode.commands.executeCommand('vscode.startDebug', config);
    }

    public selectDebugTarget = async function() {
        const self: CMakeTools = this;
        if (!self.debugTargetsEnabled) {
            vscode.window.showErrorMessage('Debugging of targets is experimental and must be manually enabled in settings.json');
            return;
        }
        if (!self.executableTargets) {
            vscode.window.showWarningMessage('No targets are available for debugging. Be sure you have included the CMakeToolsProject in your CMake project.');
            return;
        }
        const target = await vscode.window.showQuickPick(
            self.executableTargets.map(e => ({
                label: e.name,
                description: e.path,
            })));
        if (!target) {
            return;
        }
        self.currentDebugTarget = target.label;
    }

    public ctest = async function (): Promise<Number> {
        const self: CMakeTools = this;
        self._channel.show();
        return (await self.execute(['-E', 'chdir', self.binaryDir, 'ctest', '-j' + self.numCTestJobs, '--output-on-failure'])).retc;
    }

    public quickStart = async function (): Promise<Number> {
        const self: CMakeTools = this;
        if (await async.exists(self.mainListFile)) {
            vscode.window.showErrorMessage('This workspace already contains a CMakeLists.txt!');
            return -1;
        }

        const project_name = await vscode.window.showInputBox({
            prompt: 'Enter a name for the new project',
            validateInput: (value: string): string => {
                if (!value.length)
                    return 'A project name is required';
                return null;
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
            if (!(await async.exists(path.join(self.sourceDir, project_name + '.cpp')))) {
                await async.doAsync(
                    fs.writeFile,
                    path.join(self.sourceDir, project_name + '.cpp'),
                    [
                        '#include <iostream>',
                        '',
                        `void say_hello(){ std::cout << "Hello, from ${project_name}!\\n"; }`,
                        '',
                    ].join('\n')
                );
            }
        } else {
            if (!(await async.exists(path.join(self.sourceDir, 'main.cpp')))) {
                await async.doAsync(
                    fs.writeFile,
                    path.join(self.sourceDir, 'main.cpp'),
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
        await async.doAsync(fs.writeFile, self.mainListFile, init);
        const doc = await vscode.workspace.openTextDocument(self.mainListFile);
        await vscode.window.showTextDocument(doc);
        await self.configure();
    }

    public stop() {
        const child: proc.ChildProcess = this.currentChildProcess;
        if (!child)
            return;
        // Stopping the process isn't as easy as it may seem. cmake --build will
        // spawn child processes, and CMake won't forward signals to its
        // children. As a workaround, we list the children of the cmake process
        // and also send signals to them.
        this._killTree(child.pid);
    }

    public _killTree = async function (pid: number) {
        let children: number[] = [];
        if (process.platform !== 'win32') {
            const stdout = (await async.execute('pgrep', ['-P', pid.toString()])).stdout.trim();
            if (!!stdout.length) {
                children = stdout.split('\n').map(line => Number.parseInt(line));
            }
        }
        for (const other of children) {
            await this._killTree(other);
        }
        process.kill(pid, 'SIGINT');
    }
}
