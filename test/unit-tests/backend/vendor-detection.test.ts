import { expect } from 'chai';

/**
 * Tests for the vendor-integrator detection logic and the retry delay sequence.
 *
 * These functions are mirrored inline because the actual implementation lives
 * in src/extension.ts which transitively depends on 'vscode' and cannot be
 * imported directly in backend tests.
 */

// --- Mirror of vendorExtensionLabels from src/extension.ts ---
const vendorExtensionLabels: ReadonlyMap<string, string> = new Map([
    ['stmicroelectronics.stm32-vscode-extension', 'STM32 for VS Code'],
    ['espressif.esp-idf-extension', 'ESP-IDF'],
    ['NXPSemiconductors.mcuxpresso', 'MCUXpresso'],
    ['nordic-semiconductor.nrf-connect', 'nRF Connect']
]);

/**
 * Mirror of getInstalledVendorHint.
 * Takes a list of vendor IDs (from the setting) and a set of installed
 * extension IDs, returns the display name of the first match or undefined.
 */
function getInstalledVendorHint(vendorIds: string[], installedExtensionIds: Set<string>): string | undefined {
    for (const id of vendorIds) {
        if (installedExtensionIds.has(id)) {
            return vendorExtensionLabels.get(id) ?? id;
        }
    }
    return undefined;
}

// --- Mirror of retry delay constants from src/extension.ts ---
const cmakeNotFoundMaxRetries = 4;
const cmakeNotFoundRetryDelaysMs: readonly number[] = [2000, 4000, 8000, 16000];

// Default vendor IDs (mirrors the package.json default for cmake.cmakeProviderExtensions)
const defaultVendorIds = [
    'stmicroelectronics.stm32-vscode-extension',
    'espressif.esp-idf-extension',
    'NXPSemiconductors.mcuxpresso',
    'nordic-semiconductor.nrf-connect'
];

suite('getInstalledVendorHint (setting-driven)', () => {
    test('returns undefined when no vendor extensions are installed', () => {
        const installed = new Set<string>(['some.other.extension']);
        expect(getInstalledVendorHint(defaultVendorIds, installed)).to.be.undefined;
    });

    test('returns undefined for empty installed set', () => {
        const installed = new Set<string>();
        expect(getInstalledVendorHint(defaultVendorIds, installed)).to.be.undefined;
    });

    test('returns undefined when vendor list is empty (user disabled)', () => {
        const installed = new Set<string>(['stmicroelectronics.stm32-vscode-extension']);
        expect(getInstalledVendorHint([], installed)).to.be.undefined;
    });

    test('returns friendly label for known vendor (STM32)', () => {
        const installed = new Set<string>(['stmicroelectronics.stm32-vscode-extension']);
        expect(getInstalledVendorHint(defaultVendorIds, installed)).to.equal('STM32 for VS Code');
    });

    test('returns friendly label for known vendor (ESP-IDF)', () => {
        const installed = new Set<string>(['espressif.esp-idf-extension']);
        expect(getInstalledVendorHint(defaultVendorIds, installed)).to.equal('ESP-IDF');
    });

    test('returns first match when multiple vendors installed', () => {
        const installed = new Set<string>([
            'stmicroelectronics.stm32-vscode-extension',
            'espressif.esp-idf-extension'
        ]);
        expect(getInstalledVendorHint(defaultVendorIds, installed)).to.equal('STM32 for VS Code');
    });

    test('returns raw ID for user-added vendor not in label map', () => {
        const customVendorIds = ['some.custom.vendor'];
        const installed = new Set<string>(['some.custom.vendor']);
        expect(getInstalledVendorHint(customVendorIds, installed)).to.equal('some.custom.vendor');
    });

    test('respects custom vendor list from setting', () => {
        const customVendorIds = ['my.company.cmake-provider'];
        const installed = new Set<string>(['stmicroelectronics.stm32-vscode-extension', 'my.company.cmake-provider']);
        // Only checks the custom list, not the defaults
        expect(getInstalledVendorHint(customVendorIds, installed)).to.equal('my.company.cmake-provider');
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

    test('total wait time is reasonable (under 2 minutes)', () => {
        const totalMs = cmakeNotFoundRetryDelaysMs.reduce((sum, d) => sum + d, 0);
        expect(totalMs).to.be.at.most(120_000);
    });
});
