/**
 * Module for the legacy driver. Talks to pre-CMake Server versions of CMake.
 * Can also talk to newer versions of CMake via the command line.
 */ /** */

import { CMakeExecutable } from '@cmt/cmake/cmakeExecutable';
import * as vscode from 'vscode';

import * as api from '@cmt/api';
import { CMakeCache } from '@cmt/cache';
import { CMakeDriver, CMakePreconditionProblemSolver } from '@cmt/drivers/cmakeDriver';
import { Kit, CMakeGenerator } from '@cmt/kit';
import * as logging from '@cmt/logging';
import { fs } from '@cmt/pr';
import * as proc from '@cmt/proc';
import rollbar from '@cmt/rollbar';
import * as util from '@cmt/util';
import { ConfigurationReader } from '@cmt/config';
import * as nls from 'vscode-nls';
import { BuildPreset, ConfigurePreset, TestPreset } from '@cmt/preset';
import { CodeModelContent } from './codeModel';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('legacy-driver');

/**
 * The legacy driver.
 */
export class CMakeLegacyDriver extends CMakeDriver {

    get isCacheConfigSupported(): boolean {
        return false;
    }

    async doCacheConfigure(): Promise<number> {
        throw new Error('Method not implemented.');
    }

    private constructor(cmake: CMakeExecutable, readonly config: ConfigurationReader, workspaceFolder: string | null, preconditionHandler: CMakePreconditionProblemSolver) {
        super(cmake, config, workspaceFolder, preconditionHandler);
    }

    private _needsReconfigure = true;
    doConfigureSettingsChange() {
        this._needsReconfigure = true;
    }
    async checkNeedsReconfigure(): Promise<boolean> {
        return this._needsReconfigure;
    }

    async doSetKit(cb: () => Promise<void>): Promise<void> {
        this._needsReconfigure = true;
        await cb();
    }

    async doSetConfigurePreset(need_clean: boolean, cb: () => Promise<void>): Promise<void> {
        this._needsReconfigure = true;
        if (need_clean) {
            await this._cleanPriorConfiguration();
        }
        await cb();
    }

    doSetBuildPreset(cb: () => Promise<void>): Promise<void> {
        return cb();
    }

    doSetTestPreset(cb: () => Promise<void>): Promise<void> {
        return cb();
    }

    // Legacy disposal does nothing
    async asyncDispose() {
        this._cacheWatcher.dispose();
    }

    async doConfigure(args_: string[], outputConsumer?: proc.OutputConsumer, showCommandOnly?: boolean): Promise<number> {
        // Ensure the binary directory exists
        const binary_dir = this.binaryDir;
        await fs.mkdir_p(binary_dir);

        // Dup args so we can modify them
        const args = Array.from(args_);
        args.push(util.lightNormalizePath(this.sourceDir));

        const gen = this.generator;
        if (gen) {
            args.push(`-G${gen.name}`);
            if (gen.toolset) {
                args.push(`-T${gen.toolset}`);
            }
            if (gen.platform) {
                args.push(`-A${gen.platform}`);
            }
        }
        const cmake = this.cmake.path;
        if (showCommandOnly) {
            log.showChannel();
            log.info(proc.buildCmdStr(this.cmake.path, args));
            return 0;
        } else {
            log.debug(localize('invoking.cmake.with.arguments', 'Invoking CMake {0} with arguments {1}', cmake, JSON.stringify(args)));
            const res = await this.executeCommand(cmake, args, outputConsumer, {
                environment: await this.getConfigureEnvironment(),
                cwd: binary_dir
            }).result;
            log.trace(res.stderr);
            log.trace(res.stdout);
            if (res.retc === 0) {
                this._needsReconfigure = false;
            }
            await this._reloadPostConfigure();
            return res.retc === null ? -1 : res.retc;
        }
    }

    protected async doPreCleanConfigure(): Promise<void> {
        await this._cleanPriorConfiguration();
    }

    async doPostBuild(): Promise<boolean> {
        await this._reloadPostConfigure();
        return true;
    }

    async doInit() {
        if (await fs.exists(this.cachePath)) {
            await this._reloadPostConfigure();
        }
        this._cacheWatcher.onDidChange(() => {
            log.debug(localize('reload.cmake.cache', 'Reload CMake cache: {0} changed', this.cachePath));
            rollbar.invokeAsync(localize('reloading.cmake.cache', 'Reloading CMake Cache'), () => this._reloadPostConfigure());
        });
    }

    static async create(cmake: CMakeExecutable,
        config: ConfigurationReader,
        useCMakePresets: boolean,
        kit: Kit | null,
        configurePreset: ConfigurePreset | null,
        buildPreset: BuildPreset | null,
        testPreset: TestPreset | null,
        workspaceFolder: string | null,
        preconditionHandler: CMakePreconditionProblemSolver,
        preferredGenerators: CMakeGenerator[]): Promise<CMakeLegacyDriver> {
        log.debug(localize('creating.instance.of', 'Creating instance of {0}', "LegacyCMakeDriver"));
        return this.createDerived(new CMakeLegacyDriver(cmake, config, workspaceFolder, preconditionHandler),
            useCMakePresets,
            kit,
            configurePreset,
            buildPreset,
            testPreset,
            preferredGenerators);
    }

    get targets() {
        return [];
    }
    get executableTargets() {
        return [];
    }
    get uniqueTargets() {
        return [];
    }
    get cmakeFiles() {
        return [];
    }

    /**
     * Watcher for the CMake cache file on disk.
     */
    private readonly _cacheWatcher = vscode.workspace.createFileSystemWatcher(this.cachePath);

    get cmakeCache() {
        return this._cmakeCache;
    }
    private _cmakeCache: CMakeCache | null = null;

    private async _reloadPostConfigure() {
        // Force await here so that any errors are thrown into rollbar
        const new_cache = await CMakeCache.fromPath(this.cachePath);
        this._cmakeCache = new_cache;
    }

    get cmakeCacheEntries() {
        let ret = new Map<string, api.CacheEntryProperties>();
        if (this.cmakeCache) {
            ret = util.reduce(this.cmakeCache.allEntries, ret, (acc, entry) => acc.set(entry.key, entry));
        }
        return ret;
    }

    get generatorName(): string | null {
        if (!this.cmakeCache) {
            return null;
        }
        const gen = this.cmakeCache.get('CMAKE_GENERATOR');
        return gen ? gen.as<string>() : null;
    }

    get codeModelContent(): CodeModelContent | null {
        return null;
    }
    get onCodeModelChanged() {
        return new vscode.EventEmitter<null>().event;
    }

}
