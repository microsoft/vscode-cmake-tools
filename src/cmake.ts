'use strict';

import * as path from 'path';
import * as fs from 'fs';
import * as proc from 'child_process';
import * as os from 'os';

import * as vscode from 'vscode';

import * as async from './async';

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

export class CacheReader {
    public path: string;
    public data = new Map<string, CacheEntry>();

    private _lastModifiedTime: Date = null;

    constructor(path: string) {
        this.path = path;
    }

    public exists = async function (): Promise<boolean> {
        return await async.exists(this.path);
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

    private _reloadData = async function (): Promise<Map<string, CacheEntry>> {
        const self: CacheReader = this;
        console.info('Reloading CMake cache data from', self.path);
        const buf = await async.readFile(self.path);
        self.data = CacheReader.parseCache(buf.toString());
        self._lastModifiedTime = (await async.stat(self.path)).mtime;
        return self.data;
    }

    public needsReloading = async function (): Promise<boolean> {
        const self: CacheReader = this;
        const curstat = await async.stat(self.path);
        return !self._lastModifiedTime || (await async.stat(self.path)).mtime.getTime() > self._lastModifiedTime.getTime();
    }

    public getData = async function (): Promise<Map<string, CacheEntry>> {
        const self: CacheReader = this;
        if (await self.needsReloading()) {
            await self._reloadData();
        }
        return self.data;
    }

    public get = async function (key: string, defaultValue?: any): Promise<CacheEntry> {
        const self: CacheReader = this;
        const data = await self.getData();
        if (!data.has(key))
            return null;
        const ret = data.get(key);
        return ret;
    }
}

// cache for cmake-tools extension
// JSON file with path ${workspaceRoot}/.vscode/.cmaketools.json
interface ExtCache {
    selectedBuildType: string;
}

export class ExtCacheFile {
    public static readCache = async function(path: string, defaultVal: ExtCache): Promise<ExtCache> {
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

    public static writeCache(path: string, cache: ExtCache) {
        return async.doAsync(fs.writeFile, path, JSON.stringify(cache));
    }
}

export class CMakeTools {
    private _channel: vscode.OutputChannel;
    private _diagnostics: vscode.DiagnosticCollection;
    private _cmakeToolsStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.0010);
    private _buildButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.0005);
    private _targetButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3);
    private _lastConfigureSettings = {};
    private _needsReconfigure = false;
    private _buildDiags: vscode.DiagnosticCollection;
    private _extCacheContent: ExtCache;
    private _extCachePath = path.join(vscode.workspace.rootPath, '.vscode', '.cmaketools.json');
    private _targets: string[];

    public cache: CacheReader;

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
     * @brief The name of the active project.
     *
     * When a user is working with CMake, there is usually a name for the
     * project, generated by the project() CMake function. We read that from
     * the CMake cache and store it locally so we may display it on the status
     * bar.
     */
    private _projectName: string;
    public get projectName(): string {
        return this._projectName;
    }
    public set projectName(v: string) {
        this._projectName = v;
        this._refreshStatusBarItems();
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
        this._extCacheContent.selectedBuildType = v;
        this._writeCacheContent();
        this._refreshSettings();
        this._refreshStatusBarItems();
        this._refreshTargetList();
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

    private _refreshSettings() {
        this.cache = new CacheReader(this.cachePath);
        const new_settings = this.config<Object>('configureSettings');
        this._needsReconfigure = JSON.stringify(new_settings) !== JSON.stringify(this._lastConfigureSettings);
        this._lastConfigureSettings = new_settings;
    }

    private _writeCacheContent() {
        ExtCacheFile.writeCache(this._extCachePath, this._extCacheContent);
    }

    private _refreshCacheContent = async function() {
        const self: CMakeTools = this;
        self._extCacheContent = await ExtCacheFile.readCache(self._extCachePath, {
            selectedBuildType: 'None'
        });
        self._refreshSettings();
        self._refreshProjectName();
        self._refreshTargetList();
    }

    constructor() {
        this._channel = vscode.window.createOutputChannel('CMake/Build');
        this._diagnostics = vscode.languages.createDiagnosticCollection('cmake-diags');
        this._buildDiags = vscode.languages.createDiagnosticCollection('cmake-build-diags');
        this._extCacheContent = {selectedBuildType: null};
        this._refreshCacheContent();
        this.cache = new CacheReader(this.cachePath);

        vscode.workspace.onDidChangeConfiguration(() => {
            console.log('Reloading CMakeTools after configuration change');
            this._refreshSettings();
        });

        this._lastConfigureSettings = this.config<Object>('configureSettings');
        this._needsReconfigure = true;

        this._cmakeToolsStatusItem.command = 'cmake.setBuildType';
        this.currentChildProcess = null; // Inits the content of the buildButton


        // Start by loading the current CMake build type from the cache
        this._initSelectedBuildType();
        // Load the current project name from the cache
        this._refreshProjectName();
        // Load the current targets
        this._refreshTargetList();

        this.statusMessage = 'Ready';
    }

    private _refreshStatusBarItems = async function () {
        const self: CMakeTools = this;
        self._cmakeToolsStatusItem.text = `CMake: ${self.projectName}: ${self.selectedBuildType || 'Unknown'}: ${self.statusMessage}`;

        if (await self.cache.exists() && await self.isMultiConf()) {
            let bd = self.config<string>('buildDirectory');
            if (bd.includes('${buildType}')) {
                vscode.window.showWarningMessage('It is not advised to use ${buildType} in the cmake.buildDirectory settings when the generator supports multiple build configurations.');
            }
        }

        if (await async.exists(path.join(self.sourceDir, 'CMakeLists.txt'))) {
            self._cmakeToolsStatusItem.show();
            self._buildButton.show();
            self._targetButton.show();
        } else {
            self._cmakeToolsStatusItem.hide();
            self._buildButton.hide();
            self._targetButton.hide();
        }

        const target = self.defaultBuildTarget || await self.allTargetName();
        self._buildButton.text = self.isBusy ? '$(x) Stop' : `$(gear) Build:`;
        self._buildButton.command = self.isBusy ? 'cmake.stop' : 'cmake.build';
        self._targetButton.text = target;
        self._targetButton.command = 'cmake.setDefaultTarget';
        self._targetButton.tooltip = 'Click to change the default target'
    }

    /**
     * @brief Initializes the 'selectedBuildType' attribute.
     *
     * @returns A promise resolving to the selectedBuildType
     */
    public _initSelectedBuildType = async function (): Promise<string> {
        const self: CMakeTools = this;
        if (await self.cache.exists() && self.selectedBuildType === 'None') {
            if (await self.isMultiConf())
                self.selectedBuildType = 'Debug';
            else {
                self.selectedBuildType = (await self.cache.get('CMAKE_BUILD_TYPE')).as<string>();
            }
        }
        return self.selectedBuildType;
    }

    /**
     * @brief Reload the project name from the CMake cache
     *
     * Because the user can change the project name when we rerun cmake, we
     * need to be smart and reload the project name after we execute any
     * cmake commands which might rerun the configure. The setter for
     * projectName updates the status bar accordingly
     */
    private _refreshProjectName = async function () {
        const self: CMakeTools = this;
        if (!(await self.cache.exists())) {
            self.projectName = 'Unconfigured';
        }
        const cached = (await self.cache.get('CMAKE_PROJECT_NAME'));
        if (!cached) {
            self.projectName = 'Unnamed Project';
        } else {
            self.projectName = cached.as<string>();
        }
    }

    /**
     * @brief Reload the list of available targets
     */
    private _refreshTargetList = async function() {
        const self: CMakeTools = this;
        self.statusMessage = 'Refreshing targets...';
        self._targets = [];
        const cachepath = self.cachePath;
        if (!(await async.exists(cachepath))) {
            self._targets = [];
        }
        const generator = await self.activeGenerator();
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
    }

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

    public parseDiagnosticLine(line: string): FileDiagnostic {
        return this.parseGCCDiagnostic(line) ||
            this.parseMSVCDiagnostic(line);
    }

    public parseDiagnostics = async function (result: ExecutionResult) {
        const self: CMakeTools = this;
        const compiler = await self.cache.get('CMAKE_CXX_COMPILER_ID') || await self.cache.get('CMAKE_C_COMPILER_ID');
        const lines = result.stdout.split('\n').map(line => line.trim());
        const diags = lines.map(line => {
            return self.parseDiagnosticLine(line);

        }).filter(item => !!item);
        const diags_acc = {};
        for (const diag of diags) {
            if (!(diag.filepath in diags_acc))
                diags_acc[diag.filepath] = [];
            diags_acc[diag.filepath].push(diag.diag);
        }

        self._buildDiags.clear();
        for (const filepath in diags_acc) {
            self._buildDiags.set(vscode.Uri.file(filepath), diags_acc[filepath]);
        }
    }

    public config<T>(key: string, defaultValue?: any): T {
        const cmake_conf = vscode.workspace.getConfiguration('cmake');
        return cmake_conf.get<T>(key, defaultValue);
    }

    public get sourceDir(): string {
        const source_dir = this.config<string>('sourceDirectory');
        return source_dir.replace('${workspaceRoot}', vscode.workspace.rootPath);
    }

    public get mainListFile(): string {
        return path.join(this.sourceDir, 'CMakeLists.txt');
    }

    public get binaryDir(): string {
        const build_dir = this.config<string>('buildDirectory');
        return build_dir
            .replace('${workspaceRoot}', vscode.workspace.rootPath)
            .replace('${buildType}', this.selectedBuildType);
    }

    public get cachePath(): string {
        return path.join(this.binaryDir, 'CMakeCache.txt');
    }

    public isMultiConf = async function (): Promise<boolean> {
        const self: CMakeTools = this;
        return !!(await self.cache.get('CMAKE_CONFIGURATION_TYPES'));
    }

    public activeGenerator = async function (): Promise<string> {
        const self: CMakeTools = this;
        return (await self.cache.get('CMAKE_GENERATOR')).as<string>();
    }

    public allTargetName = async function (): Promise<string> {
        const self: CMakeTools = this;
        if (!(await self.cache.exists()))
            return 'all';
        const gen = await self.activeGenerator();
        // Visual Studio generators generate a target called ALL_BUILD, while other generators have an 'all' target
        return /Visual Studio/.test(gen) ? 'ALL_BUILD' : 'all';
    }

    public execute(args: string[], options?: ExecuteOptions): Promise<ExecutionResult> {
        return new Promise<ExecutionResult>((resolve, _) => {
            const silent: boolean = options && options.silent;
            console.info('Execute cmake with arguments:', args);
            const pipe = proc.spawn(this.config<string>('cmakePath', 'cmake'), args);
            const status = msg => vscode.window.setStatusBarMessage(msg, 4000);
            if (!silent) {
                this.currentChildProcess = pipe;
                status('Executing CMake...');
                this._channel.appendLine('[vscode] Executing cmake command: cmake ' + args.join(' '));
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
        if (!(await async.exists(cmake_cache))) {
            self._channel.appendLine("[vscode] Setting up new CMake configuration");
            const generator = await self.pickGenerator(self.config<string[]>("preferredGenerators"));
            if (generator) {
                self._channel.appendLine('[vscode] Configuring using the "' + generator + '" CMake generator');
                settings_args.push("-G" + generator);
            } else {
                console.error("None of the preferred generators was selected");
            }
            if (self.selectedBuildType == 'None') {
                self.selectedBuildType = self.config<string>("inititalBuildType", "Debug");
            }
        }

        settings_args.push('-DCMAKE_BUILD_TYPE=' + self.selectedBuildType);

        const settings = self.config<Object>("configureSettings");
        for (const key in settings) {
            let value = settings[key];
            if (value === true || value === false)
                value = value ? "TRUE" : "FALSE";
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
        self._refreshSettings();
        self._refreshProjectName(); // The user may have changed the project name in the configure step
        self._refreshTargetList();
        return result.retc;
    }

    public build = async function (target: string = null): Promise<Number> {
        const self: CMakeTools = this;
        if (target === null) {
            target = self.defaultBuildTarget || await self.allTargetName();
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
            const do_configure = !!(await vscode.window.showErrorMessage('You must configure your project before building', 'Configure Now'));
            if (!do_configure || await self.configure() !== 0)
                return -1;
        }
        await self._prebuild();
        if (self._needsReconfigure) {
            const retc = await self.configure([], false);
            if (!!retc)
                return retc;
        }
        // Pass arguments based on a particular generator
        const gen = await self.activeGenerator();
        const generator_args = (() => {
            if (/(Unix|MinGW) Makefiles|Ninja/.test(gen) && target !== 'clean' && target !== 'install')
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
        self._refreshSettings();
        self._refreshProjectName(); // The user may have changed the project name in the configure step
        self._refreshTargetList();
        await self.parseDiagnostics(result);
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
        if (await self.cache.exists() && await self.isMultiConf()) {
            const types = (await self.cache.get('CMAKE_CONFIGURATION_TYPES')).as<string>().split(';');
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
