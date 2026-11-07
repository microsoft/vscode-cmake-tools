import type { CancellationToken, Disposable, TaskExecution } from 'vscode';

export interface TaskWaitEvents<T> {
    onDidEndTask(listener: (event: { execution: T }) => void): Disposable;
    onDidEndTaskProcess(listener: (event: { execution: T; exitCode: number | undefined }) => void): Disposable;
}

export type TaskWaitResult = { kind: 'completed'; exitCode: number } | { kind: 'cancelled' };

export async function waitForPreConfigureTask<T extends Pick<TaskExecution, 'terminate'>>(
    events: TaskWaitEvents<T>,
    start: () => PromiseLike<T>,
    cancellationToken?: CancellationToken
): Promise<TaskWaitResult> {
    if (cancellationToken?.isCancellationRequested) {
        return { kind: 'cancelled' };
    }

    const disposables: Disposable[] = [];
    // An execution's end events can arrive before executeTask returns its identity.
    const endedExecutions = new Set<T>();
    const exitCodes = new Map<T, number>();
    let execution: T | undefined;
    let settled = false;
    let cancelled = false;
    let terminated = false;
    let resolveResult!: (result: TaskWaitResult) => void;
    const result = new Promise<TaskWaitResult>(resolve => {
        resolveResult = resolve;
    });

    const finish = (outcome: TaskWaitResult) => {
        if (!settled) {
            settled = true;
            resolveResult(outcome);
        }
    };
    const finishIfEnded = () => {
        if (execution && endedExecutions.has(execution)) {
            finish({ kind: 'completed', exitCode: exitCodes.get(execution) ?? 0 });
        }
    };
    const cancel = () => {
        if (!settled) {
            cancelled = true;
            finish({ kind: 'cancelled' });
        }
    };
    const terminate = () => {
        if (execution && !terminated) {
            terminated = true;
            execution.terminate();
        }
    };

    try {
        disposables.push(events.onDidEndTaskProcess(event => {
            if (!settled && (!execution || event.execution === execution)) {
                // A process event with no exit code denotes termination, not a process-less task.
                exitCodes.set(event.execution, event.exitCode ?? -1);
            }
        }));
        disposables.push(events.onDidEndTask(event => {
            if (!settled && (!execution || event.execution === execution)) {
                endedExecutions.add(event.execution);
                finishIfEnded();
            }
        }));
        if (cancellationToken) {
            disposables.push(cancellationToken.onCancellationRequested(cancel));
            if (cancellationToken.isCancellationRequested) {
                cancel();
            }
        }
        if (cancelled) {
            return await result;
        }

        const startAndWait = async (): Promise<TaskWaitResult> => {
            execution = await start();
            if (cancelled) {
                terminate();
            } else {
                finishIfEnded();
            }
            return result;
        };

        // Observe startup even after cancellation, terminating a late execution and
        // consuming a late startup rejection without keeping the configure waiting.
        return await Promise.race([startAndWait(), result]);
    } finally {
        for (const disposable of disposables) {
            disposable.dispose();
        }
        endedExecutions.clear();
        exitCodes.clear();
        if (cancelled) {
            terminate();
        }
    }
}
