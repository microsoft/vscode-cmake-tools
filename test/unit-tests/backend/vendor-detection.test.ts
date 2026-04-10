import { expect } from 'chai';

/**
 * Tests for the getVendorExtensionHint logic and the retry delay sequence.
 *
 * These functions are mirrored inline because the actual implementation lives
 * in src/extension.ts which transitively depends on 'vscode' and cannot be
 * imported directly in backend tests.
 */

// --- Mirror of vendorCMakeExtensions from src/extension.ts ---
const vendorCMakeExtensions: { id: string; label: string }[] = [
    { id: 'stmicroelectronics.stm32-vscode-extension', label: 'STM32 for VS Code' },
    { id: 'espressif.esp-idf-extension', label: 'ESP-IDF' },
    { id: 'NXPSemiconductors.mcuxpresso', label: 'MCUXpresso' },
    { id: 'nordic-semiconductor.nrf-connect', label: 'nRF Connect' }
];

/**
 * Mirror of getVendorExtensionHint.
 * Takes a set of installed extension IDs and returns a display name or undefined.
 */
function getVendorExtensionHint(installedExtensionIds: Set<string>): string | undefined {
    for (const ext of vendorCMakeExtensions) {
        if (installedExtensionIds.has(ext.id)) {
            return ext.label;
        }
    }
    return undefined;
}

// --- Mirror of retry delay constants from src/extension.ts ---
const cmakeNotFoundMaxRetries = 4;
const cmakeNotFoundRetryDelaysMs: readonly number[] = [2000, 4000, 8000, 16000];

suite('getVendorExtensionHint', () => {
    test('returns undefined when no vendor extensions are installed', () => {
        const installed = new Set<string>(['some.other.extension']);
        expect(getVendorExtensionHint(installed)).to.be.undefined;
    });

    test('returns undefined for empty installed set', () => {
        const installed = new Set<string>();
        expect(getVendorExtensionHint(installed)).to.be.undefined;
    });

    test('returns hint for STM32 for VS Code', () => {
        const installed = new Set<string>(['stmicroelectronics.stm32-vscode-extension']);
        const hint = getVendorExtensionHint(installed);
        expect(hint).to.be.a('string');
        expect(hint).to.include('STM32 for VS Code');
    });

    test('returns hint for ESP-IDF', () => {
        const installed = new Set<string>(['espressif.esp-idf-extension']);
        const hint = getVendorExtensionHint(installed);
        expect(hint).to.be.a('string');
        expect(hint).to.include('ESP-IDF');
    });

    test('returns first matching hint when multiple vendor extensions installed', () => {
        const installed = new Set<string>([
            'stmicroelectronics.stm32-vscode-extension',
            'espressif.esp-idf-extension'
        ]);
        const hint = getVendorExtensionHint(installed);
        expect(hint).to.be.a('string');
        // First entry in the list wins
        expect(hint).to.include('STM32 for VS Code');
    });

    test('returns undefined for unrelated extensions', () => {
        const installed = new Set<string>(['ms-vscode.cmake-tools-pack', 'ms-vscode.cpptools-extension-pack']);
        expect(getVendorExtensionHint(installed)).to.be.undefined;
    });
});

suite('Retry delay sequence', () => {
    test('has expected number of entries matching max retries', () => {
        expect(cmakeNotFoundRetryDelaysMs).to.have.lengthOf(cmakeNotFoundMaxRetries);
    });

    test('all delays are positive', () => {
        for (const delay of cmakeNotFoundRetryDelaysMs) {
            expect(delay).to.be.greaterThan(0);
        }
    });

    test('delays are non-decreasing', () => {
        for (let i = 1; i < cmakeNotFoundRetryDelaysMs.length; i++) {
            expect(cmakeNotFoundRetryDelaysMs[i]).to.be.at.least(cmakeNotFoundRetryDelaysMs[i - 1]);
        }
    });

    test('last delay is reused for out-of-range indices', () => {
        const lastDelay = cmakeNotFoundRetryDelaysMs[cmakeNotFoundRetryDelaysMs.length - 1];
        // Simulate how the retry loop picks delays for indices beyond the array
        for (let attempt = cmakeNotFoundRetryDelaysMs.length; attempt < cmakeNotFoundRetryDelaysMs.length + 5; attempt++) {
            const delay = cmakeNotFoundRetryDelaysMs[Math.min(attempt, cmakeNotFoundRetryDelaysMs.length - 1)];
            expect(delay).to.equal(lastDelay);
        }
    });

    test('total wait time is reasonable (under 2 minutes)', () => {
        const totalMs = cmakeNotFoundRetryDelaysMs.reduce((sum, d) => sum + d, 0);
        expect(totalMs).to.be.at.most(120_000);
    });
});
