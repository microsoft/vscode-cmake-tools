'use strict';

import * as path from 'path';
import * as fs from 'fs';
import * as proc from 'child_process';
import * as os from 'os';
import * as yaml from 'js-yaml';
import * as ajv from 'ajv';
import * as vscode from 'vscode';

import * as async from './async';
// import * as environment from './environment';
// import * as ctest from './ctest';
import {FileDiagnostic,
        DiagnosticParser,
        diagnosticParsers,
        BuildParser,
        } from './diagnostics';
import * as util from './util';
import {CompilationDatabase} from './compdb';
import * as api from './api';
import {config} from './config';
import {CMakeCacheEntry, CMakeCache} from './cache';

import {CommonCMakeToolsBase} from './common';

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
        get_target_property(is_imported \${target} IMPORTED)
        if(NOT is_imported)
            file(APPEND
                "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.in.txt"
                "executable;\${target};$<TARGET_FILE:\${target}>\n"
                )
            _cmt_generate_system_info()
        endif()
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

    if({{{IS_MULTICONF}}})
        set(condition CONDITION "$<CONFIG:Debug>")
    endif()

    file(WRITE "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.in.txt" "")
    file(GENERATE
        OUTPUT "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.txt"
        INPUT "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.in.txt"
        \${condition}
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
`;

const open = require('open') as ((url: string, appName?: string, callback?: Function) => void);

class CMakeTargetListParser extends util.OutputParser {
    private _accumulatedLines: string[] = [];

    public parseLine(line: string): Maybe<number> {
        this._accumulatedLines.push(line);
        return null;
    }

    public getTargets(generator: string) {
        const important_lines = (generator.endsWith('Makefiles')
            ? this._accumulatedLines.filter(l => l.startsWith('... '))
            : this._accumulatedLines.filter(l => l.indexOf(': ') !== -1))
                .filter(l => !l.includes('All primary targets'));
        const targets = important_lines
            .map(l => generator.endsWith('Makefiles')
                ? l.substr(4)
                : l)
            .map(l => / /.test(l) ? l.substr(0, l.indexOf(' ')) : l)
            .map(l => l.replace(':', ''));
        // Sometimes the 'all' target isn't there. Not sure when or why, but we
        // can just patch around it
        if (targets.indexOf('all') < 0) {
            targets.push('all');
        }
        return targets;
    }
}

export class CMakeTools extends CommonCMakeToolsBase implements api.CMakeToolsAPI {
    private _lastConfigureSettings = {};
    private _compilationDatabase: Promise<Maybe<CompilationDatabase>> = Promise.resolve(null);
    public compilerId: Maybe<string> = null;

    private _targets: api.NamedTarget[] = [];
    get targets() { return this._targets; }

    public markDirty() {
        this._needsReconfigure = true;
    }

    private _cmakeCache: CMakeCache;
    public get cmakeCache() {
        return this._cmakeCache;
    }
    public set cmakeCache(cache: CMakeCache) {
        this._cmakeCache = cache;
        this._statusBar.projectName = this.projectName;
    }

    public cacheEntry(name: string) {
        return this.cmakeCache.get(name);
    }

    private _initFinished : Promise<CMakeTools>;
    public get initFinished() : Promise<CMakeTools> {
        return this._initFinished;
    }

    private _needsReconfigure : boolean;
    public get needsReconfigure() : boolean {
        return this._needsReconfigure;
    }
    public set needsReconfigure(v : boolean) {
        this._needsReconfigure = v;
    }

    private async reloadCMakeCache() {
        if (this.cmakeCache && this.cmakeCache.path === this.cachePath) {
            this.cmakeCache = await this.cmakeCache.getReloaded();
        } else {
            this.cmakeCache = await CMakeCache.fromPath(this.cachePath);
        }
        this._statusBar.projectName = this.projectName;
        return this.cmakeCache;
    }

    private _executableTargets: api.ExecutableTarget[] = [];
    public get executableTargets() {
        return this._executableTargets;
    }

    public set executableTargets(value: api.ExecutableTarget[]) {
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
            const [_, os, proc, cid] = tuples.find(tup => tup[0] === 'system')!;
            this.compilerId = cid || null;
        } else {
            this.executableTargets = [];
            this.compilerId = null;
        }
    }

    private _reloadConfiguration() {
        const new_settings = config.configureSettings;
        this._needsReconfigure = JSON.stringify(new_settings) !== JSON.stringify(this._lastConfigureSettings);
        this._lastConfigureSettings = new_settings;
        // A config change could require reloading the CMake Cache (ie. changing the build path)
        this._setupCMakeCacheWatcher();
        // Use may have disabled build diagnostics.
        if (!config.parseBuildDiagnostics) {
            this._diagnostics.clear();
        }
        if (!this._metaWatcher) {
            this._setupMetaWatcher();
        }
        this._reloadVariants();
        util.testHaveCommand(config.cmakePath).then(exists => {
            if (!exists) {
                vscode.window.showErrorMessage(
                    `Bad CMake executable "${config.cmakePath}". Is it installed and a valid executable?`
                );
            }
        });
    }

    private async _refreshWorkspaceCacheContent() {
        // this._workspaceCacheContent = await WorkspaceCacheFile.readCache(this._workspaceCachePath, {variant:null});
        // this._writeWorkspaceCacheContent();
        this._setupCMakeCacheWatcher();
        if (this._workspaceCacheContent.variant) {
            this.activeVariantCombination = this._workspaceCacheContent.variant;
        }
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
                this._statusBar.projectName = this.projectName;
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

    protected async _init(): Promise<CMakeTools> {
        await this.reloadCMakeCache();
        // Initialize the base class for common tools
        await super._init();

        // Load up the CMake cache
        await this._setupCMakeCacheWatcher();
        this._setupMetaWatcher();
        this._reloadConfiguration();

        await this._refreshTargetList();
        this.statusMessage = 'Ready';

        this._lastConfigureSettings = config.configureSettings;
        this._needsReconfigure = true;
        vscode.workspace.onDidChangeConfiguration(() => {
            console.log('Reloading CMakeTools after configuration change');
            this._reloadConfiguration();
        });

        if (config.initialBuildType !== null) {
            vscode.window.showWarningMessage('The "cmake.initialBuildType" setting is now deprecated and will no longer be used.');
        }

        const last_nag_time = this._context.globalState.get('feedbackWanted.lastNagTime', 0);
        const now = new Date().getTime();
        const time_since_nag = now - last_nag_time;
        // Ask for feedback once every thirty days
        const do_nag = time_since_nag > 1000 * 60 * 60 * 24 * 30;
        if (do_nag && Math.random() < 0.1) {
            this._context.globalState.update('feedbackWanted.lastNagTime', now);
            vscode.window.showInformationMessage<{title: string, action?: () => void, isCloseAffordance?: boolean}>(
                'Like CMake Tools? I need your feedback to help make this extension better! Submitting feedback should only take a few seconds.',
                {
                    title: 'I\'ve got a few seconds',
                    action: () => {
                        open('https://github.com/vector-of-bool/vscode-cmake-tools/issues?q=is%3Aopen+is%3Aissue+label%3A%22feedback+wanted%21%22');
                    },
                },
                {
                    title: 'Not now',
                    isCloseAffordance: true,
                }).then(chosen => {
                    if (chosen.action) {
                        chosen.action();
                    }
                });
        }

        return this;
    }

    constructor(ctx: vscode.ExtensionContext) {
        super(ctx);
        this._initFinished = this._init();
    }

    public async compilationInfoForFile(filepath: string): Promise<api.CompilationInfo|null> {
        const db = await this._compilationDatabase;
        if (!db) {
            return null;
        }
        return db.getCompilationInfoForUri(vscode.Uri.file(filepath));
    }

    private async _refreshAll() {
        await this.reloadCMakeCache();
        await this._refreshTargetList();
        await this._reloadMetaData();
        await this._refreshTests();
        this._compilationDatabase = CompilationDatabase.fromFilePath(path.join(this.binaryDir, 'compile_commands.json'));
    }

    /**
     * @brief Reload the list of available targets
     */
    private async _refreshTargetList(): Promise<api.NamedTarget[]> {
        this._targets = [];
        if (!this.cmakeCache.exists) {
            return this.targets;
        }
        this.statusMessage = 'Refreshing targets...';
        const generator = this.activeGenerator;
        if (generator && /(Unix|MinGW|NMake) Makefiles|Ninja/.test(generator)) {
            const parser = new CMakeTargetListParser();
            await this.executeCMakeCommand(['--build', this.binaryDir, '--target', 'help'], {
                silent: true,
                environment: {}
            }, parser);
            this._targets = parser.getTargets(generator).map(
                t => ({type: 'named' as 'named', name: t}));
        }
        this.statusMessage = 'Ready';
        return this.targets;
    }

    public replaceVars(str: string): string {
        const replacements = [
            ['${buildType}', this.selectedBuildType || 'Unknown'],
            ['${workspaceRoot}', vscode.workspace.rootPath],
            ['${workspaceRootFolderName}', path.basename(vscode.workspace.rootPath)]
        ] as [string, string][];
        return replacements.reduce(
            (accdir, [needle, what]) => util.replaceAll(accdir, needle, what),
            str,
        );
    }

    /**
     * @brief Get the path to the metadata file
     */
    public get metaPath(): string {
        const meta = path.join(this.binaryDir, 'CMakeToolsMeta.txt');
        return util.normalizePath(meta);
    }

    public get activeGenerator(): Maybe<string> {
        const gen = this.cmakeCache.get('CMAKE_GENERATOR');
        return gen
            ? gen.as<string>()
            : null;
    }

    // Given a list of CMake generators, returns the first one available on this system
    public async pickGenerator(candidates: string[]): Promise<Maybe<string>> {
        // The user can override our automatic selection logic in their config
        const generator = config.generator;
        if (generator) {
            // User has explicitly requested a certain generator. Use that one.
            return generator;
        }
        for (const gen of candidates) {
            const delegate = {
                Ninja: async () => {
                    return await util.testHaveCommand('ninja-build') || await util.testHaveCommand('ninja');
                },
                "MinGW Makefiles": async () => {
                    return process.platform === 'win32' && await util.testHaveCommand('make');
                },
                "NMake Makefiles": async () => {
                    return process.platform === 'win32' && await util.testHaveCommand('nmake', ['/?']);
                },
                'Unix Makefiles': async () => {
                    return process.platform !== 'win32' && await util.testHaveCommand('make');
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

        if (!this.activeVariantCombination) {
            const ok = await this.setBuildTypeWithoutConfigure();
            if (!ok) {
                return -1;
            }
        }

        if (run_prebuild) {
            const ok = await this._prebuild();
            if (!ok) {
                return -1;
            }
        }

        const cmake_cache = this.cachePath;
        this._channel.show();

        if (!(await async.exists(cmake_cache))
         || (this.cmakeCache.exists && this.cachePath !== this.cmakeCache.path)) {
            await this.reloadCMakeCache();
        }

        const settings_args: string[] = [];
        let is_multi_conf = this.isMultiConf;
        if (!this.cmakeCache.exists) {
            this._channel.appendLine("[vscode] Setting up new CMake configuration");
            const generator = await this.pickGenerator(config.preferredGenerators);
            if (generator) {
                this._channel.appendLine('[vscode] Configuring using the "' + generator + '" CMake generator');
                settings_args.push("-G" + generator);
                is_multi_conf = util.isMultiConfGenerator(generator);
            } else {
                console.error("None of the preferred generators was selected");
            }
        }

        const toolset = config.toolset;
        if (toolset) {
            settings_args.push('-T' + toolset);
        }

        if (!is_multi_conf) {
            settings_args.push('-DCMAKE_BUILD_TYPE=' + this.selectedBuildType);
        }

        const settings = Object.assign({}, config.configureSettings);
        settings.CMAKE_EXPORT_COMPILE_COMMANDS = true;

        const variant = this.activeVariant;
        if (variant) {
            Object.assign(settings, variant.settings || {});
            settings.BUILD_SHARED_LIBS = variant.linkage === 'shared';
        }

        if (!(await async.exists(this.binaryDir))) {
            await util.ensureDirectory(this.binaryDir);
        }

        const cmt_dir = path.join(this.binaryDir, 'CMakeTools');
        if (!(await async.exists(cmt_dir))) {
            await util.ensureDirectory(cmt_dir);
        }

        const helpers = path.join(cmt_dir, 'CMakeToolsHelpers.cmake');
        const helper_content = util.replaceAll(CMAKETOOLS_HELPER_SCRIPT,
                                        '{{{IS_MULTICONF}}}',
                                        is_multi_conf
                                            ? '1'
                                            : '0'
                                        );
        await util.writeFile(helpers, helper_content);
        const old_path = settings['CMAKE_PREFIX_PATH'] as Array<string> || [];
        settings['CMAKE_MODULE_PATH'] = Array.from(old_path).concat([
            cmt_dir.replace(/\\/g, path.posix.sep)
        ]);
        const initial_cache_content = [
            '# This file is generated by CMake Tools! DO NOT EDIT!',
            'cmake_policy(PUSH)',
            'if(POLICY CMP0053)',
            '   cmake_policy(SET CMP0053 NEW)',
            'endif()',
        ];

        for (const key in settings) {
            let value = settings[key];
            let typestr = 'UNKNOWN';
            if (value === true || value === false) {
                typestr = 'BOOL';
                value = value ? "TRUE" : "FALSE";
            }
            if (typeof(value) === 'string') {
                typestr = 'STRING';
                value = this.replaceVars(value)
                value = util.replaceAll(value, ';', '\\;');
            }
            if (value instanceof Number || typeof value === 'number') {
                typestr = 'STRING';
            }
            if (value instanceof Array) {
                typestr = 'STRING';
                value = value.join(';');
            }
            initial_cache_content.push(`set(${key} "${value.toString().replace(/"/g, '\\"')}" CACHE ${typestr} "Variable supplied by CMakeTools. Value is forced." FORCE)`);
        }
        initial_cache_content.push('cmake_policy(POP)')
        const init_cache_path = path.join(this.binaryDir, 'CMakeTools', 'InitializeCache.cmake');
        await util.writeFile(init_cache_path, initial_cache_content.join('\n'));
        let prefix = config.installPrefix;
        if (prefix && prefix !== "") {
            prefix = this.replaceVars(prefix);
            settings_args.push("-DCMAKE_INSTALL_PREFIX=" + prefix);
        }

        const binary_dir = this.binaryDir;
        this.statusMessage = 'Configuring...';
        const result = await this.executeCMakeCommand(
            ['-H' + this.sourceDir.replace(/\\/g, path.posix.sep),
             '-B' + binary_dir.replace(/\\/g, path.posix.sep),
             '-C' + init_cache_path]
                .concat(settings_args)
                .concat(extra_args)
                .concat(config.configureArgs),
            {
                silent: false,
                environment: config.configureEnvironment,
            },
            new BuildParser(this.binaryDir, null, this.activeGenerator)
        );
        this.statusMessage = 'Ready';
        if (!result.retc) {
            await this._refreshAll();
            await this._reloadConfiguration();
            this._needsReconfigure = false;
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
        const ok = await this._prebuild();
        if (!ok) {
            return -1;
        }
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
        this.statusMessage = `Building ${target}...`;
        const result = await this.executeCMakeCommand([
            '--build', this.binaryDir,
            '--target', target,
            '--config', this.selectedBuildType || 'Debug',
        ]
            .concat(config.buildArgs)
            .concat([
                '--'
            ]
                .concat(generator_args)
                .concat(config.buildToolArgs)
            ),
            {
                silent: false,
                environment: config.buildEnvironment,
            },
            (config.parseBuildDiagnostics
                ? new BuildParser(this.binaryDir,
                                  config.enableOutputParsers,
                                  this.activeGenerator)
                : new util.NullParser())
        );
        this.statusMessage = 'Ready';
        if (!result.retc) {
            await this._refreshAll();
        }
        return result.retc;
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
            await util.rmdir(cmake_files);
        }
        return await this.configure();
    }

    public async setBuildTypeWithoutConfigure() {
        const old_build_path = this.binaryDir;
        const ret = await super.setBuildTypeWithoutConfigure();
        if (old_build_path != this.binaryDir) {
            await this._setupCMakeCacheWatcher();
        }
        return ret;
    }

    public async debugTarget() {
        if (!this.executableTargets.length) {
            vscode.window.showWarningMessage('No targets are available for debugging. Be sure you have included CMakeToolsHelpers in your CMake project.');
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
        const real_config = {
            name: `Debugging Target ${target.name}`,
            type: (this.compilerId && this.compilerId.includes('MSVC'))
                ? 'cppvsdbg'
                : 'cppdbg',
            request: 'launch',
            cwd: '${workspaceRoot}',
            args: [],
            MIMode: process.platform === 'darwin' ? 'lldb' : 'gdb',
        };
        const user_config = config.debugConfig;
        Object.assign(real_config, user_config);
        real_config['program'] = target.path;
        console.log(JSON.stringify(real_config));
        return vscode.commands.executeCommand('vscode.startDebug', real_config);
    }

    public async selectDebugTarget() {
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

    public async stop(): Promise<boolean> {
        const child = this.currentChildProcess;
        if (!child)
            return false;
        // Stopping the process isn't as easy as it may seem. cmake --build will
        // spawn child processes, and CMake won't forward signals to its
        // children. As a workaround, we list the children of the cmake process
        // and also send signals to them.
        await this._killTree(child.pid);
        return true;
    }

    public async _killTree(pid: number) {
        if (process.platform !== 'win32') {
            let children: number[] = [];
            const stdout = (await async.execute('pgrep', ['-P', pid.toString()])).stdout.trim();
            if (!!stdout.length) {
                children = stdout.split('\n').map(line => Number.parseInt(line));
            }
            for (const other of children) {
                if (other)
                    await this._killTree(other);
            }
            process.kill(pid, 'SIGINT');
        } else {
            // Because reasons, Node's proc.kill doesn't work on killing child
            // processes transitively. We have to do a sad and manually kill the
            // task using taskkill.
            proc.exec('taskkill /pid ' + pid.toString() + ' /T /F');
        }
    }
}
