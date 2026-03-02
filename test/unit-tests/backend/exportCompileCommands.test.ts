import { expect } from 'chai';

/**
 * Tests for the export compile commands logic in cmakeDriver.ts
 *
 * This tests the LOGIC PATTERN used for deciding whether to inject
 * -DCMAKE_EXPORT_COMPILE_COMMANDS into CMake configure arguments.
 *
 * The actual implementation lives in cmakeDriver.ts but depends on vscode,
 * so we mirror the decision logic here to validate correctness.
 *
 * Issue #4893: When cmake.exportCompileCommandsFile is set to false,
 * the flag should NOT be passed at all (not even as FALSE), to avoid
 * CMake warnings for projects with LANGUAGES NONE.
 */

suite('[Export Compile Commands Logic]', () => {
    /**
     * Mirrors the logic from cmakeDriver.ts generateConfigArgsFromPreset()
     * and generateCMakeSettingsFlags()
     *
     * @param exportCompileCommandsSetting The raw setting value (undefined, true, or false)
     * @param hasExportCompileCommandsInPresetOrArgs Whether preset or args already specify the flag
     * @returns Whether to inject the -DCMAKE_EXPORT_COMPILE_COMMANDS flag
     */
    function shouldInjectExportCompileCommandsFlag(
        exportCompileCommandsSetting: boolean | undefined,
        hasExportCompileCommandsInPresetOrArgs: boolean
    ): boolean {
        // Mirror the logic from cmakeDriver.ts:
        // const exportCompileCommandsFile: boolean = exportCompileCommandsSetting === undefined ? true : (exportCompileCommandsSetting || false);
        const exportCompileCommandsFile: boolean = exportCompileCommandsSetting === undefined ? true : (exportCompileCommandsSetting || false);

        // For presets mode (generateConfigArgsFromPreset):
        // if (!hasExportCompileCommands && exportCompileCommandsFile)
        //
        // For kits mode (generateCMakeSettingsFlags):
        // if (exportCompileCommandsFile)
        //
        // Both modes now check exportCompileCommandsFile is truthy before injecting
        return !hasExportCompileCommandsInPresetOrArgs && exportCompileCommandsFile;
    }

    suite('Setting is undefined (default)', () => {
        test('Should inject flag when preset/args do not specify it', () => {
            const result = shouldInjectExportCompileCommandsFlag(undefined, false);
            expect(result).to.equal(true, 'Default behavior should inject TRUE to enable compile_commands.json');
        });

        test('Should NOT inject flag when preset/args already specify it', () => {
            const result = shouldInjectExportCompileCommandsFlag(undefined, true);
            expect(result).to.equal(false, 'Should respect preset/args override');
        });
    });

    suite('Setting is explicitly true', () => {
        test('Should inject flag when preset/args do not specify it', () => {
            const result = shouldInjectExportCompileCommandsFlag(true, false);
            expect(result).to.equal(true, 'Explicit true should inject the flag');
        });

        test('Should NOT inject flag when preset/args already specify it', () => {
            const result = shouldInjectExportCompileCommandsFlag(true, true);
            expect(result).to.equal(false, 'Should respect preset/args override');
        });
    });

    suite('Setting is explicitly false (Issue #4893 fix)', () => {
        test('Should NOT inject flag when preset/args do not specify it', () => {
            const result = shouldInjectExportCompileCommandsFlag(false, false);
            expect(result).to.equal(false, 'Explicit false should NOT inject the flag at all');
        });

        test('Should NOT inject flag when preset/args already specify it', () => {
            const result = shouldInjectExportCompileCommandsFlag(false, true);
            expect(result).to.equal(false, 'Should respect preset/args override');
        });
    });

    suite('exportCompileCommandsFile computation', () => {
        /**
         * Mirrors the computation: exportCompileCommandsSetting === undefined ? true : (exportCompileCommandsSetting || false)
         */
        function computeExportCompileCommandsFile(setting: boolean | undefined): boolean {
            return setting === undefined ? true : (setting || false);
        }

        test('undefined setting defaults to true', () => {
            expect(computeExportCompileCommandsFile(undefined)).to.equal(true);
        });

        test('explicit true remains true', () => {
            expect(computeExportCompileCommandsFile(true)).to.equal(true);
        });

        test('explicit false becomes false', () => {
            expect(computeExportCompileCommandsFile(false)).to.equal(false);
        });
    });

    suite('Kits mode logic (generateCMakeSettingsFlags)', () => {
        /**
         * In kits mode, the logic is simpler: just check if exportCompileCommandsFile is truthy
         * (no hasExportCompileCommands check needed as configureSettings handles that)
         */
        function shouldAddToSettingMapInKitsMode(exportCompileCommandsSetting: boolean | undefined): boolean {
            const exportCompileCommandsFile: boolean = exportCompileCommandsSetting === undefined ? true : (exportCompileCommandsSetting || false);
            return exportCompileCommandsFile;
        }

        test('undefined setting should add to settingMap', () => {
            expect(shouldAddToSettingMapInKitsMode(undefined)).to.equal(true);
        });

        test('explicit true should add to settingMap', () => {
            expect(shouldAddToSettingMapInKitsMode(true)).to.equal(true);
        });

        test('explicit false should NOT add to settingMap (Issue #4893 fix)', () => {
            expect(shouldAddToSettingMapInKitsMode(false)).to.equal(false);
        });
    });
});
