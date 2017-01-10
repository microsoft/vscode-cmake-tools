import {DiagnosticCollection, Disposable, TextEditor} from 'vscode';

export interface ExecutionResult {
  retc: number;
  stdout: string|null;
  stderr: string|null;
}

export interface ExecuteOptions {
  silent: boolean;
  environment: Object;
  collectOutput?: boolean;
  workingDirectory?: string;
}

export interface RawCompilationInfo {
  file: string;
  directory: string;
  command: string;
}

export interface CompilationInfo {
  file: string;
  compile?: RawCompilationInfo;
  includeDirectories: {
    path: string;
    isSystem: boolean;
  }[];
  compileDefinitions: {[define: string]: string|null};
  compileFlags: string[];
  compiler?: string;
}

export enum EntryType {
  Bool,
  String,
  Path,
  FilePath,
  Internal,
  Uninitialized,
  Static,
}

export interface Test {
  id: number;
  name: string;
}

export interface CacheEntry {
  type: EntryType;
  helpString: string;
  key: string;
  value: any;
  as<T>(): T;
  advanced: boolean;
}

export interface ExecutableTarget {
  name: string;
  path: string;
}

export interface VariantKeywordSettings { [key: string]: string; }

export interface NamedTarget {
  type: 'named';
  name: string;
}

export interface RichTarget {
  type: 'rich';
  name: string;
  filepath: string;
  targetType: string;
}

export type Target = NamedTarget | RichTarget

export interface CMakeToolsAPI extends Disposable {
  // Get the root source directory
  readonly sourceDir: Promise<string>|string;
  // Get the main CMake File
  readonly mainListFile: Promise<string>|string;
  // Get the binary directory for the project
  readonly binaryDir: Promise<string>|string;
  // Get the path to the CMake cache
  readonly cachePath: Promise<string>|string;
  // Targets which are executable
  readonly executableTargets: Promise<ExecutableTarget[]>|ExecutableTarget[];
  // Diagnostics obtained from configure/build
  readonly diagnostics: Promise<DiagnosticCollection>|DiagnosticCollection;
  // Targets available for building
  readonly targets: Promise<Target[]>|Target[];

  // Execute a command using the CMake executable
  executeCMakeCommand(args: string[], options?: ExecuteOptions):
      Promise<ExecutionResult>;
  // Execute an arbitrary program in the active environments
  execute(program: string, args: string[], options?: ExecuteOptions):
      Promise<ExecutionResult>;

  // Get the compilation information for a file
  compilationInfoForFile(filepath: string): Promise<CompilationInfo|null>;

  // Configure the project. Returns the return code from CMake.
  configure(extraArgs?: string[], runPreBuild?: boolean): Promise<number>;
  // Build the project. Returns the return code from the build
  build(target?: string): Promise<number>;
  // Install the project. Returns the return code from CMake
  install(): Promise<number>;
  // Open the CMake Cache file in a text editor
  jumpToCacheFile(): Promise<TextEditor|null>;
  // Clean the build output
  clean(): Promise<number>;
  // Remove cached build settings and rerun the configuration
  cleanConfigure(): Promise<number>;
  // Clean the build output and rebuild
  cleanRebuild(): Promise<number>;
  // Build a target selected by the user
  buildWithTarget(): Promise<number|null>;
  // Show a selector for the user to set the default build target
  setDefaultTarget(): Promise<string|null>;
  // Set the active build variant
  setBuildType(): Promise<number>;
  // Execute CTest
  ctest(): Promise<number>;
  // Stop the currently running build/configure/test/install process
  stop(): Promise<boolean>;
  // Show a quickstart
  quickStart(): Promise<number|null>;
  // Start the debugger with the selected build target
  debugTarget(): Promise<void>;
  // Allow the user to select target to debug
  selectDebugTarget(): Promise<string|null>;
  // Show the environment selection quickpick
  selectEnvironments(): Promise<string[]|null>;
  // Sets the variant based on keyword settings
  setActiveVariantCombination(settings: VariantKeywordSettings): Promise<void>;
}