import * as vscode from 'vscode';

import * as api from './api';

// This is based on the API interface, but several async members are sync here
export interface CMakeToolsBackend extends vscode.Disposable {
  readonly sourceDir: string;
  readonly mainListFile: string;
  readonly binaryDir: string;
  readonly cachePath: string;
  readonly executableTargets: api.ExecutableTarget[];
  readonly diagnostics: vscode.DiagnosticCollection;
  readonly targets: api.Target[];
  readonly reconfigured: vscode.Event<void>;
  readonly targetChanged: vscode.Event<void>;

  executeCMakeCommand(args: string[], options?: api.ExecuteOptions): Promise<api.ExecutionResult>;
  execute(program: string, args: string[], options?: api.ExecuteOptions): Promise<api.ExecutionResult>;

  compilationInfoForFile(filepath: string): Promise<api.CompilationInfo | null>;

  configure(extraArgs?: string[], runPreBuild?: boolean): Promise<number>;
  build(target?: string): Promise<number>;
  install(): Promise<number>;
  jumpToCacheFile(): Promise<vscode.TextEditor | null>;
  clean(): Promise<number>;
  cleanConfigure(): Promise<number>;
  cleanRebuild(): Promise<number>;
  buildWithTarget(): Promise<number>;
  setDefaultTarget(): Promise<void>;
  setBuildType(): Promise<number>;
  ctest(): Promise<number>;
  stop(): Promise<boolean>;
  quickStart(): Promise<number>;
  launchTarget(): Promise<void>;
  debugTarget(): Promise<void>;
  launchTargetProgramPath(): Promise<string | null>;
  selectLaunchTarget(): Promise<string | null>;
  selectEnvironments(): Promise<void>;
  setActiveVariantCombination(settings: api.VariantKeywordSettings): Promise<void>;
  toggleCoverageDecorations(): void;
}
