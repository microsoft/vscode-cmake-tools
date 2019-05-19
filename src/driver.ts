/**
 * Defines base class for CMake drivers
 */ /** */

import {CMakeExecutable} from '@cmt/cmake/cmake-executable';
import {ProgressMessage} from '@cmt/cms-client';
import {CompileCommand} from '@cmt/compdb';
import * as shlex from '@cmt/shlex';
import * as path from 'path';
import * as vscode from 'vscode';

import * as api from './api';
import * as codepages from './code-pages';
import * as expand from './expand';
import {CMakeGenerator, effectiveKitEnvironment, Kit, kitChangeNeedsClean} from './kit';
import * as logging from './logging';
import paths from './paths';
import {fs} from './pr';
import * as proc from './proc';
import rollbar from './rollbar';
import * as util from './util';
import {ConfigureArguments, VariantOption} from './variant';
import {DirectoryContext} from './workspace';

const log = logging.createLogger('driver');

/**
 * Base class for CMake drivers.
 *
 * CMake drivers are separated because different CMake version warrant different
 * communication methods. Older CMake versions need to be driven by the command
 * line, but newer versions may be controlled via CMake server, which provides
 * a much richer interface.
 *
 * This class defines the basis for what a driver must implement to work.
 */
export abstract class CMakeDriver implements vscode.Disposable {
  /**
   * Do the configuration process for the current project.
   *
   * @returns The exit code from CMake
   */
  protected abstract doConfigure(extra_args: string[], consumer?: proc.OutputConsumer): Promise<number>;

  /**
   * Perform a clean configure. Deletes cached files before running the config
   * @param consumer The output consumer
   */
  abstract cleanConfigure(consumer?: proc.OutputConsumer): Promise<number>;

  protected doPreBuild(): Promise<boolean> { return Promise.resolve(true); }

  protected doPostBuild(): Promise<boolean> { return Promise.resolve(true); }

  /**
   * Check if we need to reconfigure, such as if an important file has changed
   */
  abstract checkNeedsReconfigure(): Promise<boolean>;

  /**
   * List of targets known to CMake
   */
  abstract get targets(): api.Target[];

  /**
   * List of executable targets known to CMake
   */
  abstract get executableTargets(): api.ExecutableTarget[];

  /**
   * Do any necessary disposal for the driver. For the CMake Server driver,
   * this entails shutting down the server process and closing the open pipes.
   *
   * The reason this is separate from the regular `dispose()` is so that the
   * driver shutdown may be `await`ed on to ensure full shutdown.
   */
  abstract asyncDispose(): Promise<void>;

  /**
   * Construct the driver. Concrete instances should provide their own creation
   * routines.
   */
  protected constructor(public readonly cmake: CMakeExecutable, readonly ws: DirectoryContext) {
    // We have a cache of file-compilation terminals. Wipe them out when the
    // user closes those terminals.
    vscode.window.onDidCloseTerminal(closed => {
      for (const [key, term] of this._compileTerms) {
        if (term === closed) {
          log.debug('Use closed a file compilation terminal');
          this._compileTerms.delete(key);
          break;
        }
      }
    });
  }

  /**
   * Dispose the driver. This disposes some things synchronously, but also
   * calls the `asyncDispose()` method to start any asynchronous shutdown.
   */
  dispose() {
    log.debug('Disposing base CMakeDriver');
    for (const term of this._compileTerms.values()) {
      term.dispose();
    }
    for (const sub of [this._settingsSub, this._argsSub, this._envSub]) {
      sub.dispose();
    }
    rollbar.invokeAsync('Async disposing CMake driver', () => this.asyncDispose());
  }

  /**
   * The environment variables required by the current kit
   */
  private _kitEnvironmentVariables = new Map<string, string>();

  /**
   * Get the environment variables required by the current Kit
   */
  getKitEnvironmentVariablesObject(): proc.EnvironmentVariables {
    return util.reduce(this._kitEnvironmentVariables.entries(), {}, (acc, [key, value]) => ({...acc, [key]: value}));
  }

  /**
   * Get the environment variables that should be set at CMake-configure time.
   */
  async getConfigureEnvironment(): Promise<proc.EnvironmentVariables> {
    return util.mergeEnvironment(this.getKitEnvironmentVariablesObject(),
                                 await this.getExpandedEnvironment(),
                                 await this.getBaseConfigureEnvironment(),
                                 this._variantEnv);
  }

  get onProgress(): vscode.Event<ProgressMessage> {
    return (_cb: (ev: ProgressMessage) => any) => new util.DummyDisposable();
  }

  /**
   * The current Kit. Starts out `null`, but once set, is never `null` again.
   * We do some separation here to protect ourselves: The `_baseKit` property
   * is `private`, so derived classes cannot change it, except via
   * `_setBaseKit`, which only allows non-null kits. This prevents the derived
   * classes from resetting the kit back to `null`.
   */
  private _kit: Kit|null = null;

  /**
   * Get the environment and apply any needed
   * substitutions before returning it.
   */
  async getExpandedEnvironment(): Promise<{[key: string]: string}> {
    const env = {} as {[key: string]: string};
    const opts = this.expansionOptions;
    await Promise.resolve(util.objectPairs(this.ws.config.environment)
                              .forEach(async ([key, value]) => env[key] = await expand.expandString(value, opts)));
    return env;
  }

  /**
   * Get the configure environment and apply any needed
   * substitutions before returning it.
   */
  async getBaseConfigureEnvironment(): Promise<{[key: string]: string}> {
    const config_env = {} as {[key: string]: string};
    const opts = this.expansionOptions;
    await Promise.resolve(
        util.objectPairs(this.ws.config.configureEnvironment)
            .forEach(async ([key, value]) => config_env[key] = await expand.expandString(value, opts)));
    return config_env;
  }

  /**
   * Get the vscode root workspace folder.
   *
   * @returns Returns the vscode root workspace folder. Returns `null` if no folder is open or the folder uri is not a
   * `file://` scheme.
   */
  private get _workspaceRootPath() {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders[0].uri.scheme !== 'file') {
      return null;
    }
    return util.lightNormalizePath(vscode.workspace.workspaceFolders[0].uri.fsPath);
  }

  /**
   * The options that will be passed to `expand.expandString` for this driver.
   */
  get expansionOptions(): expand.ExpansionOptions {
    const ws_root = this._workspaceRootPath || '.';

    // Fill in default replacements
    const vars: expand.ExpansionVars = {
      workspaceRoot: ws_root,
      workspaceFolder: ws_root,
      buildType: this.currentBuildType,
      workspaceRootFolderName: path.basename(ws_root),
      generator: this.generatorName || 'null',
      userHome: paths.userHome,
      buildKit: this._kit ? this._kit.name : '__unknownkit__',
      // DEPRECATED EXPANSION: Remove this in the future:
      projectName: 'ProjectName',
    };

    // Update Variant replacements
    const variantSettings = this.ws.state.activeVariantSettings;
    const variantVars: {[key: string]: string} = {};
    if (variantSettings) {
      variantSettings.forEach((value: string, key: string) => variantVars[key] = value);
    }

    return {vars, variantVars};
  }

  getEffectiveSubprocessEnvironment(opts?: proc.ExecutionOptions): proc.EnvironmentVariables {
    const cur_env = process.env as proc.EnvironmentVariables;
    const kit_env = (this.ws.config.ignoreKitEnv) ? {} : this.getKitEnvironmentVariablesObject();
    return util.mergeEnvironment(cur_env,
                                 kit_env,
                                 (opts && opts.environment) ? opts.environment : {});
  }

  executeCommand(command: string, args?: string[], consumer?: proc.OutputConsumer, options?: proc.ExecutionOptions):
      proc.Subprocess {
    const environment = this.getEffectiveSubprocessEnvironment(options);
    const exec_options = {...options, environment};
    return proc.execute(command, args, consumer, exec_options);
  }

  /**
   * File compilation terminals. This is a map, rather than a single terminal
   * instance for two reasons:
   *
   * 1. Different compile commands may require different environment variables.
   * 2. Different compile commands may require different working directories.
   *
   * The key of each terminal is generated deterministically in `runCompileCommand()`
   * based on the CWD and environment of the compile command.
   */
  private readonly _compileTerms = new Map<string, vscode.Terminal>();

  /**
   * Launch the given compilation command in an embedded terminal.
   * @param cmd The compilation command from a compilation database to run
   */
  runCompileCommand(cmd: CompileCommand): vscode.Terminal {
    if ('command' in cmd) {
      const args = [...shlex.split(cmd.command)];
      return this.runCompileCommand({directory: cmd.directory, file: cmd.file, arguments: args});
    } else {
      const env = this.getEffectiveSubprocessEnvironment();
      const key = `${cmd.directory}${JSON.stringify(env)}`;
      let existing = this._compileTerms.get(key);
      const shellPath = process.platform === 'win32' ? 'cmd.exe' : undefined;
      if (!existing) {
        const term = vscode.window.createTerminal({
          name: 'File Compilation',
          cwd: cmd.directory,
          env,
          shellPath,
        });
        this._compileTerms.set(key, term);
        existing = term;
      }
      existing.show();
      existing.sendText(cmd.arguments.map(s => shlex.quote(s)).join(' ') + '\r\n');
      return existing;
    }
  }

  /**
   * Remove the prior CMake configuration files.
   */
  protected async _cleanPriorConfiguration() {
    const build_dir = this.binaryDir;
    const cache = this.cachePath;
    const cmake_files = path.join(build_dir, 'CMakeFiles');
    if (await fs.exists(cache)) {
      log.info('Removing ', cache);
      await fs.unlink(cache);
    }
    if (await fs.exists(cmake_files)) {
      log.info('Removing ', cmake_files);
      await fs.rmdir(cmake_files);
    }
  }

  /**
   * Change the current kit. This lets the driver reload, if necessary.
   * @param kit The new kit
   */
  async setKit(kit: Kit, preferredGenerators: CMakeGenerator[]): Promise<void> {
    log.info(`Switching to kit: ${kit.name}`);

    const opts = this.expansionOptions;
    opts.vars.buildKit = kit.name;
    const newBinaryDir = util.lightNormalizePath(await expand.expandString(this.ws.config.buildDirectory, opts));

    const needs_clean = this.binaryDir === newBinaryDir && kitChangeNeedsClean(kit, this._kit);
    await this.doSetKit(needs_clean, async () => { await this._setKit(kit, preferredGenerators); });
  }

  private async _setKit(kit: Kit, preferredGenerators: CMakeGenerator[]): Promise<void> {
    this._kit = Object.seal({...kit});
    log.debug('CMakeDriver Kit set to', kit.name);
    this._kitEnvironmentVariables = await effectiveKitEnvironment(kit);

    if(kit.preferredGenerator)
      preferredGenerators.push( kit.preferredGenerator);

    if(preferredGenerators.length == 1) {
      this._generator = preferredGenerators[0];
    } else {
      this._generator = await this.findBestGenerator(preferredGenerators);
    }
  }

  protected abstract doSetKit(needsClean: boolean, cb: () => Promise<void>): Promise<void>;

  protected get generator () : CMakeGenerator | null {
    return this._generator;
  }
  protected _generator: CMakeGenerator | null = null;
  /**
   * The CMAKE_BUILD_TYPE to use
   */
  private _variantBuildType: string = 'Debug';

  /**
   * The arguments to pass to CMake during a configuration according to the current variant
   */
  private _variantConfigureSettings: ConfigureArguments = {};

  /**
   * Determine if we set BUILD_SHARED_LIBS to TRUE or FALSE
   */
  private _variantLinkage: ('static'|'shared'|null) = null;

  /**
   * Environment variables defined by the current variant
   */
  private _variantEnv: proc.EnvironmentVariables = {};

  /**
   * Change the current options from the variant.
   * @param opts The new options
   */
  async setVariantOptions(opts: VariantOption) {
    log.debug('Setting new variant', opts.long || '(Unnamed)');
    this._variantBuildType = opts.buildType || this._variantBuildType;
    this._variantConfigureSettings = opts.settings || this._variantConfigureSettings;
    this._variantLinkage = opts.linkage || null;
    this._variantEnv = opts.env || {};
    await this._refreshExpansions();
  }

  /**
   * Is the driver busy? ie. running a configure/build/test
   */
  get isBusy() { return this._isBusy; }
  protected _isBusy: boolean = false;

  /**
   * The source directory, where the root CMakeLists.txt lives.
   *
   * @note This is distinct from the config values, since we do variable
   * substitution.
   */
  get sourceDir(): string { return this._sourceDirectory; }
  private _sourceDirectory = '';

  protected doRefreshExpansions(cb: () => Promise<void>): Promise<void> { return cb(); }

  private async _refreshExpansions() {
    log.debug('Run _refreshExpansions');
    return this.doRefreshExpansions(async () => {
      log.debug('Run _refreshExpansions cb');
      const opts = this.expansionOptions;
      this._sourceDirectory = util.lightNormalizePath(await expand.expandString(this.ws.config.sourceDirectory, opts));
      this._binaryDir = util.lightNormalizePath(await expand.expandString(this.ws.config.buildDirectory, opts));

      const installPrefix = this.ws.config.installPrefix;
      if (installPrefix) {
        this._installDir = util.lightNormalizePath(await expand.expandString(installPrefix, opts));
      }

      const copyCompileCommands = this.ws.config.copyCompileCommands;
      if (copyCompileCommands) {
        this._copyCompileCommandsPath = util.lightNormalizePath(await expand.expandString(copyCompileCommands, opts));
      }
    });
  }

  /**
   * Path to where the root CMakeLists.txt file should be
   */
  get mainListFile(): string {
    const file = path.join(this.sourceDir, 'CMakeLists.txt');
    return util.lightNormalizePath(file);
  }

  /**
   * Directory where build output is stored.
   */
  get binaryDir(): string { return this._binaryDir; }
  private _binaryDir = '';

  /**
   * Directory where the targets will be installed.
   */
  get installDir(): string|null { return this._installDir; }
  private _installDir: string|null = null;

  /**
   * Path to copy compile_commands.json to
   */
  get copyCompileCommandsPath(): string|null { return this._copyCompileCommandsPath; }
  private _copyCompileCommandsPath: string|null = null;

  /**
   * @brief Get the path to the CMakeCache file in the build directory
   */
  get cachePath(): string {
    // TODO: Cache path can change if build dir changes at runtime
    const file = path.join(this.binaryDir, 'CMakeCache.txt');
    return util.lightNormalizePath(file);
  }

  /**
   * Get the current build type, according to the current selected variant.
   *
   * This is the value passed to CMAKE_BUILD_TYPE or --config for multiconf
   */
  get currentBuildType(): string { return this._variantBuildType; }

  get isMultiConf(): boolean { return this.generatorName ? util.isMultiConfGenerator(this.generatorName) : false; }

  /**
   * Get the name of the current CMake generator, or `null` if we have not yet
   * configured the project.
   */
  abstract get generatorName(): string|null;

  get allTargetName(): string {
    const gen = this.generatorName;
    if (gen && (gen.includes('Visual Studio') || gen.toLowerCase().includes('xcode'))) {
      return 'ALL_BUILD';
    } else {
      return 'all';
    }
  }

  /**
   * The ID of the current compiler, as best we can tell
   */
  get compilerID(): string|null {
    const entries = this.cmakeCacheEntries;
    const languages = ['CXX', 'C', 'CUDA'];
    for (const lang of languages) {
      const entry = entries.get(`CMAKE_${lang}_COMPILER`);
      if (!entry) {
        continue;
      }
      const compiler = entry.value as string;
      if (compiler.endsWith('cl.exe')) {
        return 'MSVC';
      } else if (/g(cc|\+\+)/.test(compiler)) {
        return 'GNU';
      } else if (/clang(\+\+)?[^/]*/.test(compiler)) {
        return 'Clang';
      }
    }
    return null;
  }

  get linkerID(): string|null {
    const entries = this.cmakeCacheEntries;
    const entry = entries.get('CMAKE_LINKER');
    if (!entry) {
      return null;
    }
    const linker = entry.value as string;
    if (linker.endsWith('link.exe')) {
      return 'MSVC';
    } else if (linker.endsWith('ld')) {
      return 'GNU';
    }
    return null;
  }

  private async testHaveCommand(program: string, args: string[] = ['--version']): Promise<boolean> {
    const child = this.executeCommand(program, args, undefined, {silent: true});
    try {
      const result = await child.result;
      return result.retc == 0;
    } catch (e) {
      const e2: NodeJS.ErrnoException = e;
      if (e2.code == 'ENOENT') {
        return false;
      }
      throw e;
    }
  }

  /**
   * Picks the best generator to use on the current system
   */
  async findBestGenerator(preferredGenerators: CMakeGenerator[]): Promise<CMakeGenerator|null> {
    log.debug('Trying to detect generator supported by system');
    const platform = process.platform;
    for (const gen of preferredGenerators) {
      const gen_name = gen.name;
      const generator_present = await (async(): Promise<boolean> => {
        if (gen_name == 'Ninja') {
          return await this.testHaveCommand('ninja') || this.testHaveCommand('ninja-build');
        }
        if (gen_name == 'MinGW Makefiles') {
          return platform === 'win32' && this.testHaveCommand('mingw32-make');
        }
        if (gen_name == 'NMake Makefiles') {
          return platform === 'win32' && this.testHaveCommand('nmake', ['/?']);
        }
        if (gen_name == 'Unix Makefiles') {
          return this.testHaveCommand('make');
        }
        return false;
      })();
      if (!generator_present) {
        const vsMatch = /^(Visual Studio \d{2} \d{4})($|\sWin64$|\sARM$)/.exec(gen.name);
        if (platform === 'win32' && vsMatch) {
          return {
            name: vsMatch[1],
            platform: gen.platform || vsMatch[2],
            toolset: gen.toolset,
          };
        }
        if (gen.name.toLowerCase().startsWith('xcode') && platform === 'darwin') {
          return gen;
        }
        continue;
      } else {
        return gen;
      }
    }
    return null;
  }

  async configure(extra_args: string[], consumer?: proc.OutputConsumer): Promise<number> {
    log.debug('Start configure ', extra_args);
    const pre_check_ok = await this._beforeConfigureOrBuild();
    if (!pre_check_ok) {
      return -1;
    }

    const settings = {...this.ws.config.configureSettings};

    const _makeFlag = (key: string, cmval: util.CMakeValue) => {
      switch (cmval.type) {
      case 'UNKNOWN':
        return `-D${key}=${cmval.value}`;
      default:
        return `-D${key}:${cmval.type}=${cmval.value}`;
      }
    };

    util.objectPairs(this._variantConfigureSettings).forEach(([key, value]) => settings[key] = value);
    if (this._variantLinkage !== null) {
      settings.BUILD_SHARED_LIBS = this._variantLinkage === 'shared';
    }

    // Always export so that we have compile_commands.json
    settings.CMAKE_EXPORT_COMPILE_COMMANDS = true;

    if (!this.isMultiConf) {
      // Mutliconf generators do not need the CMAKE_BUILD_TYPE property
      settings.CMAKE_BUILD_TYPE = this.currentBuildType;
    }

    // Only use the installPrefix config if the user didn't
    // provide one via configureSettings
    if (!settings.CMAKE_INSTALL_PREFIX && this.installDir) {
      await this._refreshExpansions();
      settings.CMAKE_INSTALL_PREFIX = this.installDir;
    }

    const settings_flags
        = util.objectPairs(settings).map(([key, value]) => _makeFlag(key, util.cmakeify(value as string)));
    const flags = ['--no-warn-unused-cli'].concat(extra_args, this.ws.config.configureArgs);

    console.assert(!!this._kit);
    if (!this._kit) {
      throw new Error('No kit is set!');
    }
    if (this._kit.compilers) {
      log.debug('Using compilers in', this._kit.name, 'for configure');
      flags.push(
          ...util.objectPairs(this._kit.compilers).map(([lang, comp]) => `-DCMAKE_${lang}_COMPILER:FILEPATH=${comp}`));
    }
    if (this._kit.toolchainFile) {
      log.debug('Using CMake toolchain', this._kit.name, 'for configuring');
      flags.push(`-DCMAKE_TOOLCHAIN_FILE=${this._kit.toolchainFile}`);
    }
    if (this._kit.cmakeSettings) {
      flags.push(...util.objectPairs(this._kit.cmakeSettings).map(([key, val]) => _makeFlag(key, util.cmakeify(val))));
    }

    const cache_init_conf = this.ws.config.cacheInit;
    let cache_init: string[] = [];
    if (cache_init_conf === null) {
      // Do nothing
    } else if (typeof cache_init_conf === 'string') {
      cache_init = [cache_init_conf];
    } else {
      cache_init = cache_init_conf;
    }
    for (let init of cache_init) {
      if (!path.isAbsolute(init)) {
        init = path.join(this.sourceDir, init);
      }
      flags.push('-C', init);
    }

    // Get expanded configure environment
    const expanded_configure_env = await this.getConfigureEnvironment();

    // Expand all flags
    const final_flags = flags.concat(settings_flags);
    const opts = this.expansionOptions;
    const expanded_flags_promises = final_flags.map(
        async (value: string) => expand.expandString(value, {...opts, envOverride: expanded_configure_env}));
    const expanded_flags = await Promise.all(expanded_flags_promises);
    log.trace('CMake flags are', JSON.stringify(expanded_flags));

    // Expand all important paths
    await this._refreshExpansions();

    const retc = await this.doConfigure(expanded_flags, consumer);

    return retc;
  }

  async build(target: string, consumer?: proc.OutputConsumer): Promise<number|null> {
    log.debug('Start build', target);
    const pre_build_ok = await this.doPreBuild();
    if (!pre_build_ok) {
      return -1;
    }
    const child = await this._doCMakeBuild(target, consumer);
    if (!child) {
      return -1;
    }
    const post_build_ok = await this.doPostBuild();
    if (!post_build_ok) {
      return -1;
    }
    await this._refreshExpansions();
    return (await child.result).retc;
  }

  /**
   * Execute pre-configure/build tasks to check if we are ready to run a full
   * configure. This should be called by a derived driver before any
   * configuration tasks are run
   */
  private async _beforeConfigureOrBuild(): Promise<boolean> {
    log.debug('Runnnig pre-configure checks and steps');
    if (this._isBusy) {
      if (this.ws.config.autoRestartBuild) {
        log.debug('Stopping current CMake task.');
        vscode.window.showInformationMessage('Stopping current CMake task and starting new build.');
        await this.stopCurrentProcess();
      } else {
        log.debug('No configuring: We\'re busy.');
        vscode.window.showErrorMessage('A CMake task is already running. Stop it before trying to configure.');
        return false;
      }
    }

    if (!this.sourceDir) {
      log.debug('No configuring: There is no source directory.');
      vscode.window.showErrorMessage('You do not have a source directory open');
      return false;
    }

    const cmake_list = this.mainListFile;
    if (!await fs.exists(cmake_list)) {
      log.debug('No configuring: There is no ', cmake_list);
      const do_quickstart
          = await vscode.window.showErrorMessage('You do not have a CMakeLists.txt', 'Quickstart a new CMake project');
      if (do_quickstart)
        vscode.commands.executeCommand('cmake.quickStart');
      return false;
    }

    return true;
  }

  protected abstract doConfigureSettingsChange(): void;

  /**
   * Subscribe to changes that affect the CMake configuration
   */
  private readonly _settingsSub = this.ws.config.onChange('configureSettings', () => this.doConfigureSettingsChange());
  private readonly _argsSub = this.ws.config.onChange('configureArgs', () => this.doConfigureSettingsChange());
  private readonly _envSub = this.ws.config.onChange('configureEnvironment', () => this.doConfigureSettingsChange());

  /**
   * The currently running process. We keep a handle on it so we can stop it
   * upon user request
   */
  private _currentProcess: proc.Subprocess|null = null;

  async getCMakeBuildCommand(target: string): Promise<proc.BuildCommand|null> {
    const ok = await this._beforeConfigureOrBuild();
    if (!ok) {
      return null;
    }

    const gen = this.generatorName;
    const generator_args = (() => {
      if (!gen)
        return [];
      else if (/(Unix|MinGW) Makefiles|Ninja/.test(gen) && target !== 'clean')
        return ['-j', this.ws.config.numJobs.toString()];
      else
        return [];
    })();

    const build_env = {} as {[key: string]: string};
    build_env['NINJA_STATUS'] = '[%s/%t %p :: %e] ';
    const opts = this.expansionOptions;
    await Promise.resolve(
        util.objectPairs(util.mergeEnvironment(this.ws.config.buildEnvironment, await this.getExpandedEnvironment()))
            .forEach(async ([key, value]) => build_env[key] = await expand.expandString(value, opts)));

    const args = ['--build', this.binaryDir, '--config', this.currentBuildType, '--target', target]
                     .concat(this.ws.config.buildArgs, ['--'], generator_args, this.ws.config.buildToolArgs);
    const expanded_args_promises
        = args.map(async (value: string) => expand.expandString(value, {...opts, envOverride: build_env}));
    const expanded_args = await Promise.all(expanded_args_promises) as string[];
    log.trace('CMake build args are: ', JSON.stringify(expanded_args));

    return { command: this.cmake.path, args: expanded_args, build_env };
  }

  private async _doCMakeBuild(target: string, consumer?: proc.OutputConsumer): Promise<proc.Subprocess|null> {
    const buildcmd = await this.getCMakeBuildCommand(target);
    if (buildcmd) {
      let outputEnc = this.ws.config.outputLogEncoding;
      if (outputEnc == 'auto') {
        if (process.platform === 'win32') {
          outputEnc = await codepages.getWindowsCodepage();
        } else {
          outputEnc = 'utf8';
        }
      }
      const exeOpt: proc.ExecutionOptions = {environment: buildcmd.build_env, outputEncoding: outputEnc, useTask: this.ws.config.buildTask};
      const child = this.executeCommand(buildcmd.command, buildcmd.args, consumer, exeOpt);
      this._currentProcess = child;
      this._isBusy = true;
      await child.result;
      this._isBusy = false;
      this._currentProcess = null;
      return child;
    }
    else return null;
  }

  /**
   * Stops the currently running process at user request
   */
  async stopCurrentProcess(): Promise<boolean> {
    const cur = this._currentProcess;
    if (!cur) {
      return false;
    }
    if (cur.child) await util.termProc(cur.child);
    return true;
  }

  /**
   * The CMake cache for the driver.
   *
   * Will be automatically reloaded when the file on disk changes.
   */
  abstract get cmakeCacheEntries(): Map<string, api.CacheEntryProperties>;

  private async _baseInit(kit: Kit|null, preferedGenerators: CMakeGenerator[]) {
    if (kit) {
      // Load up kit environment before starting any drivers.
      await this._setKit(kit, preferedGenerators);
    }
    await this._refreshExpansions();
    await this.doInit();
  }
  protected abstract doInit(): Promise<void>;

  /**
   * Asynchronous initialization. Should be called by base classes during
   * their initialization.
   */
  static async createDerived<T extends CMakeDriver>(inst: T, kit: Kit|null, preferedGenerators: CMakeGenerator[]): Promise<T> {
    await inst._baseInit(kit, preferedGenerators);
    return inst;
  }
}
