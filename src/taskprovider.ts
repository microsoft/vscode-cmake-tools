/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { isString } from 'util';

type TaskCommands = Record<string, string | string[] | null>;
interface CMakeTaskDefinition extends vscode.TaskDefinition {
  command: string;
}

export class CMakeTaskProvider implements vscode.TaskProvider {
  static CMakeType = 'cmake';
  private cmakePromise: Thenable<vscode.Task[]> | undefined = undefined;

  constructor(readonly taskCommands: TaskCommands) {
  }

  public provideTasks(): Thenable<vscode.Task[]> | undefined {
    if (!this.cmakePromise) {
      this.cmakePromise = getCMakeTasks(this.taskCommands);
    }
    return this.cmakePromise;
  }

  public resolveTask(_task: vscode.Task): vscode.Task | undefined {
    const shellCommand = this.taskCommands[_task.definition.command];
    if (shellCommand) {
      if (isString(shellCommand)) {
        return new vscode.Task(
          _task.definition,
          _task.definition.command,
          CMakeTaskProvider.CMakeType,
          new vscode.ShellExecution(shellCommand)
        );
      }
    }
    return undefined;
  }

}

async function getCMakeTasks(taskCommands: TaskCommands): Promise<vscode.Task[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const result: vscode.Task[] = [];
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return result;
  }

  for (const command in taskCommands) {
    if (isString(command[1])) {
      const definition: CMakeTaskDefinition = {
        type: CMakeTaskProvider.CMakeType,
        command: command[0]
      };
      const task = new vscode.Task(definition, vscode.TaskScope.Workspace, command[0], CMakeTaskProvider.CMakeType);
      task.group = vscode.TaskGroup.Build;
      result.push(task);
    }
  }

  return result;
}