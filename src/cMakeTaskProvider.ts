/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {
  TaskDefinition, Task, TaskGroup, workspace,
  TaskProvider, TaskScope, CustomExecution, WorkspaceFolder, Pseudoterminal, EventEmitter, Event, TerminalDimensions, window, TextEditor
} from 'vscode';
import {isString} from './util';
import * as cp from "child_process";
import * as path from 'path';


type TaskCommands = Record<string, string | string[] | null>;

interface CMakeTaskDefinition extends TaskDefinition {
  type: string;
  label: string;
  command: string; // command include args
  //args: string[];
  options?: cp.ExecOptions | undefined;
}

export class cMakeTask extends Task {
  detail?: string;
}


export class CMakeTaskProvider implements TaskProvider {
  static CMakeScriptType: string = 'cmake';
  static CMakeSourceStr: string = "CMake";
  static target: string | undefined;
  static driverBuildArgs: string | null;

  constructor() {
  }

  public static setTarget(target: string) {
    this.target = target;
  }

  public static setDriverBuildArgs(driverBuildArgs: string | null) {
    this.driverBuildArgs = driverBuildArgs;
  }

  public async provideTasks(): Promise<cMakeTask[]> {
    const emptyTasks: cMakeTask[] = [];
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
    // Create one CMake build task
    let result: cMakeTask[] = [];
    let taskName: string = "CMake build";
    const definition: CMakeTaskDefinition = {
      type: CMakeTaskProvider.CMakeScriptType,
      label: taskName,
      command: "build",
      detail: "Cmake build task template"
    };
    const task = new Task(definition, TaskScope.Workspace, taskName, CMakeTaskProvider.CMakeSourceStr);
    task.group = TaskGroup.Build;
    result.push(task);
    return result;
  }

  public resolveTask(_task: cMakeTask): cMakeTask | undefined {
    const execution: any = _task.execution;
    if (!execution) {
        const definition: CMakeTaskDefinition = <any>_task.definition;
        const scope: WorkspaceFolder | TaskScope = TaskScope.Workspace;
        const task: cMakeTask = new Task(definition, scope, definition.label, CMakeTaskProvider.CMakeSourceStr,
            new CustomExecution(async (resolvedDefinition: TaskDefinition): Promise<Pseudoterminal> =>
              new CustomBuildTaskTerminal(resolvedDefinition.command, resolvedDefinition.options)
            ), []); // TODO: add problem matcher
        return task;
    }
    return undefined;
  }

  private async getTasks(taskCommands: TaskCommands): Promise<cMakeTask[]> {
    const workspaceFolders = workspace.workspaceFolders;
    const result: cMakeTask[] = [];
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return result;
    }

    for (const command in taskCommands) {
      if (isString(command[1])) {
        const definition: CMakeTaskDefinition = {
          type: CMakeTaskProvider.CMakeScriptType,
          label: command[0],
          command: command[0]
        };
        const task = new Task(definition, TaskScope.Workspace, command[0], CMakeTaskProvider.CMakeScriptType);
        task.group = TaskGroup.Build;
        result.push(task);
      }
    }

    return result;
  }

  private getTask(taskCommand: string): cMakeTask {
    const definition: CMakeTaskDefinition = {
      type: CMakeTaskProvider.CMakeScriptType,
      label: taskCommand,
      command: taskCommand
    };
    const scope: WorkspaceFolder | TaskScope = TaskScope.Workspace;
    const task: cMakeTask = new Task(definition, scope, definition.label, CMakeTaskProvider.CMakeSourceStr,
        new CustomExecution(async (resolvedDefinition: TaskDefinition): Promise<Pseudoterminal> =>
            // When the task is executed, this callback will run. Here, we setup for running the task.
            new CustomBuildTaskTerminal(resolvedDefinition.command, resolvedDefinition.options)
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

  constructor(private command: string, private options: cp.ExecOptions | undefined) {
  }

  async open(_initialDimensions: TerminalDimensions | undefined): Promise<void> {
      // At this point we can start using the terminal.
      await this.doBuild();
  }

  close(): void {
      // The terminal has been closed. Shutdown the build.
  }

  private async doBuild(): Promise<any> {
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


