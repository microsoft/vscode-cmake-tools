/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

export class CMakeTaskProvider implements vscode.TaskProvider {
  static CMakeType = 'cmake';
  private cmakePromise: Thenable<vscode.Task[]> | undefined = undefined;

  constructor() {
  }

  public provideTasks(): Thenable<vscode.Task[]> | undefined {
    if (!this.cmakePromise) {
      this.cmakePromise = getCMakeTasks();
    }
    return this.cmakePromise;
  }

  public resolveTask(_task: vscode.Task): vscode.Task | undefined {
    const task = _task.definition.task;
    if (task) {
      return new vscode.Task(
        _task.definition,
        task,
        CMakeTaskProvider.CMakeType,
        new vscode.ShellExecution("${command:cmake." + `${task}` + "}")
      );
    }
    return undefined;
  }
}

interface CMakeTaskDefinition extends vscode.TaskDefinition {
  command: string;
}

const taskNames: string[] = ['build', 'configure'];

async function getCMakeTasks(): Promise<vscode.Task[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const result: vscode.Task[] = [];
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return result;
  }

  for (const taskName of taskNames) {
    const kind: CMakeTaskDefinition = {
      type: CMakeTaskProvider.CMakeType,
      command: taskName
    };
    const task = new vscode.Task(kind, vscode.TaskScope.Workspace, taskName, CMakeTaskProvider.CMakeType);
    task.group = vscode.TaskGroup.Build;
    result.push(task);
  }

  return result;
}