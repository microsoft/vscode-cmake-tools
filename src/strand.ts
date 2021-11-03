/**
 * Module providing "strands," serialized execution in an asychronous world.
 */ /** */

/**
 * Provides serial execution for asynchronous code. Here are the semantics:
 *
 * `Strand` holds an internal execution queue of completion callbacks. Each
 * call to `execute` will push to the queue. When a callback in the queue
 * finishes with either an exception or a regular return, the next callback in
 * the queue will be dispatched. Callbacks are not executed until all prior
 * callbacks have run to completion.
 */
export class Strand {
    private _tailPromise: Thenable<void> = Promise.resolve();

    private _enqueue(fn: () => Promise<void>) {
        this._tailPromise = this._tailPromise.then(
            fn,
            fn
        );
    }

    /**
     * Enqueue a function for execution.
     *
     * Callbacks passed to `execute()` are always executed in order, and never
     * started until the prior callbacks have executed.
     *
     * @param func The next completion callback
     * @returns a Thenable that will resolve with the return value/exception of
     * the enqueued function.
     */
    execute<T>(func: () => Thenable<T>): Thenable<T>;
    execute<T>(func: () => Promise<T>): Thenable<T>;
    execute<T>(func: () => T): Thenable<T>;
    execute<Ret>(func: () => Ret): Thenable<Ret> {
        return new Promise<Ret>((resolve, reject) => {
            this._enqueue(async () => {
                try {
                    const result = await Promise.resolve(func());
                    resolve(result);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }
}
