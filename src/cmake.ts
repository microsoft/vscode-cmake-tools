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

export enum EntryType {
    Bool,
    String,
    Path,
    Filepath,
    Internal,
    Uninitialized,
    Static,
};

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

export class CMakeTools {
    private _channel: vscode.OutputChannel;
    private _diagnostics: vscode.DiagnosticCollection;
    private _cmakeToolsStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.0010);
    private _buildButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3);
    private _lastConfigureSettings = {};
    private _needsReconfigure = false;

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
    private _selectedBuildType: string = 'None';
    public get selectedBuildType(): string {
        return this._selectedBuildType;
    }
    public set selectedBuildType(v: string) {
        this._selectedBuildType = v;
        this._refreshStatusBarItems();
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


    private _reloadSettings() {
        this.cache = new CacheReader(this.cachePath);
        const new_settings = this.config<Object>('configureSettings');
        this._needsReconfigure = JSON.stringify(new_settings) !== JSON.stringify(this._lastConfigureSettings);
        this._lastConfigureSettings = new_settings;
    }

    constructor() {
        this._channel = vscode.window.createOutputChannel('CMake/Build');
        this._diagnostics = vscode.languages.createDiagnosticCollection('cmake-diags');
        this.cache = new CacheReader(this.cachePath);

        vscode.workspace.onDidChangeConfiguration(() => {
            console.log('Reloading CMakeTools after configuration change');
            this._reloadSettings();
        });

        this._lastConfigureSettings = this.config<Object>('configureSettings');
        this._needsReconfigure = true;

        this._cmakeToolsStatusItem.command = 'cmake.setBuildType';
        this.currentChildProcess = null; // Inits the content of the buildButton


        // Start by loading the current CMake build type from the cache
        this._initSelectedBuildType();
        // Load the current project name from the cache
        this._refreshProjectName();

        this.statusMessage = 'Ready';
    }

    private _refreshStatusBarItems = async function () {
        const self: CMakeTools = this;
        self._cmakeToolsStatusItem.text = `CMake: ${self.projectName}: ${self.selectedBuildType || 'Unknown'}: ${self.statusMessage}`;

        if (await async.exists(path.join(self.sourceDir, 'CMakeLists.txt'))) {
            self._cmakeToolsStatusItem.show();
            self._buildButton.show();
        } else {
            self._cmakeToolsStatusItem.hide();
            self._buildButton.hide();
        }

        const target = self.defaultBuildTarget || await self.allTargetName();
        this._buildButton.text = this.isBusy ? '$(x) Stop' : `$(gear) Build (${target})`;
        this._buildButton.command = this.isBusy ? 'cmake.stop' : 'cmake.build';
    }

    /**
     * @brief Initializes the 'selectedBuildType' attribute.
     *
     * The 'selectedBuildType' attribute is a bit of a tricky thing. On initial
     * load, we want to read it from the CMake cache, unless we are in a
     * multiconf generator like Visual Studio. In that case, we will default to
     * 'Debug'.
     *
     * This should only be called when the build type is completely impossible
     * to determine without looking into the CMake cache.
     *
     * @returns A promise resolving to the selectedBuildType
     */
    public _initSelectedBuildType = async function (): Promise<string> {
        const self: CMakeTools = this;
        if (!(await self.cache.exists()))
            self.selectedBuildType = 'None';
        if (await self.isMultiConf())
            self.selectedBuildType = 'Debug';
        else
            self.selectedBuildType = (await self.cache.get('CMAKE_BUILD_TYPE')).as<string>();
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

    public config<T>(key: string, defaultValue?: any): T {
        const cmake_conf = vscode.workspace.getConfiguration('cmake');
        return cmake_conf.get<T>(key, defaultValue);
    }

    public get sourceDir(): string {
        return vscode.workspace.rootPath;
    }

    public get mainListFile(): string {
        return path.join(this.sourceDir, 'CMakeLists.txt');
    }

    public get binaryDir(): string {
        const build_dir = this.config<string>('buildDirectory');
        return build_dir.replace('${workspaceRoot}', vscode.workspace.rootPath);
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

    public execute(args: string[]): Promise<Number> {
        return new Promise<Number>((resolve, _) => {
            console.info('Execute cmake with arguments:', args);
            const pipe = proc.spawn('cmake', args);
            this.currentChildProcess = pipe;
            const status = msg => vscode.window.setStatusBarMessage(msg, 4000);
            status('Executing CMake...');
            this._channel.appendLine('[vscode] Executing cmake command: cmake ' + args.join(' '));
            let stderr_acc = '';
            pipe.stdout.on('data', (data: Uint8Array) => {
                const str = data.toString();
                console.log('cmake [stdout]: ' + str.trim());
                this._channel.append(str);
                status(str.trim());
            });
            pipe.stderr.on('data', (data: Uint8Array) => {
                const str = data.toString();
                console.log('cmake [stderr]: ' + str.trim());
                stderr_acc += str;
                this._channel.append(str);
                status(str.trim());
            });
            pipe.on('close', (retc: Number) => {
                console.log('cmake exited with return code ' + retc);
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
                resolve(retc);
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
                vscode.window.showErrorMessage('Unknown CMake generator "' + gen + '"');
                continue;
            }
            if (await delegate())
                return gen;
            else
                console.log('Genereator "' + gen + '" is not supported');
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

        const binary_dir = self.binaryDir;
        const cmake_cache = self.cachePath;
        self._channel.show();
        const settings_args = [];
        if (!(await async.exists(cmake_cache))) {
            self._channel.appendLine("[vscode] Setting up initial CMake configuration");
            const generator = await self.pickGenerator(self.config<string[]>("preferredGenerators"));
            if (generator) {
                self._channel.appendLine('[vscode] Configuring using the "' + generator + '" CMake generator');
                settings_args.push("-G" + generator);
            } else {
                console.error("None of the preferred generators was selected");
            }

            self.selectedBuildType = self.config<string>("inititalBuildType", "Debug");
        }

        settings_args.push('-DCMAKE_BUILD_TYPE=' + self.selectedBuildType);

        const settings = self.config<Object>("configureSettings");
        for (const key in settings) {
            let value = settings[key];
            if (value === true || value === false)
                value = value ? "TRUE" : "FALSE";
            if (value instanceof Array)
                value = value.join(';');
            settings_args.push("-D" + key + "=" + value);
        }

        self.statusMessage = 'Configuring...';
        const result = await self.execute(
            ['-H' + self.sourceDir, '-B' + binary_dir]
                .concat(settings_args)
                .concat(extra_args)
        );
        self.statusMessage = 'Ready';
        self._reloadSettings();
        self._refreshProjectName(); // The user may have changed the project name in the configure step
        return result;
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
        // Determine the argument to start parallel builds
        const gen = await self.activeGenerator();
        const parallel_args = (() => {
            if (/(Unix|MinGW) Makefiles|Ninja/.test(gen))
                return ['-j', os.cpus().length + 2 + ''];
            else if (/Visual Studio/.test(gen))
                return ['/m'];
            else
                return [];
        })();
        self._channel.show();
        self.statusMessage = 'Building...';
        const retc = await self.execute([
            '--build', self.binaryDir,
            '--target', target,
            '--config', self.selectedBuildType,
            '--'].concat(parallel_args));
        self.statusMessage = 'Ready';
        self._refreshProjectName(); // The user may have changed the project name in the configure step
        return retc;
    }

    public clean = async function (): Promise<Number> {
        const self: CMakeTools = this;
        return await self.build('clean');
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

    public buildWithTarget = async function (): Promise<Number> {
        const self: CMakeTools = this;
        const target = await vscode.window.showInputBox({
            prompt: 'Enter a target name',
        });
        if (target === null)
            return -1;
        return await self.build(target);
    }

    public setDefaultTarget = async function () {
        const self: CMakeTools = this;
        const new_default = await vscode.window.showInputBox({
            prompt: 'Input the name of the new default target to build',
            placeHolder: '(eg. "install", "all", "my-executable")',
        });
        if (!new_default)
            return;
        self.defaultBuildTarget = new_default;
    }

    public setBuildType = async function (): Promise<Number> {
        const self: CMakeTools = this;
        let chosen = null;
        if (await self.isMultiConf()) {
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
        return await self.execute(['-E', 'chdir', self.binaryDir, 'ctest', '-j8', '--output-on-failure']);
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
