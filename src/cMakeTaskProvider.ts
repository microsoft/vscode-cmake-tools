/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {
  TaskDefinition, Task, TaskGroup, TaskProvider, TaskScope, CustomExecution, WorkspaceFolder, Pseudoterminal, EventEmitter, Event, TerminalDimensions, window, TextEditor
} from 'vscode';
import * as cp from "child_process";
import { CMakeDriver } from './drivers/driver';
import { BuildCommand } from './proc';
import * as nls from 'vscode-nls';
import path = require('path');

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

interface CMakeTaskDefinition extends TaskDefinition {
  type: string;
  label: string;
  command: string; // Command is either "build" or "install".
  args?: string[];
  options?: cp.ExecOptions | undefined;
}

export class CMakeTask extends Task {
  detail?: string;
}

export class CMakeTaskProvider implements TaskProvider {
  static CMakeScriptType: string = 'cmake';
  static CMakeSourceStr: string = "CMake";
  private cmakeDriver: CMakeDriver | undefined;

  constructor() {
  }

  public updateCMakeDriver(cmakeDriver: CMakeDriver | undefined) {
    this.cmakeDriver = cmakeDriver;
  }

  public async provideTasks(): Promise<CMakeTask[]> {
    const emptyTasks: CMakeTask[] = [];
    const editor: TextEditor | undefined = window.activeTextEditor;
    if (!editor) {
        return emptyTasks;
    }

    // Create one CMake build task with target set to "all"
    const result: CMakeTask[] = [];
    const taskName: string = "CMake: build";
    /*let buildCommand: BuildCommand | null;
    let cmakePath: string = "CMake.EXE";
    let args: string[] | undefined = [];
    if (this.cmakeDriver) {
      buildCommand = await this.cmakeDriver.getCMakeBuildCommand(this.defaultBuildTarget || CMakeTaskProvider.allTargetName);
      if (buildCommand) {
        cmakePath = buildCommand.command;
        args = buildCommand.args;
      }
    }*/
    const definition: CMakeTaskDefinition = {
      type: CMakeTaskProvider.CMakeScriptType,
      label: taskName,
      command: "build",
      target: "all"
    };
    const task = new Task(definition, TaskScope.Workspace, taskName, CMakeTaskProvider.CMakeSourceStr);
    task.group = TaskGroup.Build;
    task.detail = "CMake build task, with build target set to \"all\".";
    result.push(task);
    return result;
  }

  public resolveTask(_task: CMakeTask): CMakeTask | undefined {
    const execution: any = _task.execution;
    if (!execution) {
        const definition: CMakeTaskDefinition = <any>_task.definition;
        const scope: WorkspaceFolder | TaskScope = TaskScope.Workspace;
        const task: CMakeTask = new Task(definition, scope, definition.label, CMakeTaskProvider.CMakeSourceStr,
            new CustomExecution(async (resolvedDefinition: TaskDefinition): Promise<Pseudoterminal> =>
              new CustomBuildTaskTerminal(resolvedDefinition.command, resolvedDefinition.target, this.cmakeDriver)
            ), []); // TODO: add problem matcher
        return task;
    }
    return undefined;
  }

}

class CustomBuildTaskTerminal implements Pseudoterminal {
  private writeEmitter = new EventEmitter<string>();
  private closeEmitter = new EventEmitter<number>();
  public get onDidWrite(): Event<string> { return this.writeEmitter.event; }
  public get onDidClose(): Event<number> { return this.closeEmitter.event; }
  private endOfLine: string = "\r\n";

  constructor(private command: string, private target: string | null, private cmakeDriver: CMakeDriver | undefined) {
  }

  async open(_initialDimensions: TerminalDimensions | undefined): Promise<void> {
      // At this point we can start using the terminal.
      this.writeEmitter.fire(localize("starting_build", "Starting build...") + this.endOfLine);
      await this.doBuild();
  }

  close(): void {
      // The terminal has been closed. Shutdown the build.
  }

  private async doBuild(): Promise<any> {
    if (this.command !== "build") {
      this.writeEmitter.fire(localize("not_a_build_command", "Not a recognized build command.") + this.endOfLine);
    }
    let buildCommand: BuildCommand | null;
    let cmakePath: string = "CMake.EXE";
    let args: string[] | undefined = [];

    // TODO: change the target from "all" to the default received from cmakedriver.
    const defaultBuildTarget: string = this.target ? this.target : "all";
    if (this.cmakeDriver) {
      buildCommand = await this.cmakeDriver.getCMakeBuildCommand(defaultBuildTarget);
      if (buildCommand) {
        cmakePath = buildCommand.command;
        args = buildCommand.args;
      }
    }
    // TODO: find the correct cwd
    const cwd: string = path.dirname(cmakePath) ? path.dirname(cmakePath) : path.dirname(defaultBuildTarget);
    const options: cp.ExecOptions | undefined = { cwd: cwd };
    let activeCommand: string = cmakePath.includes(" ") ? ("\"" + cmakePath + "\"") : cmakePath;
    if (args) {
      args.forEach(value => {
        if (value.includes(" ")) {
          value = "\"" + value + "\"";
        }
        activeCommand = activeCommand + " " + value;
      });
    }

    const splitWriteEmitter = (lines: string | Buffer) => {
      for (const line of lines.toString().split(/\r?\n/g)) {
        this.writeEmitter.fire(line + this.endOfLine);
      }
    };
    this.writeEmitter.fire(activeCommand + this.endOfLine);
    try {
      const result: number = await new Promise<number>((resolve) => {
        cp.exec(activeCommand, options, (_error, stdout, _stderr) => {
          const dot: string = ".";
          if (_stderr) {
            splitWriteEmitter(_stderr);
          }
          splitWriteEmitter(stdout);
          if (_error) {
            if (stdout) {
            } else if (_stderr) {
              splitWriteEmitter(_stderr);
            } else {
              splitWriteEmitter(_error.message);
            }
            this.writeEmitter.fire(localize("build_finished_with_error", "Build finished with error(s)") + dot + this.endOfLine);
            resolve(0);
          } else if (_stderr && !stdout) {
            splitWriteEmitter(_stderr);
            this.writeEmitter.fire(localize("build_finished_with_warnings", "Build finished with warning(s)") + dot + this.endOfLine);
          } else if (stdout && stdout.includes("warning")) {
            this.writeEmitter.fire(localize("build_finished_with_warnings", "Build finished with warning(s)") + dot + this.endOfLine);
          } else {
            this.writeEmitter.fire(localize("build finished successfully", "Build finished successfully.") + this.endOfLine);
          }
          resolve(0);
        });
      });
      this.closeEmitter.fire(result);
    } catch {
      this.closeEmitter.fire(-1);
    }
  }
}
