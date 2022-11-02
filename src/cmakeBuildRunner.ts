/**
 * Module for running CMake Build Task
 */ /** */

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as proc from '@cmt/proc';
import * as util from '@cmt/util';
import * as preset from '@cmt/preset';
import { CMakeTaskDefinition } from '@cmt/cmakeTaskProvider';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

/**
 * Class implementing Build Runner
 *
 */
export class CMakeBuildRunner {

    private _targets?: string[];
    private _buildPreset: preset.BuildPreset | null = null;
    private _taskExecutor: vscode.TaskExecution | null = null;
    private _currentBuildProcess: proc.Subprocess | null = null;
    private _buildRunning: boolean = false;

    constructor() {
        this._buildRunning = false;
    }

    public isBuildRunning(): boolean {
        return this._buildRunning;
    }

    public setBuildRunning(running: boolean): void {
        if (running) {
            this._buildRunning = true;
        } else {
            this._buildRunning = false;
            this._targets = undefined;
            this._buildPreset = null;
        }
    }

    public async execute(buildPreset: preset.BuildPreset | null, targets?: string[]): Promise<void> {
        const task = await this._findBuildTask(this._buildPreset, this._targets);

        if (task) {
            this._buildPreset = buildPreset;
            this._targets = targets;
            this._taskExecutor = await vscode.tasks.executeTask(task);

            this._currentBuildProcess =  { child: undefined, result: new Promise<proc.ExecutionResult>(resolve => {
                const disposable = vscode.tasks.onDidEndTask(e => {
                    if (e.execution.task.group?.id === vscode.TaskGroup.Build.id) {
                        disposable.dispose();
                        this._taskExecutor = null;
                        resolve({ retc: 0, stdout: '', stderr: '' });
                    }
                });
            }) };
            return;
        }
        this._currentBuildProcess = { child: undefined, result: new Promise<proc.ExecutionResult>((resolve) => {
            resolve({ retc: 0, stdout: '', stderr: '' });
        }) };
    }

    public async stop(): Promise<void> {
        const cur = this._currentBuildProcess;
        if (cur) {
            if (cur.child) {
                await util.termProc(cur.child);
            }
        }
        if (this._taskExecutor) {
            this._taskExecutor.terminate();
            this._taskExecutor = null;
        }
    }

    public async getResult(): Promise<proc.Subprocess | null> {
        await this._currentBuildProcess?.result;
        const buildProcess = this._currentBuildProcess;
        this._currentBuildProcess = null;
        return buildProcess;
    }
    public getRequestedTargets(): string[] {
        if (this._taskExecutor) {
            if (this._targets) {
                return this._targets;
            }
        }
        return [];
    }

    public setBuildProcess(buildProcess: proc.Subprocess | null = null): void {
        this._currentBuildProcess = buildProcess;
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
