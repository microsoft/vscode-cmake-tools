/**
 * This module defines the external API for the extension. Other
 * extensions can access this API via the exports instance for the extension.
 *
 * Look at the `CMakeToolsAPI` interface for the actual exported API.
 *
 * Copy the `api.ts` source file into your project to use it.
 */ /** */

import {DebugSession, Disposable, Event, Terminal} from 'vscode';

/**
 * The result of executing a program.
 */
export interface ExecutionResult {
  /**
   * The return code of the program.
   */
  retc: number|null;
  /**
   * The full standard output of the program. May be `` if standard out
   * was not captured.
   */
  stdout: string;
  /**
   * Standard error output of the program. May be `` if standard error was
   * not captured
   */
  stderr: string;
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
  environment: {[key: string]: string};
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

export interface VariantKeywordSettings {
  [key: string]: string;
}

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

export type Target = NamedTarget|RichTarget;

/**
 * The CMake Tools extension API obtained via `getExtension().exports`
 */
export interface CMakeToolsAPI extends Disposable {

  /**
   * The source directory, containing the root of the project
   */
  readonly sourceDir: Thenable<string>;
  /**
   * The `CMakeLists.txt` at to the root of the project
   */
  readonly mainListFile: Thenable<string>;
  /**
   * The root build directory for the project. May change based on build
   * configuration.
   */
  readonly binaryDir: Thenable<string>;
  /**
   * The path to the `CMakeCache.txt for the project.
   */
  readonly cachePath: Thenable<string>;
  /**
   * List of CMake targets created via `add_executable()`.
   */
  readonly executableTargets: Thenable<ExecutableTarget[]>;
  /**
   * All targets available to be built
   */
  readonly targets: Thenable<Target[]>;
  /**
   * Event fired when the configure/generate stage completes
   */
  readonly onReconfigured: Event<void>;
  /**
   * Event fired when the active target changes.
   */
  readonly onTargetChanged: Event<void>;

  /**
   * Execute a command using the CMake executable.
   *
   * @param args Arguments to CMake
   * @param options Additional execution options
   * @returns The result of execution.
   */
  executeCMakeCommand(args: string[], options?: ExecutionOptions): Thenable<ExecutionResult>;
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
  execute(program: string, args: string[], options?: ExecutionOptions): Thenable<ExecutionResult>;

  /**
   * Configure the project.
   *
   * @param extraArgs Extra arguments to pass on the CMake command line
   * @returns The exit code of CMake
   */
  configure(extraArgs?: string[]): Thenable<number>;

  /**
   * Build the project
   *
   * @param target The target to build. If not provided, will build the user's
   * active build target.
   * @returns the exit code of the build command
   */
  build(target?: string): Thenable<number>;

  /**
   * Installs the project
   * @returns The exit code from CMake
   */
  install(): Thenable<number>;

  /**
   * Clean the build output. Runs the `clean` target.
   *
   * @returns The exit code from the build command
   */
  clean(): Thenable<number>;

  /**
   * Clean up old configuration and reconfigure.
   *
   * @returns The exit code from CMake
   *
   * @note This is *not* the same as running `clean`, then `configure`.
   * Cleaning up configure includes removing the CMake cache file and any
   * intermediate configuration files.
   */
  cleanConfigure(): Thenable<number>;

  /**
   * Clean the build output and rebuild
   *
   * @returns The exit code from the build command.
   */
  cleanRebuild(): Thenable<number>;

  /**
   * Execute CTest
   *
   * @returns The exit code from CTest
   */
  ctest(): Thenable<number>;

  /**
   * Stop the currently running command.
   *
   * @returns `true` on success. `false` otherwise.
   */
  stop(): Thenable<boolean>;

  /**
   * Start the active target without a debugger.
   */
  launchTarget(): Thenable<Terminal|null>;

  /**
   * Start the active target with a debugger.
   */
  debugTarget(): Thenable<DebugSession|null>;

  /**
   * Get the path to the active launch target
   */
  launchTargetPath(): Thenable<string|null>;

  /**
   * Get the directory to the active launch target
   */
  launchTargetDirectory(): Thenable<string|null>;

  /**
   * Get the filename of the active launch target
   */
  launchTargetFilename(): Thenable<string|null>;

  /**
   * Get the selected build type
   */
  currentBuildType(): Thenable<string|null>;

  /**
   * Get the build directory.
   */
  buildDirectory(): Thenable<string|null>;

  /**
   * Get the build command string for the active target
   */
  tasksBuildCommand(): Thenable<string|null>;

  /**
   * Get the build kit
   */
  buildKit(): Thenable<string|null>;
}