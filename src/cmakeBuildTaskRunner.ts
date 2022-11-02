/**
 * Module for running CMake Build Task
 */ /** */

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as proc from '@cmt/proc';
import * as preset from '@cmt/preset';
import { CMakeTaskDefinition } from '@cmt/cmakeTaskProvider';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

/**
 * Class implementing Build Task Runner
 *
 */
export class CMakeBuildTaskRunner {

    private _targets?: string[];
    private _buildPreset: preset.BuildPreset | null;
    private _taskExecutor: vscode.TaskExecution | null = null;

    constructor(buildPreset: preset.BuildPreset | null, targets?: string[]) {
        this._buildPreset = buildPreset;
        this._targets = targets;
    }

    public async execute(): Promise<proc.Subprocess | null> {
        const task = await this._findBuildTask(this._buildPreset, this._targets);

        if (task) {
            this._taskExecutor = await vscode.tasks.executeTask(task);

            return { child: undefined, result: new Promise<proc.ExecutionResult>(resolve => {
                const disposable = vscode.tasks.onDidEndTask(e => {
                    if (e.execution.task.group?.id === vscode.TaskGroup.Build.id) {
                        disposable.dispose();
                        this._taskExecutor = null;
                        resolve({ retc: 0, stdout: '', stderr: '' });
                    }
                });
            }) };
        }
        return { child: undefined, result: new Promise<proc.ExecutionResult>((resolve) => {
            resolve({ retc: 0, stdout: '', stderr: '' });
        }) };
    }

    public stop(): void {
        if (this._taskExecutor) {
            this._taskExecutor.terminate();
            // TODO(PMi): clear this._taskExecutor?
        }
    }

    public getRequestedTargets(): string[] {
        if (this._taskExecutor) {
            if (this._targets) {
                return this._targets;
            }
        }
        return [];
    }

    private async _findBuildTask(buildPreset: preset.BuildPreset | null, targets?: string[]): Promise<vscode.Task | undefined> {

        // Fetch all CMake task
        const tasks = (await vscode.tasks.fetchTasks({ type: 'cmake' })).filter(task => ((task.group?.id === vscode.TaskGroup.Build.id)));

        // There is only one found - stop searching
        if (tasks.length === 1) {
            return tasks[0];
        }

        // Get only tasks which target matches to one which is requested
        let targetTasks: vscode.Task[];

        // If buildPreset set try finding task for given preset
        if (buildPreset) {
            targetTasks = tasks.filter(task =>
                (task.definition as CMakeTaskDefinition).preset === buildPreset.name);
        } else { // preset not set, filter by targets
            targetTasks = tasks.filter(task =>
                (task.definition as CMakeTaskDefinition).targets === targets);
        }

        if (targetTasks.length > 0) {
            // Only one found - just return it
            if (targetTasks.length === 1) {
                return targetTasks[0];
            } else {
                // More than one - check if there is one marked as default
                const defaultTargetTask = targetTasks.filter(task => task.group?.isDefault);
                if (defaultTargetTask.length === 1) {
                    return defaultTargetTask[0];
                }
                // None or more than one mark as default - show quick picker
                return this._showTaskQuickPick(targetTasks);
            }
        }

        // Get only tasks with no targets set (template tasks)
        const templateTasks = tasks.filter(task =>
            (task.definition as CMakeTaskDefinition).targets === undefined);

        if (templateTasks.length > 0) {
            // Only one found - just return it
            if (templateTasks.length === 1) {
                return templateTasks[0];
            } else {
                // More than one - check if there is one marked as default
                const defaultTemplateTask = templateTasks.filter(task => task.group?.isDefault);
                if (defaultTemplateTask.length === 1) {
                    return defaultTemplateTask[0];
                }
                // None or more than one mark as default - show quick picker
                return this._showTaskQuickPick(templateTasks);
            }
        }

        // No target dedicated tasks and not template tasks found - show all and let user pick
        return this._showTaskQuickPick(tasks);
    }

    private async _showTaskQuickPick(tasks: vscode.Task[]): Promise<vscode.Task | undefined> {
        interface TaskItem extends vscode.QuickPickItem {
            task: vscode.Task;
        }
        const choices = tasks.map((t): TaskItem => ({ label: t.name, task: t }));
        const sel = await vscode.window.showQuickPick(choices, { placeHolder: localize('select.build.task', 'Select build task') });
        return sel ? sel.task : undefined;
    }
}
