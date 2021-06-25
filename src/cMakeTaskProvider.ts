/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { CMakeDriver } from './drivers/driver';
import * as proc from './proc';
import * as nls from 'vscode-nls';
//import { expandStringHelper } from './expand';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

interface CMakeTaskDefinition extends vscode.TaskDefinition {
  type: string;
  label: string;
  command: string; // Command is either "build", "install", or "test".
  options?: { cwd?: string };
}

export class CMakeTask extends vscode.Task {
  detail?: string;
}

export class CMakeTaskProvider implements vscode.TaskProvider {
  static CMakeScriptType: string = 'cmake';
  static CMakeSourceStr: string = "CMake";
  static allTargetName: string = "all";
  private cmakeDriver?: CMakeDriver;
  private defaultTarget: string = CMakeTaskProvider.allTargetName;

  constructor() {
  }

  public updateCMakeDriver(cmakeDriver: CMakeDriver) {
    this.cmakeDriver = cmakeDriver;
    if (CMakeTaskProvider.allTargetName === "all") {
      CMakeTaskProvider.allTargetName = this.cmakeDriver.allTargetName;
    }
  }

  public updateDefaultTarget(defaultTarget: string | undefined) {
    this.defaultTarget = defaultTarget ? defaultTarget :
      this.cmakeDriver ? this.cmakeDriver.allTargetName : CMakeTaskProvider.allTargetName;
  }

  public async provideTasks(): Promise<CMakeTask[]> {
    // Create a CMake build task
    const result: CMakeTask[] = [];
    const taskName: string = "CMake: build";
    const definition: CMakeTaskDefinition = {
      type: CMakeTaskProvider.CMakeScriptType,
      label: taskName,
      command: "build"
    };
    const task = new vscode.Task(definition, vscode.TaskScope.Workspace, taskName, CMakeTaskProvider.CMakeSourceStr);
    task.group = vscode.TaskGroup.Build;
    task.detail = "CMake template build task";
    result.push(task);
    return result;
  }

  public async resolveTask(task: CMakeTask): Promise<CMakeTask | undefined> {
    const execution: any = task.execution;
    if (!execution) {
      const definition: CMakeTaskDefinition = <any>task.definition;
      const scope: vscode.WorkspaceFolder | vscode.TaskScope = vscode.TaskScope.Workspace;
      const resolvedTask: CMakeTask = new vscode.Task(definition, scope, definition.label, CMakeTaskProvider.CMakeSourceStr,
        new vscode.CustomExecution(async (resolvedDefinition: vscode.TaskDefinition): Promise<vscode.Pseudoterminal> =>
          new CustomBuildTaskTerminal(resolvedDefinition.command, this.defaultTarget, resolvedDefinition.options, this.cmakeDriver)
        ), []); // TODO: add problem matcher
      return resolvedTask;
    }
    return undefined;
  }
}

class CustomBuildTaskTerminal implements vscode.Pseudoterminal , proc.OutputConsumer {
  private writeEmitter = new vscode.EventEmitter<string>();
  private closeEmitter = new vscode.EventEmitter<number>();
  public get onDidWrite(): vscode.Event<string> { return this.writeEmitter.event; }
  public get onDidClose(): vscode.Event<number> { return this.closeEmitter.event; }
  private endOfLine: string = "\r\n";

  constructor(private command: string, private defaultTarget: string, private options?: { cwd?: string }, private cmakeDriver?: CMakeDriver) {
  }

  output(line: string): void {
    this.writeEmitter.fire(line + this.endOfLine);
  }

  error(error: string): void {
    this.writeEmitter.fire(error + this.endOfLine);
  }

  async open(_initialDimensions: vscode.TerminalDimensions | undefined): Promise<void> {
      // At this point we can start using the terminal.
      this.writeEmitter.fire(localize("starting.build", "Starting build...") + this.endOfLine);
      await this.doBuild();
  }

  close(): void {
      // The terminal has been closed. Shutdown the build.
  }

  private async doBuild(): Promise<any> {
    if (this.command !== "build") {
      this.writeEmitter.fire(localize("not.a.build.command", "\"{0}\" is not a recognized build command.", this.command) + this.endOfLine);
      this.closeEmitter.fire(-1);
      return;
    }
    let buildCommand: proc.BuildCommand | null;
    let cmakePath: string = "CMake.EXE";
    let args: string[] = [];

    if (this.cmakeDriver) {
      buildCommand = await this.cmakeDriver.getCMakeBuildCommand(this.defaultTarget);
      if (buildCommand) {
        cmakePath = buildCommand.command;
        args = buildCommand.args ? buildCommand.args : [];
      }
    }

    this.writeEmitter.fire(proc.buildCmdStr(cmakePath, args) + this.endOfLine);
    try {
      const result: proc.ExecutionResult = await proc.execute(cmakePath, args, this, this.options).result;
      const dot: string = ".";
      if (result.retc) {
        this.writeEmitter.fire(localize("build.finished.with.error", "Build finished with error(s)") + dot + this.endOfLine);
      } else if (result.stderr && !result.stdout) {
        this.writeEmitter.fire(localize("build.finished.with.warnings", "Build finished with warning(s)") + dot + this.endOfLine);
      } else if (result.stdout && result.stdout.includes("warning")) {
        this.writeEmitter.fire(localize("build.finished.with.warnings", "Build finished with warning(s)") + dot + this.endOfLine);
      } else {
        this.writeEmitter.fire(localize("build.finished.successfully", "Build finished successfully.") + this.endOfLine);
      }
      this.closeEmitter.fire(0);
    } catch {
      this.closeEmitter.fire(-1);
    }
  }
}
