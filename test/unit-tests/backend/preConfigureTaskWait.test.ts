import { expect } from 'chai';
import type { Disposable } from 'vscode';
import { TaskWaitResult, waitForPreConfigureTask } from '@cmt/preConfigureTaskWait';

class FakeEmitter<T> {
    private readonly listeners = new Set<(event: T) => void>();

    readonly event = (listener: (event: T) => void): Disposable => {
        this.listeners.add(listener);
        let disposed = false;
        return {
            dispose: () => {
                expect(disposed, 'listener disposed twice').to.equal(false);
                disposed = true;
                this.listeners.delete(listener);
            }
        };
    };

    get listenerCount(): number {
        return this.listeners.size;
    }

    fire(event: T): void {
        for (const listener of [...this.listeners]) {
            listener(event);
        }
    }
}

class FakeTaskExecution {
    terminations = 0;

    constructor(readonly task = { name: 'prepare' }, private readonly onTerminate?: () => void) {}

    terminate(): void {
        this.terminations++;
        this.onTerminate?.();
    }
}

class FakeCancellationToken {
    isCancellationRequested = false;
    readonly cancellation = new FakeEmitter<void>();
    readonly onCancellationRequested = this.cancellation.event;

    cancel(): void {
        this.isCancellationRequested = true;
        this.cancellation.fire();
    }
}

function createEvents() {
    const end = new FakeEmitter<{ execution: FakeTaskExecution }>();
    const processEnd = new FakeEmitter<{ execution: FakeTaskExecution; exitCode: number | undefined }>();
    return {
        end,
        processEnd,
        onDidEndTask: end.event,
        onDidEndTaskProcess: processEnd.event
    };
}

function nextTurn(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}

async function settledResult(wait: Promise<TaskWaitResult>): Promise<TaskWaitResult> {
    let result: TaskWaitResult | undefined;
    let failure: { error: unknown } | undefined;
    void wait.then(value => {
        result = value;
    }, error => {
        failure = { error };
    });
    await nextTurn();
    if (failure) {
        throw failure.error;
    }
    expect(result, 'task wait did not settle after the lifecycle event').not.to.equal(undefined);
    return result!;
}

function expectDisposed(events: ReturnType<typeof createEvents>, cancellation?: FakeCancellationToken): void {
    expect(events.end.listenerCount, 'task-end listeners').to.equal(0);
    expect(events.processEnd.listenerCount, 'process-end listeners').to.equal(0);
    if (cancellation) {
        expect(cancellation.cancellation.listenerCount, 'cancellation listeners').to.equal(0);
    }
}

suite('Pre-configure task lifecycle', () => {
    test('captures the process exit code but waits for the task to end', async () => {
        const events = createEvents();
        const execution = new FakeTaskExecution();
        const cancellation = new FakeCancellationToken();
        const wait = waitForPreConfigureTask(events, async () => execution, cancellation);
        let settled = false;
        void wait.then(() => {
            settled = true;
        });
        await nextTurn();
        events.processEnd.fire({ execution, exitCode: 7 });
        await nextTurn();
        expect(settled, 'a process exit is not the end of the task').to.equal(false);
        events.end.fire({ execution });
        expect(await settledResult(wait)).to.deep.equal({ kind: 'completed', exitCode: 7 });
        expectDisposed(events, cancellation);
    });

    test('registers both lifecycle listeners before starting the task', async () => {
        const events = createEvents();
        const execution = new FakeTaskExecution();
        const wait = waitForPreConfigureTask(events, async () => {
            expect(events.end.listenerCount).to.equal(1);
            expect(events.processEnd.listenerCount).to.equal(1);
            events.processEnd.fire({ execution, exitCode: 0 });
            events.end.fire({ execution });
            return execution;
        });
        expect(await settledResult(wait)).to.deep.equal({ kind: 'completed', exitCode: 0 });
        expectDisposed(events);
    });

    test('retains end events fired before executeTask returns its execution', async () => {
        const events = createEvents();
        const execution = new FakeTaskExecution();
        const wait = waitForPreConfigureTask(events, async () => {
            events.processEnd.fire({ execution, exitCode: 23 });
            events.end.fire({ execution });
            return execution;
        });
        expect(await settledResult(wait)).to.deep.equal({ kind: 'completed', exitCode: 23 });
        expectDisposed(events);
    });

    test('finishes a process-less CustomExecution task successfully', async () => {
        const events = createEvents();
        const execution = new FakeTaskExecution();
        const wait = waitForPreConfigureTask(events, async () => execution);
        await nextTurn();
        events.end.fire({ execution });
        expect(await settledResult(wait)).to.deep.equal({ kind: 'completed', exitCode: 0 });
        expectDisposed(events);
    });

    test('finishes an immediately completing process-less task', async () => {
        const events = createEvents();
        const execution = new FakeTaskExecution();
        const wait = waitForPreConfigureTask(events, async () => {
            events.end.fire({ execution });
            return execution;
        });
        expect(await settledResult(wait)).to.deep.equal({ kind: 'completed', exitCode: 0 });
        expectDisposed(events);
    });

    test('settles cancellation and terminates without waiting for another event', async () => {
        const events = createEvents();
        const execution = new FakeTaskExecution();
        const cancellation = new FakeCancellationToken();
        const wait = waitForPreConfigureTask(events, async () => execution, cancellation);
        await nextTurn();
        cancellation.cancel();
        expect(await settledResult(wait)).to.deep.equal({ kind: 'cancelled' });
        expect(execution.terminations).to.equal(1);
        expectDisposed(events, cancellation);
        cancellation.cancel();
        events.end.fire({ execution });
        expect(execution.terminations).to.equal(1);
    });

    test('does not start a task for an already cancelled configure', async () => {
        const events = createEvents();
        const cancellation = new FakeCancellationToken();
        cancellation.cancel();
        let starts = 0;
        const wait = waitForPreConfigureTask(events, async () => {
            starts++;
            return new FakeTaskExecution();
        }, cancellation);
        expect(await settledResult(wait)).to.deep.equal({ kind: 'cancelled' });
        expect(starts).to.equal(0);
        expectDisposed(events, cancellation);
    });

    test('settles cancellation while startup is pending and terminates a late execution', async () => {
        const events = createEvents();
        const execution = new FakeTaskExecution();
        const cancellation = new FakeCancellationToken();
        let finishStart!: (execution: FakeTaskExecution) => void;
        const start = new Promise<FakeTaskExecution>(resolve => {
            finishStart = resolve;
        });
        const wait = waitForPreConfigureTask(events, () => start, cancellation);
        cancellation.cancel();
        expect(await settledResult(wait)).to.deep.equal({ kind: 'cancelled' });
        expectDisposed(events, cancellation);
        finishStart(execution);
        await nextTurn();
        expect(execution.terminations).to.equal(1);
        expectDisposed(events, cancellation);
    });

    test('cancellation wins over synchronous task-end events during termination', async () => {
        const events = createEvents();
        const execution = new FakeTaskExecution(undefined, () => {
            events.end.fire({ execution });
        });
        const cancellation = new FakeCancellationToken();
        const wait = waitForPreConfigureTask(events, async () => execution, cancellation);
        await nextTurn();
        cancellation.cancel();
        expect(await settledResult(wait)).to.deep.equal({ kind: 'cancelled' });
        expect(execution.terminations).to.equal(1);
        expectDisposed(events, cancellation);
    });

    test('ignores unrelated executions even when they share the exact same task', async () => {
        const events = createEvents();
        const execution = new FakeTaskExecution();
        const unrelated = new FakeTaskExecution(execution.task);
        const wait = waitForPreConfigureTask(events, async () => {
            events.processEnd.fire({ execution: unrelated, exitCode: 91 });
            events.end.fire({ execution: unrelated });
            return execution;
        });
        let settled = false;
        void wait.then(() => {
            settled = true;
        });
        await nextTurn();
        events.processEnd.fire({ execution: unrelated, exitCode: 12 });
        events.end.fire({ execution: unrelated });
        await nextTurn();
        expect(settled).to.equal(false);
        events.end.fire({ execution });
        expect(await settledResult(wait)).to.deep.equal({ kind: 'completed', exitCode: 0 });
        expectDisposed(events);
    });

    for (const synchronous of [true, false]) {
        test(`cleans up ${synchronous ? 'thrown' : 'rejected'} startup errors before a subsequent wait`, async () => {
            const events = createEvents();
            const cancellation = new FakeCancellationToken();
            const error = new Error('Task could not start');
            const wait = waitForPreConfigureTask(events, () => {
                if (synchronous) {
                    throw error;
                }
                return Promise.reject(error);
            }, cancellation);
            const failure = await wait.then(() => undefined, reason => reason);
            expect(failure).to.equal(error);
            expectDisposed(events, cancellation);

            const execution = new FakeTaskExecution();
            const subsequentWait = waitForPreConfigureTask(events, async () => execution);
            await nextTurn();
            events.end.fire({ execution });
            expect(await settledResult(subsequentWait)).to.deep.equal({ kind: 'completed', exitCode: 0 });
            expectDisposed(events);
        });
    }

    test('a failed process does not poison a subsequent successful process-less wait', async () => {
        const events = createEvents();
        const failedExecution = new FakeTaskExecution();
        const failedWait = waitForPreConfigureTask(events, async () => failedExecution);
        await nextTurn();
        events.processEnd.fire({ execution: failedExecution, exitCode: 1 });
        events.end.fire({ execution: failedExecution });
        expect(await settledResult(failedWait)).to.deep.equal({ kind: 'completed', exitCode: 1 });
        expectDisposed(events);

        const execution = new FakeTaskExecution();
        const wait = waitForPreConfigureTask(events, async () => execution);
        await nextTurn();
        events.end.fire({ execution: failedExecution });
        events.end.fire({ execution });
        expect(await settledResult(wait)).to.deep.equal({ kind: 'completed', exitCode: 0 });
        expectDisposed(events);
    });

    test('keeps an undefined process exit code as failure rather than process-less success', async () => {
        const events = createEvents();
        const execution = new FakeTaskExecution();
        const wait = waitForPreConfigureTask(events, async () => {
            events.processEnd.fire({ execution, exitCode: undefined });
            events.end.fire({ execution });
            return execution;
        });
        expect(await settledResult(wait)).to.deep.equal({ kind: 'completed', exitCode: -1 });
        expectDisposed(events);
    });

    test('observes startup rejection after cancellation without poisoning another wait', async () => {
        const events = createEvents();
        const cancellation = new FakeCancellationToken();
        let rejectStart!: (error: Error) => void;
        const start = new Promise<FakeTaskExecution>((_resolve, reject) => {
            rejectStart = reject;
        });
        const wait = waitForPreConfigureTask(events, () => start, cancellation);
        cancellation.cancel();
        expect(await settledResult(wait)).to.deep.equal({ kind: 'cancelled' });
        rejectStart(new Error('Startup failed after cancellation'));
        await nextTurn();
        expectDisposed(events, cancellation);

        const execution = new FakeTaskExecution();
        const subsequentWait = waitForPreConfigureTask(events, async () => execution);
        await nextTurn();
        events.end.fire({ execution });
        expect(await settledResult(subsequentWait)).to.deep.equal({ kind: 'completed', exitCode: 0 });
        expectDisposed(events);
    });
});
