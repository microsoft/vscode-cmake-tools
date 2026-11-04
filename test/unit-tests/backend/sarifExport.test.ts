import { expect } from 'chai';
import * as path from 'path';

import { argsSpecifyExportSarif, sarifLogPath } from '@cmt/sarifExport';
import * as util from '@cmt/util';

/**
 * Tests for detecting CMake's SARIF logging
 */
suite('[SARIF Log Export]', () => {
    suite('Arguments that control CMAKE_EXPORT_SARIF', () => {
        test('Not set by default', () => {
            expect(argsSpecifyExportSarif([])).to.equal(false);
        });

        test('Set by -D', () => {
            expect(argsSpecifyExportSarif(['-Wno-dev', '-DCMAKE_EXPORT_SARIF:BOOL=OFF', '-GNinja'])).to.equal(true);
        });

        test('Set by -U of a glob that matches it', () => {
            expect(argsSpecifyExportSarif(['-Wno-dev', '-UCMAKE_EXPORT_*', '-GNinja'])).to.equal(true);
        });
    });

    suite('SARIF log file locations', () => {
        const binaryDir = path.resolve('/project/build');
        const cwd = path.resolve('/project/build');

        test('Finds default SARIF log path', () => {
            expect(sarifLogPath(['-DCMAKE_EXPORT_SARIF:BOOL=TRUE'], binaryDir, cwd))
                .to.equal(path.join(binaryDir, '.cmake', 'sarif', 'cmake.sarif'));
        });

        test('Follows --sarif-output, relative to where CMake runs', () => {
            expect(util.platformPathEquivalent(sarifLogPath(['--sarif-output=logs/out.sarif'], binaryDir, cwd), path.join(cwd, 'logs', 'out.sarif'))).to.equal(true);
        });
    });
});
