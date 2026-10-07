import { expect } from 'chai';
import * as path from 'path';

import { argsControlSarif, argsSpecifyExportSarif, sarifLogPath } from '@cmt/diagnostics/sarif';

/**
 * Tests for the export and load SARIF logic in cmakeDriver.ts and
 * cmakeFileApiDriver.ts
 *
 * Deciding whether to inject -DCMAKE_EXPORT_SARIF mirrors the
 * -DCMAKE_EXPORT_COMPILE_COMMANDS logic in exportCompileCommands.test.ts: a
 * first-class `cmake.exportSarifFile` setting (default true) gates the
 * injection, and the user deciding CMAKE_EXPORT_SARIF themselves — or naming a
 * log with --sarif-output — overrides both the setting and the extension's own
 * default.
 *
 * The injection itself lives in cmakeDriver.ts, which depends on the rest of
 * the extension, so its decision is mirrored here around the real argument
 * helpers.
 */

suite('[Export SARIF Logic]', () => {
    suite('Arguments deciding CMAKE_EXPORT_SARIF', () => {
        test('-D in the attached form, with and without a type', () => {
            expect(argsSpecifyExportSarif(['-DCMAKE_EXPORT_SARIF=ON'])).to.equal(true);
            expect(argsSpecifyExportSarif(['-DCMAKE_EXPORT_SARIF:BOOL=OFF'])).to.equal(true);
        });

        test('-D in the separate form', () => {
            expect(argsSpecifyExportSarif(['-D', 'CMAKE_EXPORT_SARIF=OFF'])).to.equal(true);
            expect(argsSpecifyExportSarif(['-D', 'CMAKE_EXPORT_SARIF:BOOL=ON'])).to.equal(true);
        });

        test('-U in the attached and separate forms', () => {
            expect(argsSpecifyExportSarif(['-UCMAKE_EXPORT_SARIF'])).to.equal(true);
            expect(argsSpecifyExportSarif(['-U', 'CMAKE_EXPORT_SARIF'])).to.equal(true);
        });

        test('-U with a glob expression that covers the variable', () => {
            expect(argsSpecifyExportSarif(['-UCMAKE_EXPORT_*'])).to.equal(true);
            expect(argsSpecifyExportSarif(['-U', 'CMAKE_EXPORT_SARI?'])).to.equal(true);
            expect(argsSpecifyExportSarif(['-UCMAKE_EXPORT_COMPILE_*'])).to.equal(false);
        });

        test('Other variables, or a flag with nothing after it, do not count', () => {
            expect(argsSpecifyExportSarif(['-DCMAKE_EXPORT_SARIF_OTHER=ON'])).to.equal(false);
            expect(argsSpecifyExportSarif(['-DCMAKE_EXPORT_COMPILE_COMMANDS=ON'])).to.equal(false);
            expect(argsSpecifyExportSarif(['-D'])).to.equal(false);
            expect(argsSpecifyExportSarif(['-U'])).to.equal(false);
        });

        test('--sarif-output in either form puts the log in the user\'s hands', () => {
            expect(argsControlSarif(['--sarif-output=out.sarif'])).to.equal(true);
            expect(argsControlSarif(['--sarif-output', 'out.sarif'])).to.equal(true);
            expect(argsControlSarif(['-DCMAKE_BUILD_TYPE=Debug'])).to.equal(false);
        });
    });

    /**
     * Mirrors generateConfigArgsFromPreset(): the preset's cacheVariables are
     * checked by key, so a preset that sets the variable to anything — on, off
     * or null — decides it, as do the preset-derived and configureArgs arguments.
     */
    function shouldInjectInPresetsMode(
        exportSarifSetting: boolean | undefined,
        presetCacheVariables: { [key: string]: unknown },
        args: string[],
        isSarifSupported: boolean = true
    ): boolean {
        const exportSarifFile = exportSarifSetting ?? true;
        const hasExportSarif = Object.prototype.hasOwnProperty.call(presetCacheVariables, 'CMAKE_EXPORT_SARIF')
            || argsControlSarif(args);
        return !hasExportSarif && exportSarifFile && isSarifSupported;
    }

    /**
     * Mirrors generateCMakeSettingsFlags(): configureSettings and the variant
     * have already populated the setting map, and configureArgs plus any extra
     * arguments follow the -D flags on the command line.
     */
    function shouldInjectInKitsMode(
        exportSarifSetting: boolean | undefined,
        settingMap: { [key: string]: unknown },
        args: string[],
        isSarifSupported: boolean = true
    ): boolean {
        const exportSarifFile = exportSarifSetting ?? true;
        const hasExportSarif = Object.prototype.hasOwnProperty.call(settingMap, 'CMAKE_EXPORT_SARIF')
            || argsControlSarif(args);
        return !hasExportSarif && exportSarifFile && isSarifSupported;
    }

    suite('Presets mode (generateConfigArgsFromPreset)', () => {
        test('Extension managed: injects when nothing decides the variable', () => {
            expect(shouldInjectInPresetsMode(undefined, {}, [])).to.equal(true);
            expect(shouldInjectInPresetsMode(true, {}, [])).to.equal(true);
        });

        test('The setting turned off: does not inject', () => {
            expect(shouldInjectInPresetsMode(false, {}, [])).to.equal(false);
        });

        test('The preset sets the variable ON, OFF, or null: does not inject', () => {
            expect(shouldInjectInPresetsMode(true, { CMAKE_EXPORT_SARIF: 'ON' }, [])).to.equal(false);
            expect(shouldInjectInPresetsMode(true, { CMAKE_EXPORT_SARIF: { type: 'BOOL', value: 'OFF' } }, [])).to.equal(false);
            expect(shouldInjectInPresetsMode(true, { CMAKE_EXPORT_SARIF: null }, [])).to.equal(false);
        });

        test('configureArgs decide the variable or name a log: does not inject', () => {
            expect(shouldInjectInPresetsMode(true, {}, ['-DCMAKE_EXPORT_SARIF=OFF'])).to.equal(false);
            expect(shouldInjectInPresetsMode(true, {}, ['-UCMAKE_EXPORT_SARIF'])).to.equal(false);
            expect(shouldInjectInPresetsMode(true, {}, ['--sarif-output=mine.sarif'])).to.equal(false);
            expect(shouldInjectInPresetsMode(true, {}, ['--sarif-output', 'mine.sarif'])).to.equal(false);
        });

        test('CMake older than 4.0: does not inject', () => {
            expect(shouldInjectInPresetsMode(true, {}, [], false)).to.equal(false);
        });
    });

    suite('Kits mode (generateCMakeSettingsFlags)', () => {
        test('Extension managed: injects when nothing decides the variable', () => {
            expect(shouldInjectInKitsMode(undefined, {}, [])).to.equal(true);
            expect(shouldInjectInKitsMode(true, {}, ['--no-warn-unused-cli'])).to.equal(true);
        });

        test('The setting turned off: does not inject', () => {
            expect(shouldInjectInKitsMode(false, {}, [])).to.equal(false);
        });

        test('configureSettings set the variable ON or OFF: does not inject', () => {
            expect(shouldInjectInKitsMode(true, { CMAKE_EXPORT_SARIF: { type: 'BOOL', value: 'TRUE' } }, [])).to.equal(false);
            expect(shouldInjectInKitsMode(true, { CMAKE_EXPORT_SARIF: { type: 'BOOL', value: 'FALSE' } }, [])).to.equal(false);
        });

        test('configureArgs decide the variable or name a log: does not inject', () => {
            expect(shouldInjectInKitsMode(true, {}, ['-D', 'CMAKE_EXPORT_SARIF=OFF'])).to.equal(false);
            expect(shouldInjectInKitsMode(true, {}, ['-U', 'CMAKE_EXPORT_SARIF'])).to.equal(false);
            expect(shouldInjectInKitsMode(true, {}, ['--sarif-output=mine.sarif'])).to.equal(false);
        });

        test('CMake older than 4.0: does not inject', () => {
            expect(shouldInjectInKitsMode(true, {}, [], false)).to.equal(false);
        });
    });
});

suite('[Load SARIF Logic]', () => {
    const binaryDir = path.resolve('build');
    const cwd = path.resolve('work');
    const defaultLog = path.join(binaryDir, '.cmake', 'sarif', 'cmake.sarif');

    const same = (actual: string | undefined, expected: string) =>
        expect(actual && path.normalize(actual)).to.equal(path.normalize(expected));

    test('Without --sarif-output: the default location under the build directory', () => {
        // Where to *look*. Whether CMake wrote anything there is settled by the
        // file itself, not by anything derivable from the arguments — a project
        // can turn SARIF logging on from inside its own CMake code, where no
        // argument and no cache entry will ever show it.
        same(sarifLogPath([], binaryDir, cwd), defaultLog);
        same(sarifLogPath(['-DCMAKE_BUILD_TYPE=Debug'], binaryDir, cwd), defaultLog);
    });

    test('An explicit CMAKE_EXPORT_SARIF in the arguments does not move the log', () => {
        // Neither on nor off changes *where* CMake would write it.
        same(sarifLogPath(['-DCMAKE_EXPORT_SARIF:BOOL=ON'], binaryDir, cwd), defaultLog);
        same(sarifLogPath(['-DCMAKE_EXPORT_SARIF:BOOL=OFF'], binaryDir, cwd), defaultLog);
        same(sarifLogPath(['-UCMAKE_EXPORT_SARIF'], binaryDir, cwd), defaultLog);
    });

    test('--sarif-output names the log outright, in either form', () => {
        const absolute = path.resolve('logs', 'mine.sarif');
        same(sarifLogPath([`--sarif-output=${absolute}`], binaryDir, cwd), absolute);
        same(sarifLogPath(['--sarif-output', absolute], binaryDir, cwd), absolute);
        // It wins even when CMAKE_EXPORT_SARIF is explicitly off: CMake listens
        // to --sarif-output and only that when it is given.
        same(sarifLogPath(['-DCMAKE_EXPORT_SARIF:BOOL=OFF', `--sarif-output=${absolute}`], binaryDir, cwd), absolute);
    });

    test('A relative --sarif-output is relative to the directory CMake runs in', () => {
        same(sarifLogPath(['--sarif-output=logs/mine.sarif'], binaryDir, cwd), path.join(cwd, 'logs', 'mine.sarif'));
    });
});
