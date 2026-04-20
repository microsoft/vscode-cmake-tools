import { expect } from 'chai';

/**
 * Tests for the reloadCMakeDriver null-driver fix.
 *
 * The actual reloadCMakeDriver method lives in src/cmakeProject.ts and depends
 * on vscode, CMakeDriver, etc. We mirror the essential logic here to verify
 * that the fix correctly handles the null-driver case.
 */

// --- Mirrored logic of reloadCMakeDriver ---

interface MockDriver {
    disposed: boolean;
    asyncDispose(): Promise<void>;
}

interface ReloadResult {
    driverCreated: boolean;
    oldDriverDisposed: boolean;
}

/**
 * OLD (buggy) implementation: only creates a new driver if the old one is
 * non-null, meaning a workspace that never had a driver stays without one.
 */
async function reloadCMakeDriverOld(
    currentDriver: Promise<MockDriver | null>,
    startNewDriver: () => Promise<MockDriver>
): Promise<ReloadResult> {
    try {
        const drv = await currentDriver;
        if (drv) {
            await drv.asyncDispose();
            await startNewDriver();
            return { driverCreated: true, oldDriverDisposed: true };
        }
    } catch {
        await startNewDriver();
        return { driverCreated: true, oldDriverDisposed: false };
    }
    // Bug: when drv is null, we fall through without creating a new driver
    return { driverCreated: false, oldDriverDisposed: false };
}

/**
 * NEW (fixed) implementation: always creates a new driver, disposing the old
 * one first if it exists.
 */
async function reloadCMakeDriverNew(
    currentDriver: Promise<MockDriver | null>,
    startNewDriver: () => Promise<MockDriver>
): Promise<ReloadResult> {
    let oldDriverDisposed = false;
    try {
        const drv = await currentDriver;
        if (drv) {
            await drv.asyncDispose();
            oldDriverDisposed = true;
        }
    } catch {
        // Driver was in a bad state — proceed to create a new one.
    }
    await startNewDriver();
    return { driverCreated: true, oldDriverDisposed };
}

function createMockDriver(): MockDriver {
    return {
        disposed: false,
        async asyncDispose() {
            this.disposed = true;
        }
    };
}

suite('reloadCMakeDriver null-driver fix', () => {
    suite('OLD (buggy) behavior', () => {
        test('creates driver when old driver exists', async () => {
            const existing = createMockDriver();
            const result = await reloadCMakeDriverOld(
                Promise.resolve(existing),
                async () => createMockDriver()
            );
            expect(result.driverCreated).to.be.true;
            expect(result.oldDriverDisposed).to.be.true;
            expect(existing.disposed).to.be.true;
        });

        test('does NOT create driver when old driver is null (BUG)', async () => {
            const result = await reloadCMakeDriverOld(
                Promise.resolve(null),
                async () => createMockDriver()
            );
            // This is the bug: no new driver is created
            expect(result.driverCreated).to.be.false;
        });

        test('creates driver when old driver promise rejects', async () => {
            const result = await reloadCMakeDriverOld(
                Promise.reject(new Error('bad state')),
                async () => createMockDriver()
            );
            expect(result.driverCreated).to.be.true;
        });
    });

    suite('NEW (fixed) behavior', () => {
        test('creates driver when old driver exists', async () => {
            const existing = createMockDriver();
            const result = await reloadCMakeDriverNew(
                Promise.resolve(existing),
                async () => createMockDriver()
            );
            expect(result.driverCreated).to.be.true;
            expect(result.oldDriverDisposed).to.be.true;
            expect(existing.disposed).to.be.true;
        });

        test('creates driver when old driver is null (FIX)', async () => {
            const result = await reloadCMakeDriverNew(
                Promise.resolve(null),
                async () => createMockDriver()
            );
            // Fixed: new driver is always created
            expect(result.driverCreated).to.be.true;
            expect(result.oldDriverDisposed).to.be.false;
        });

        test('creates driver when old driver promise rejects', async () => {
            const result = await reloadCMakeDriverNew(
                Promise.reject(new Error('bad state')),
                async () => createMockDriver()
            );
            expect(result.driverCreated).to.be.true;
            expect(result.oldDriverDisposed).to.be.false;
        });

        test('disposes old driver before creating new one', async () => {
            const existing = createMockDriver();
            let disposedBeforeCreate = false;
            const result = await reloadCMakeDriverNew(
                Promise.resolve(existing),
                async () => {
                    disposedBeforeCreate = existing.disposed;
                    return createMockDriver();
                }
            );
            expect(result.driverCreated).to.be.true;
            expect(disposedBeforeCreate).to.be.true;
        });
    });
});
