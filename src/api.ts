/**
 * This module defines the external API for the extension. Other
 * extensions can access this API via the exports instance for the extension.
 *
 * Look at the `CMakeToolsAPI` interface for the actual exported API.
 *
 * Copy the `api.ts` source file into your project to use it.
 */ /** */

import {DiagnosticCollection, Disposable, Event, TextEditor} from 'vscode';


/**
 * The result of executing a program.
 */
export interface ExecutionResult {
  /**
   * The return code of the program.
   */
  retc: number;
  /**
   * The full standard output of the program. May be `null` if standard out
   * was not captured.
   */
  stdout: string | null;
  /**
   * Standard error output of the program. May be `null` if standard error was
   * not captured
   */
  stderr: string | null;
}

/**
 * Options for executing a command.
 */
export interface ExecutionOptions {
  /**
   * Whether output from the command should be suppressed from CMake Tools'
   * output channel.
   */
  silent: boolean;
  /**
   * Additional environment variables to define when executing the command.
   */
  environment: {[key: string] : string};
  /**
   * Whether we should collect output from the command.
   *
   * @note All output from the command is collected into a single string, so
   * commands which emit a lot of output may consume a lot of memory if
   * `collectOutput` is set to `true`.
   */
  collectOutput?: boolean;
  /**
   * The working directory for the command. The default directory is
   * unspecified.
   */
  workingDirectory?: string;
}

/**
 * Raw, unprocessed compilation information on a source file. This is what
 * would be found in a compilation database, `compile_commands.json`.
 */
export interface RawCompilationInfo {
  file: string;
  directory: string;
  command: string;
}

/**
 * Nicer, cleaner compilation information on a source file. This would be
 * provided by CMake Server.
 */
export interface CompilationInfo {
  file: string;
  compile?: RawCompilationInfo;
  includeDirectories: {path : string; isSystem : boolean;}[];
  compileDefinitions: {[define: string] : string | null};
  compileFlags: string[];
  compiler?: string;
}

/**
 * The type of a CMake cache entry
 */
export enum CacheEntryType {
  Bool = 0,
  String = 1,
  Path = 2,
  FilePath = 3,
  Internal = 4,
  Uninitialized = 5,
  Static = 6,
}

/**
 * Information about a CTest test
 */
export interface Test {
  id: number;
  name: string;
}

/**
 * The properties of a CMake cache entry.
 */
export interface CacheEntryProperties {
  type: CacheEntryType;
  helpString: string;
  /** The name of the cache entry */
  key: string;
  /** The entry's value. Type depends on `type`. */
  value: any;
  /** Whether this entry is ADVANCED, meaning it hidden from the user. */
  advanced: boolean;
}

/**
 * A cache entry from a CMake cache.
 */
export interface CacheEntry extends CacheEntryProperties {
  /**
   * Return the value as a `T` instance. Does no actual conversion. It's up to
   * you to check the value of `CacheEntryProperties.type`.
   */
  as<T>(): T;
}

/**
 * Description of an executable CMake target, defined via `add_executable()`.
 */
export interface ExecutableTarget {
  /**
   * The name of the target.
   */
  name: string;
  /**
   * The absolute path to the build output.
   */
  path: string;
}

export interface VariantKeywordSettings { [key: string]: string; }

/**
 * A target with a name, but no output. This may be created via `add_custom_command()`.
 */
export interface NamedTarget {
  type: 'named';
  name: string;
}

/**
 * A target with a name, path, and type.
 */
export interface RichTarget {
  type: 'rich';
  name: string;
  filepath: string;
  targetType: string;
}

export type Target = NamedTarget | RichTarget;

/**
 * The CMake Tools extension API obtained via `getExtension().exports`
 */
export interface CMakeToolsAPI extends Disposable {
  constructor(): never;
  /**
   * The source directory, containing the root of the project
   */
  readonly sourceDir: Promise<string>;
  /**
   * The `CMakeLists.txt` at to the root of the project
   */
  readonly mainListFile: Promise<string>;
  /**
   * The root build directory for the project. May change based on build
   * configuration.
   */
  readonly binaryDir: Promise<string>;
  /**
   * The path to the `CMakeCache.txt for the project.
   */
  readonly cachePath: Promise<string>;
  /**
   * List of CMake targets created via `add_executable()`.
   */
  readonly executableTargets: Promise<ExecutableTarget[]>;
  /**
   * CMake code diagnostics. Includes warnings and errors, etc.
   */
  readonly diagnostics: Promise<DiagnosticCollection>;
  /**
   * All targets available to be built
   */
  readonly targets: Promise<Target[]>;
  /**
   * Event fired when the configure/generate stage completes
   */
  readonly reconfigured: Event<void>;
  /**
   * Event fired when the active target changes.
   */
  readonly targetChangedEvent: Event<void>;

  /**
   * Execute a command using the CMake executable.
   *
   * @param args Arguments to CMake
   * @param options Additional execution options
   * @returns The result of execution.
   */
  executeCMakeCommand(args: string[], options?: ExecutionOptions): Promise<ExecutionResult>;
  // Execute an arbitrary program in the active environments
  /**
   * Execute an arbitrary program.
   *
   * @param program Path to an executable binary
   * @param args List of command-line arguments to the program
   * @param options Additional execution options
   * @returns The result of execution
   *
   * ## Why you should use this API:
   *
   * You can execute a program on your own, but if it requires access to
   * environment variables that CMake Tools knows about, such as Visual C++
   * environment variables, this is the most reliable way to ensure that you
   * execute in the context that the user is expecting.
   */
  execute(program: string, args: string[], options?: ExecutionOptions): Promise<ExecutionResult>;

  /**
   * Get the compilation information for a file
   *
   * @param filepath The source file in question
   * @returns New compilation info, or `null` if no compilation info was found
   * for the named file.
   */
  compilationInfoForFile(filepath: string): Promise<CompilationInfo | null>;

  /**
   * Configure the project.
   *
   * @param extraArgs Extra arguments to pass on the CMake command line
   * @param runPreBuild Run any pre-build/configure tasks
   * @returns The exit code of CMake
   */
  configure(extraArgs?: string[], runPreBuild?: boolean): Promise<number>;

  /**
   * Build the project
   *
   * @param target The target to build. If not provided, will build the user's
   * active build target.
   * @returns the exit code of the build command
   */
  build(target?: string): Promise<number>;

  /**
   * Installs the project
   * @returns The exit code from CMake
   */
  install(): Promise<number>;

  /**
   * Open a text editor to the CMake cache file.
   *
   * @returns A new text editor, or `null` if the file could not be opened.
   */

  jumpToCacheFile(): Promise<TextEditor | null>;

  /**
   * Clean the build output. Runs the `clean` target.
   *
   * @returns The exit code from the build command
   */
  clean(): Promise<number>;

  /**
   * Clean up old configuration and reconfigure.
   *
   * @returns The exit code from CMake
   *
   * @note This is *not* the same as running `clean`, then `configure`.
   * Cleaning up configure includes removing the CMake cache file and any
   * intermediate configuration files.
   */
  // Remove cached build settings and rerun the configuration
  cleanConfigure(): Promise<number>;

  /**
   * Clean the build output and rebuild
   *
   * @returns The exit code from the build command.
   */
  cleanRebuild(): Promise<number>;

  /**
   * Asks the user to select a target, then builds that target.
   *
   * @returns The exit code from the build command.
   */
  buildWithTarget(): Promise<number>;

  /**
   * Open up a QuickPick where the user can select a target to build.
   */
  setDefaultTarget(): Promise<void>;

  /**
   * Set the new build type.
   *
   * @returns The exit code from running CMake configure
   */
  setBuildType(): Promise<number>;

  /**
   * Execute CTest
   *
   * @returns The exit code from CTest
   */
  ctest(): Promise<number>;

  /**
   * Stop the currently running command.
   *
   * @returns `true` on success. `false` otherwise.
   */
  stop(): Promise<boolean>;

  /**
   * Run the CMake project quickstart.
   *
   * @returns The exit code from running CMake configure
   */
  quickStart(): Promise<number>;

  /**
   * Start the active target without a debugger.
   */
  launchTarget(): Promise<void>;

  /**
   * Start the active target with a debugger.
   */
  debugTarget(): Promise<void>;

  /**
   * Get the path to the active launch target
   */
  launchTargetProgramPath(): Promise<string | null>;

  /**
   * Show a QuickPick to select a new target to launch.
   */
  selectLaunchTarget(): Promise<string | null>;

  /**
   * Show a QuickPick to select a build environment
   */
  selectEnvironments(): Promise<void>;

  /**
   * Select the active variant combination
   */
  setActiveVariantCombination(settings: VariantKeywordSettings): Promise<void>;

  /**
   * Toggle test coverage decorations
   */
  toggleCoverageDecorations(): void;
}