import { expect } from 'chai';

/**
 * Tests for the demand-lazy loading behavior added to `LanguageServiceData`
 * (src/languageServices/languageServiceData.ts).
 *
 * The real class transitively depends on the VS Code API (MarkdownString,
 * Hover, CompletionItem, ...) and on `thisExtensionPath()`, which are not
 * available under the backend `setup-vscode-mock.ts` stub. Following the
 * repo's backend-test convention (see expand.test.ts, shell-propagation.test.ts),
 * we mirror the pure `ensureLoaded`/`dispose` memoization logic here so it can be
 * exercised deterministically without the real filesystem or vscode.
 *
 * MANUAL-VERIFICATION GAP: this test validates a faithful mirror of the
 * memoization/cancellation/disposal contract, not the concrete
 * `LanguageServiceData` instance. The real class must keep the same shape:
 *   - `create()` is synchronous and does not read any files.
 *   - `ensureLoaded()` memoizes a single shared `load()` (via `??=`).
 *   - a load failure is memoized as `false` (never a rejected promise, never
 *     cleared) so providers do not re-read the four asset files on every request.
 *   - `provideHover`/`provideCompletionItems` check disposed/cancellation both
 *     before and after awaiting `ensureLoaded()`.
 */

interface CancellationLike {
    isCancellationRequested: boolean;
}

// Mirror of the demand-lazy loading contract in LanguageServiceData.
class MirroredLanguageServiceData {
    public loadCount = 0;
    private loadPromise?: Promise<boolean>;
    private disposed = false;

    constructor(private readonly loadImpl: () => Promise<void>, private readonly onLoadError?: (error: unknown) => void) {}

    private load(): Promise<void> {
        this.loadCount++;
        return this.loadImpl();
    }

    private ensureLoaded(): Promise<boolean> {
        return this.loadPromise ??= this.load().then(
            () => true,
            (error) => {
                this.onLoadError?.(error);
                return false;
            }
        );
    }

    dispose(): void {
        this.disposed = true;
    }

    // Mirrors the guard structure shared by provideHover/provideCompletionItems.
    async provide(token: CancellationLike, buildResult: () => string): Promise<string | undefined> {
        if (this.disposed || token.isCancellationRequested) {
            return undefined;
        }
        if (!await this.ensureLoaded()) {
            return undefined;
        }
        if (this.disposed || token.isCancellationRequested) {
            return undefined;
        }
        return buildResult();
    }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(reason?: unknown): void } {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

suite('LanguageServiceData demand-lazy loading', () => {
    test('construction does not trigger a load', () => {
        const data = new MirroredLanguageServiceData(() => Promise.resolve());
        expect(data.loadCount).to.eq(0);
    });

    test('concurrent provider requests share a single load', async () => {
        const gate = deferred<void>();
        const data = new MirroredLanguageServiceData(() => gate.promise);

        const token: CancellationLike = { isCancellationRequested: false };
        const first = data.provide(token, () => 'hover');
        const second = data.provide(token, () => 'completion');

        // Both requests were issued before the load resolves; only one load runs.
        expect(data.loadCount).to.eq(1);

        gate.resolve();
        const [a, b] = await Promise.all([first, second]);
        expect(a).to.eq('hover');
        expect(b).to.eq('completion');
        expect(data.loadCount).to.eq(1);
    });

    test('a load failure is memoized as no-result without throwing or retrying', async () => {
        let errorsReported = 0;
        const data = new MirroredLanguageServiceData(
            () => Promise.reject(new Error('boom')),
            () => {
                errorsReported++;
            }
        );

        const token: CancellationLike = { isCancellationRequested: false };
        const first = await data.provide(token, () => 'hover');
        const second = await data.provide(token, () => 'hover');

        expect(first).to.eq(undefined);
        expect(second).to.eq(undefined);
        // The failed load is memoized: it runs once and is not retried.
        expect(data.loadCount).to.eq(1);
        // The one-shot error callback fires exactly once.
        expect(errorsReported).to.eq(1);
    });

    test('dispose before load completes suppresses the result', async () => {
        const gate = deferred<void>();
        const data = new MirroredLanguageServiceData(() => gate.promise);

        const token: CancellationLike = { isCancellationRequested: false };
        const pending = data.provide(token, () => 'hover');
        data.dispose();
        gate.resolve();

        expect(await pending).to.eq(undefined);
    });

    test('cancellation before awaiting the load short-circuits', async () => {
        const data = new MirroredLanguageServiceData(() => Promise.resolve());
        const token: CancellationLike = { isCancellationRequested: true };

        const result = await data.provide(token, () => 'hover');
        expect(result).to.eq(undefined);
        // Cancelled before ensureLoaded: no load is triggered.
        expect(data.loadCount).to.eq(0);
    });

    test('cancellation after the load completes suppresses the result', async () => {
        const token: CancellationLike = { isCancellationRequested: false };
        const data = new MirroredLanguageServiceData(async () => {
            // Simulate cancellation arriving while the load is in flight.
            token.isCancellationRequested = true;
        });

        const result = await data.provide(token, () => 'hover');
        expect(result).to.eq(undefined);
        expect(data.loadCount).to.eq(1);
    });
});
