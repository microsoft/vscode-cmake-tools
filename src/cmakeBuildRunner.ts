/**
 * Module for running CMake Build Task
 */

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as proc from '@cmt/proc';
import * as util from '@cmt/util';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();

export class CMakeBuildRunner {

    private taskExecutor: vscode.TaskExecution | null = null;
    private currentBuildProcess: proc.Subprocess | null = null;
    private isBuildInProgress: boolean = false;

    constructor() {
        this.isBuildInProgress = false;
    }

    public buildInProgress(): boolean {
        return this.isBuildInProgress;
    }

    public setBuildInProgress(running: boolean): void {
        if (running) {
            this.isBuildInProgress = true;
        } else {
            this.isBuildInProgress = false;
        }
    }

    public async setBuildProcessForTask(taskExecutor: vscode.TaskExecution): Promise<void> {
        this.taskExecutor = taskExecutor;
        this.currentBuildProcess =  { child: undefined, result: new Promise<proc.ExecutionResult>(resolve => {
            const disposable: vscode.Disposable = vscode.tasks.onDidEndTask((endEvent: vscode.TaskEndEvent) => {
                if (endEvent.execution === this.taskExecutor) {
                    disposable.dispose();
                    resolve({ retc: 0, stdout: '', stderr: '' });
                }
            });
        })};
    }

    public async stop(): Promise<void> {
        const cur = this.currentBuildProcess;
        if (cur) {
            if (cur.child) {
                await util.termProc(cur.child);
            }
            this.currentBuildProcess = null;
        }
        if (this.taskExecutor) {
            this.taskExecutor.terminate();
            this.taskExecutor = null;
        }
    }

    public async getResult(): Promise<proc.Subprocess | null> {
        await this.currentBuildProcess?.result;
        const buildProcess = this.currentBuildProcess;
        this.currentBuildProcess = null;
        return buildProcess;
    }

    public setBuildProcess(buildProcess: proc.Subprocess | null = null): void {
        this.currentBuildProcess = buildProcess;
    }

}
