import { expect } from 'chai';
import * as path from 'path';

import { argsSpecifyExportSarif, sarifLogPath, sarifOutputPathFromArgs } from '@cmt/sarifExport';

/**
 * Tests for the export and load SARIF logic in cmakeDriver.ts
 *
 * Deciding whether to inject -DCMAKE_EXPORT_SARIF mirrors the
 * -DCMAKE_EXPORT_COMPILE_COMMANDS logic in exportCompileCommands.test.ts: a
 * first-class `cmake.exportSarifFile` setting (default true) gates the
 * injection, and the user deciding CMAKE_EXPORT_SARIF themselves overrides
 * both the setting and the extension's own default. Naming a log with
 * --sarif-output does not: that option only says where one run writes its log,
 * and leaves the cache variable for the extension to set.
 *
 * The injection itself lives in CMakeDriver.configure(), which depends on the
 * rest of the extension, so its decision is mirrored here around the real
 * argument helpers.
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

        test('--sarif-output in either form does not decide the variable', () => {
            expect(argsSpecifyExportSarif(['--sarif-output=out.sarif'])).to.equal(false);
            expect(argsSpecifyExportSarif(['--sarif-output', 'out.sarif'])).to.equal(false);
        });
    });

    /**
     * Mirrors CMakeDriver.addExportSarifFlag(), which decides once, on the
     * final configure arguments. By then every place the user can decide
     * CMAKE_EXPORT_SARIF has been rendered into a -D or -U among them: preset
     * cacheVariables by preset.configureArgs(), configureSettings, variant and
     * kit settings by generateCMakeSettingsFlags(), and configureArgs as given.
     * A preset cache variable set to null never gets that far — preset
     * expansion drops it — so it leaves the variable undecided.
     */
    function shouldInject(
        exportSarifSetting: boolean | undefined,
        finalArgs: string[],
        isSarifSupported: boolean = true
    ): boolean {
        const exportSarifFile = exportSarifSetting ?? true;
        return exportSarifFile && isSarifSupported && !argsSpecifyExportSarif(finalArgs);
    }

    suite('Injection on the final configure arguments', () => {
        test('Extension managed: injects when nothing decides the variable', () => {
            expect(shouldInject(undefined, [])).to.equal(true);
            expect(shouldInject(true, ['--no-warn-unused-cli'])).to.equal(true);
        });

        test('The setting turned off: does not inject', () => {
            expect(shouldInject(false, [])).to.equal(false);
        });

        test('A preset sets the variable ON or OFF: does not inject', () => {
            // As preset.configureArgs() renders string and typed cacheVariables.
            expect(shouldInject(true, ['-DCMAKE_EXPORT_SARIF=ON'])).to.equal(false);
            expect(shouldInject(true, ['-DCMAKE_EXPORT_SARIF:BOOL=OFF'])).to.equal(false);
        });

        test('configureSettings set the variable ON or OFF: does not inject', () => {
            // As generateCMakeSettingsFlags() renders the setting map.
            expect(shouldInject(true, ['-DCMAKE_EXPORT_SARIF:BOOL=TRUE'])).to.equal(false);
            expect(shouldInject(true, ['-DCMAKE_EXPORT_SARIF:BOOL=FALSE'])).to.equal(false);
        });

        test('configureArgs decide the variable: does not inject', () => {
            expect(shouldInject(true, ['-DCMAKE_EXPORT_SARIF=OFF'])).to.equal(false);
            expect(shouldInject(true, ['-D', 'CMAKE_EXPORT_SARIF=OFF'])).to.equal(false);
            expect(shouldInject(true, ['-UCMAKE_EXPORT_SARIF'])).to.equal(false);
            expect(shouldInject(true, ['-U', 'CMAKE_EXPORT_SARIF'])).to.equal(false);
        });

        test('configureArgs name a log with --sarif-output: still injects', () => {
            expect(shouldInject(true, ['--sarif-output=mine.sarif'])).to.equal(true);
            expect(shouldInject(true, ['--sarif-output', 'mine.sarif'])).to.equal(true);
            expect(shouldInject(false, ['--sarif-output=mine.sarif'])).to.equal(false);
        });

        test('CMake older than 4.0: does not inject', () => {
            expect(shouldInject(true, [], false)).to.equal(false);
        });
    });
});

suite('CMake SARIF output argument', () => {
    test('Reports no path when the option is absent', () => {
        expect(sarifOutputPathFromArgs(['-S', 'src', '-B', 'build', '-DCMAKE_BUILD_TYPE=Debug'])).to.be.undefined;
    });

    test('Finds a path given as --sarif-output=<path>', () => {
        expect(sarifOutputPathFromArgs(['-B', 'build', '--sarif-output=mine.sarif'])).to.eq('mine.sarif');
    });

    test('Finds a path given as --sarif-output <path>', () => {
        expect(sarifOutputPathFromArgs(['-B', 'build', '--sarif-output', 'mine.sarif'])).to.eq('mine.sarif');
    });

    test('Takes the last path when the option is repeated, as CMake does', () => {
        expect(sarifOutputPathFromArgs(['--sarif-output=first.sarif', '--sarif-output=second.sarif'])).to.eq('second.sarif');
    });

    test('Ignores a trailing --sarif-output with no path after it', () => {
        expect(sarifOutputPathFromArgs(['-B', 'build', '--sarif-output'])).to.be.undefined;
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
