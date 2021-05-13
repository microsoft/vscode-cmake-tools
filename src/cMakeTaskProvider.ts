/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {
  TaskDefinition, Task, TaskGroup, TaskProvider, TaskScope, CustomExecution, WorkspaceFolder, Pseudoterminal, EventEmitter, Event, TerminalDimensions, window, TextEditor
} from 'vscode';
import * as cp from "child_process";
import * as path from 'path';
import { CMakeDriver } from './drivers/driver';
import { BuildCommand } from './proc';


interface CMakeTaskDefinition extends TaskDefinition {
  type: string;
  label: string;
  command: string; // command include args
  args: string[];
  options?: cp.ExecOptions | undefined;
}

export class cmakeTask extends Task {
  detail?: string;
}


export class CMakeTaskProvider implements TaskProvider {
  static CMakeScriptType: string = 'cmake';
  static CMakeSourceStr: string = "CMake";
  static defaultTargetStr: string = "all";//"${defaultTarget}";
  static cmakeDriver: CMakeDriver | undefined;
  private defaultTarget: string | undefined;

  constructor() {
  }

  public static updateCMakeDriver(cmakeDriver: CMakeDriver | undefined) {
    this.cmakeDriver = cmakeDriver;
  }

  public updateDefaultTarget(defaultTarget: string | undefined) {
    this.defaultTarget = defaultTarget;
  }

  public async provideTasks(): Promise<cmakeTask[]> {
    const emptyTasks: cmakeTask[] = [];
    const editor: TextEditor | undefined = window.activeTextEditor;
    if (!editor) {
        return emptyTasks;
    }

    const fileExt: string = path.extname(editor.document.fileName);
    if (!fileExt) {
        return emptyTasks;
    }

    // Don't offer tasks for header files.
    const fileExtLower: string = fileExt.toLowerCase();
    const isHeader: boolean = !fileExt || [".cuh", ".hpp", ".hh", ".hxx", ".h++", ".hp", ".h", ".ii", ".inl", ".idl", ""].some(ext => fileExtLower === ext);
    if (isHeader) {
        return emptyTasks;
    }

    // Don't offer tasks if the active file's extension is not a recognized C/C++ extension.
    let fileIsCpp: boolean;
    let fileIsC: boolean;
    if (fileExt === ".C") { // ".C" file extensions are both C and C++.
        fileIsCpp = true;
        fileIsC = true;
    } else {
        fileIsCpp = [".cu", ".cpp", ".cc", ".cxx", ".c++", ".cp", ".ino", ".ipp", ".tcc"].some(ext => fileExtLower === ext);
        fileIsC = fileExtLower === ".c";
    }
    if (!(fileIsCpp || fileIsC)) {
        return emptyTasks;
    }
    // Create one CMake build task with target set to "all"
    let result: cmakeTask[] = [];
    let taskName: string = "CMake build";
    let buildCommand: BuildCommand | null = CMakeTaskProvider.cmakeDriver ? await CMakeTaskProvider.cmakeDriver.getCMakeBuildCommand(CMakeTaskProvider.defaultTargetStr) : null;
    let args: string[] = (buildCommand && buildCommand.args) ? buildCommand.args : [];
    const definition: CMakeTaskDefinition = {
      type: CMakeTaskProvider.CMakeScriptType,
      label: taskName,
      command: "build",
      args: args
    };
    const task = new Task(definition, TaskScope.Workspace, taskName, CMakeTaskProvider.CMakeSourceStr);
    task.group = TaskGroup.Build;
    task.detail = "Cmake build task template";
    result.push(task);
    return result;
  }

  public resolveTask(_task: cmakeTask): cmakeTask | undefined {
    const execution: any = _task.execution;
    if (!execution) {
        const definition: CMakeTaskDefinition = <any>_task.definition;
        const scope: WorkspaceFolder | TaskScope = TaskScope.Workspace;
        const task: cmakeTask = new Task(definition, scope, definition.label, CMakeTaskProvider.CMakeSourceStr,
            new CustomExecution(async (resolvedDefinition: TaskDefinition): Promise<Pseudoterminal> =>
              new CustomBuildTaskTerminal(resolvedDefinition.command, resolvedDefinition.args, resolvedDefinition.options)
            ), []); // TODO: add problem matcher
        return task;
    }
    return undefined;
  }

  private getTask(taskCommand: string): cmakeTask {
    const definition: CMakeTaskDefinition = {
      type: CMakeTaskProvider.CMakeScriptType,
      label: taskCommand,
      command: taskCommand,
      args: []
    };
    const scope: WorkspaceFolder | TaskScope = TaskScope.Workspace;
    const task: cmakeTask = new Task(definition, scope, definition.label, CMakeTaskProvider.CMakeSourceStr,
        new CustomExecution(async (resolvedDefinition: TaskDefinition): Promise<Pseudoterminal> =>
            // When the task is executed, this callback will run. Here, we setup for running the task.
            new CustomBuildTaskTerminal(resolvedDefinition.command, resolvedDefinition.args, resolvedDefinition.options)
        )); // TODO: add problem matcher
    return task;
  }
}

class CustomBuildTaskTerminal implements Pseudoterminal {
  private writeEmitter = new EventEmitter<string>();
  private closeEmitter = new EventEmitter<number>();
  public get onDidWrite(): Event<string> { return this.writeEmitter.event; }
  public get onDidClose(): Event<number> { return this.closeEmitter.event; }
  private endOfLine: string = "\r\n";

  constructor(private command: string, private args: string[], private options: cp.ExecOptions | undefined) {
  }

  async open(_initialDimensions: TerminalDimensions | undefined): Promise<void> {
      // At this point we can start using the terminal.
      await this.doBuild();
  }

  close(): void {
      // The terminal has been closed. Shutdown the build.
  }

  private async doBuild(): Promise<any> {
    let activeCommand: string = this.command;
    this.args.forEach(value => {
        if (value.includes(" ")) {
          value = "\"" + value + "\"";
        }
        activeCommand = activeCommand + " " + value;
    });
      const splitWriteEmitter = (lines: string | Buffer) => {
          for (const line of lines.toString().split(/\r?\n/g)) {
              this.writeEmitter.fire(line + this.endOfLine);
          }
      };
      this.writeEmitter.fire(this.command + this.endOfLine);
      try {
          const result: number = await new Promise<number>((resolve) => {
              cp.exec(this.command, this.options, (_error, stdout, _stderr) => {
                  splitWriteEmitter(stdout); // linker header info and potentially compiler C warnings
                  if (_error) {
                      splitWriteEmitter(_stderr); // gcc/clang
                      resolve(-1);
                  } else if (_stderr && !stdout) {
                      splitWriteEmitter(_stderr);
                      resolve(0);
                  }
              });
          });
          this.closeEmitter.fire(result);
      } catch {
          this.closeEmitter.fire(-1);
      }
  }
}


