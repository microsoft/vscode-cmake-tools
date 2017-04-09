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
import {Entry, CMakeCache} from './cache';

import {CommonCMakeToolsBase} from './common';

type Maybe<T> = util.Maybe<T>;

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

    private _reconfiguredEmitter = new vscode.EventEmitter<void>();
    private readonly _reconfigured = this._reconfiguredEmitter.event;
    get reconfigured() {
        return this._reconfigured;
    }

    private _compilerId: Maybe<string> = null;
    get compilerId() {
        return this._compilerId;
    }

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

    allCacheEntries(): api.CacheEntryProperties[] {
        return this.cmakeCache.allEntries().map(e => ({
            type: e.type,
            key: e.key,
            value: e.value,
            advanced: e.advanced,
            helpString: e.helpString,
        }));
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
            this._compilerId = cid || null;
        } else {
            this.executableTargets = [];
            this._compilerId = null;
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
        util.testHaveCommand(config.cmakePath).then(exists => {
            if (!exists) {
                vscode.window.showErrorMessage(
                    `Bad CMake executable "${config.cmakePath}". Is it installed and a valid executable?`
                );
            }
        });
        if (config.experimental_useCMakeServer) {
            vscode.window.showInformationMessage('Enabling experimental cmake-server support requires that VSCode be restarted');
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
        await this._ctestController.reloadTests(this.sourceDir, this.binaryDir, this.selectedBuildType || 'Debug');
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
            ['${buildLabel}', this.selectedBuildLabel || 'Unknown'],
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
        const bt = this.selectedBuildType;
        const meta = path.join(this.binaryDir, `CMakeToolsMeta-${bt}.txt`);
        return util.normalizePath(meta);
    }

    public get activeGenerator(): Maybe<string> {
        const gen = this.cmakeCache.get('CMAKE_GENERATOR');
        return gen
            ? gen.as<string>()
            : null;
    }

    public async configure(extra_args: string[] = [], run_prebuild = true): Promise<Number> {
        if (!await this._preconfigure()) {
            return -1;
        }

        if (run_prebuild) {
            if (!await this._prebuild()) {
                return -1;
            }
        }

        if (!(await async.exists(this.cachePath)) ||
            (this.cmakeCache.exists && this.cachePath !== this.cmakeCache.path)) {
                    await this.reloadCMakeCache();
            }

            const args: string[] = [];
            let is_multi_conf = this.isMultiConf;
            if (!this.cmakeCache.exists) {
            this._channel.appendLine('[vscode] Setting up new CMake configuration');
            const generator = await util.pickGenerator(config.preferredGenerators);
            if (generator) {
                this._channel.appendLine(
                    '[vscode] Configuring using the "' + generator +
                    '" CMake generator');
                args.push('-G' + generator);
                is_multi_conf = util.isMultiConfGenerator(generator);
            } else {
                console.error('None of the preferred generators were selected');
            }
        }

        args.push(... await this.prepareConfigure());
        args.push(
            '-H' + util.normalizePath(this.sourceDir),
            '-B' + util.normalizePath(this.binaryDir));

        const binary_dir = this.binaryDir;
        this.statusMessage = 'Configuring...';
        const result = await this.executeCMakeCommand(
            args.concat(extra_args), {
              silent: false,
              environment: config.configureEnvironment,
            },
            new BuildParser(this.binaryDir, null, this.activeGenerator));
        this.statusMessage = 'Ready';
        if (!result.retc) {
            await this._refreshAll();
            await this._reloadConfiguration();
            await this.reloadCMakeCache();
            this._needsReconfigure = false;
        }
        this._reconfiguredEmitter.fire();
        return result.retc;
    }

    protected _refreshAfterConfigure() {
        return this._refreshAll();
    }

    public async build(target: Maybe<string> = null): Promise<Number> {
        const res = await super.build(target);
        if (res == 0) {
            await this._refreshAll();
        }
        return res;
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
        return this.configure();
    }

    public async setBuildTypeWithoutConfigure() {
        const old_build_path = this.binaryDir;
        const ret = await super.setBuildTypeWithoutConfigure();
        if (old_build_path != this.binaryDir) {
            await this._setupCMakeCacheWatcher();
        }
        return ret;
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

    public stop(): Promise<boolean> {
        const child = this.currentChildProcess;
        if (!child)
            return Promise.resolve(false);
        return util.termProc(child);
    }
}
