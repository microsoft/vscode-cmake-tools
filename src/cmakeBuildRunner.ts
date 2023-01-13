/**
 * Module for running CMake Build Task
 */

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as proc from '@cmt/proc';
import * as util from '@cmt/util';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();

export class CMakeBuildRunner {

    private taskExecutor: vscode.TaskExecution | undefined;
    private currentBuildProcess: proc.Subprocess | undefined;
    private buildInProgress: boolean = false;

    constructor() {
        this.buildInProgress = false;
    }

    public isBuildInProgress(): boolean {
        return this.buildInProgress;
    }

    public setBuildInProgress(buildInProgress: boolean): void {
        this.buildInProgress = buildInProgress;
    }

    public setBuildProcess(buildProcess: proc.Subprocess): void {
        this.currentBuildProcess = buildProcess;
        this.setBuildInProgress(true);
    }

    public async setBuildProcessForTask(taskExecutor: vscode.TaskExecution): Promise<void> {
        this.taskExecutor = taskExecutor;
        this.currentBuildProcess =  { child: undefined, result: new Promise<proc.ExecutionResult>(resolve => {
            const disposable: vscode.Disposable = vscode.tasks.onDidEndTask((endEvent: vscode.TaskEndEvent) => {
                if (endEvent.execution === this.taskExecutor) {
                    this.taskExecutor = undefined;
                    disposable.dispose();
                    resolve({ retc: 0, stdout: '', stderr: '' });
                }
            });
        })};
        this.setBuildInProgress(true);
    }

    public async stop(): Promise<void> {
        if (this.currentBuildProcess && this.currentBuildProcess.child) {
            await util.termProc(this.currentBuildProcess.child);
            this.currentBuildProcess = undefined;
        }
        if (this.taskExecutor) {
            this.taskExecutor.terminate();
        }
        this.setBuildInProgress(false);
    }

    public async getResult(): Promise<proc.Subprocess | undefined> {
        await this.currentBuildProcess?.result;
        const buildProcess = this.currentBuildProcess;
        this.currentBuildProcess = undefined;
        return buildProcess;
    }

}
