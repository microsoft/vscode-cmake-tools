/* eslint-disable no-unused-expressions */
import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as Sarif from 'sarif';
import * as vscode from 'vscode';

import { fileDiagnostics, watchSarifLog } from '@cmt/diagnostics/sarif';
import { FileDiagnostic } from '@cmt/diagnostics/util';
import { lightNormalizePath } from '@cmt/util';
import { getTestResourceFilePath } from '@test/util';

function readSampleLog(): Sarif.Log {
    return JSON.parse(fs.readFileSync(getTestResourceFilePath('TestSarif-cmake-4.5.sarif'), 'utf8')) as Sarif.Log;
}

suite('Read SARIF diagnostics', () => {
    const diagnostics = fileDiagnostics(readSampleLog());
    const cmakeLists = '/home/user/sarif/src/CMakeLists.txt';

    function withMessage(message: string) {
        return diagnostics.filter(d => d.diag.message === message);
    }

    function relatedOf(diag: FileDiagnostic) {
        return diag.diag.relatedInformation!.map(r => [r.message, r.location.uri.path, r.location.range.start.line]);
    }

    test('Parse warning info', () => {
        const [diag] = withMessage('Top-level warning');
        expect(diag.filepath).to.eq(cmakeLists);
        expect(diag.diag.severity).to.eq(vscode.DiagnosticSeverity.Warning);
        expect(diag.diag.source).to.eq('cmake');
        expect(diag.diag.code).to.eq('CMake.Warning');
        expect(diag.diag.range.start.line).to.eq(3);
        expect(diag.diag.relatedInformation).to.be.empty;
    });

    test('Report an empty message at its location', () => {
        const [diag] = withMessage('CMake.Warning');
        expect(diag.filepath).to.eq(cmakeLists);
        expect(diag.diag.range.start.line).to.eq(4);
    });

    test('Parse error from deferred call location', () => {
        const [diag] = withMessage('A deferred error');
        expect(diag.diag.severity).to.eq(vscode.DiagnosticSeverity.Error);
        expect(diag.diag.code).to.eq('CMake.FatalError');
        expect(diag.diag.range.start.line).to.eq(18);
        expect(relatedOf(diag)).to.deep.eq([['Deferred to the end of CMakeLists.txt', cmakeLists, 18]]);
    });

    test('Parse location relative to the build tree', () => {
        const [diag] = withMessage('Warning from a file in the build tree');
        expect(diag.filepath).to.eq('/home/user/sarif/src/build/generated.cmake');
        expect(diag.diag.range.start.line).to.eq(0);
    });

    test('Parse absolute location', () => {
        const [diag] = withMessage('Warning from a file outside the source tree');
        expect(diag.filepath).to.eq('/home/user/sarif/outside/outside.cmake');
        expect(diag.diag.range.start.line).to.eq(0);
    });

    test('Parse a call stack', () => {
        const [diag] = withMessage('Warning from a nested function call');
        expect(diag.diag.range.start.line).to.eq(7);
        expect(relatedOf(diag)).to.deep.eq([
            ["In call to 'inner' here", cmakeLists, 10],
            ["In call to 'outer' here", cmakeLists, 12]
        ]);
    });

    test('Parse location in nested evaluated code at the outermost call', () => {
        const [diag] = withMessage('Warning from nested evaluated code');
        expect(diag.filepath).to.eq(cmakeLists);
        expect(diag.diag.range.start.line).to.eq(22);
        expect(relatedOf(diag)).to.deep.eq([
            ["In call to 'cmake_language' here", cmakeLists, 22],
            ["In call to 'cmake_language' here", cmakeLists, 22]
        ]);
    });

    test('Parse location in a function defined in evaluated code at the definition', () => {
        const [diag] = withMessage('Warning from a function defined in evaluated code');
        expect(diag.filepath).to.eq(cmakeLists);
        expect(diag.diag.range.start.line).to.eq(25);
        expect(relatedOf(diag)).to.deep.eq([
            ["In call to 'defined_in_eval' here", cmakeLists, 31],
            ["In call to 'calls_defined_in_eval' here", cmakeLists, 33]
        ]);
    });

    test('Parse a call deferred by evaluated code', () => {
        const [diag] = withMessage('Warning from a call deferred by evaluated code');
        expect(diag.diag.range.start.line).to.eq(36);
        expect(relatedOf(diag)).to.deep.eq([
            ["In call to 'deferred_from_eval' here", cmakeLists, 38],
            ['Deferred to the end of CMakeLists.txt', cmakeLists, 38]
        ]);
    });

    test('Show a command with no line called from evaluated code at that call', () => {
        const [diag] = withMessage('list does not recognize sub-command watched_in_eval');
        expect(diag.filepath).to.eq(cmakeLists);
        expect(diag.diag.range.start.line).to.eq(43);
        expect(relatedOf(diag)).to.deep.eq([
            ["In call to 'set' here", cmakeLists, 43],
            ["In call to 'cmake_language' here", cmakeLists, 43]
        ]);
    });

    test('Show a problem with a whole file at its caller', () => {
        const [diag] = withMessage('cmake_policy PUSH without matching POP');
        expect(diag.filepath).to.eq(cmakeLists);
        expect(diag.diag.range.start.line).to.eq(51);
        expect(relatedOf(diag)).to.deep.eq([["In call to 'include' here", cmakeLists, 51]]);
    });

    test('Ignore results with no usable location', () => {
        const log = readSampleLog();
        // CMake gives no line or caller for the unmatched cmake_policy(PUSH) in
        // the top-level file, leaving only the one from the included file.
        expect(log.runs[0].results!.filter(r => r.message.text === 'cmake_policy PUSH without matching POP').length).to.eq(2);
        expect(withMessage('cmake_policy PUSH without matching POP').length).to.eq(1);
        expect(diagnostics.length).to.eq(log.runs[0].results!.length - 1);

        // Delete base URI information to simulate missing context.
        delete log.runs[0].originalUriBaseIds;
        // Only absolute paths can be resolved now; others should be ignored.
        const located = fileDiagnostics(log);
        expect(located.length).to.eq(1);
        expect(located[0].filepath).to.eq('/home/user/sarif/outside/outside.cmake');
    });
});

suite('Read SARIF configure log', () => {
    let dir: string;
    let logPath: string;

    function writeLog(message?: string) {
        const log: Sarif.Log = {
            version: '2.1.0',
            runs: [{
                tool: { driver: { name: 'CMake' } },
                originalUriBaseIds: { CMAKE_SOURCE_DIR: { uri: `file://${dir.replace(/\\/g, '/')}/` } },
                results: message === undefined ? [] : [{
                    level: 'warning',
                    message: { text: message },
                    locations: [{ physicalLocation: { artifactLocation: { uri: 'CMakeLists.txt', uriBaseId: 'CMAKE_SOURCE_DIR' }, region: { startLine: 3 } } }]
                }]
            }]
        };
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.writeFileSync(logPath, JSON.stringify(log));
    }

    setup(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmt-sarif-'));
        logPath = path.join(dir, '.cmake', 'sarif', 'cmake.sarif');
    });

    teardown(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('Ignores missing log', async () => {
        const read = await watchSarifLog(logPath);
        expect(await read()).to.be.null;
    });

    test('Reads generated SARIF log file', async () => {
        const read = await watchSarifLog(logPath);
        writeLog('Written by this run');
        const diags = await read();
        expect(diags).to.have.lengthOf(1);
        expect(diags![0].diag.message).to.eq('Written by this run');
        expect(diags![0].filepath).to.eq(lightNormalizePath(path.join(dir, 'CMakeLists.txt')));
        expect(diags![0].diag.range.start.line).to.eq(2);
    });

    test('Reads log with no results', async () => {
        const read = await watchSarifLog(logPath);
        writeLog();
        expect(await read()).to.deep.equal([]);
    });

    test('Ignores stale log file', async () => {
        writeLog('Written by an earlier run');
        const read = await watchSarifLog(logPath);
        expect(await read()).to.be.null;
    });

    test('Reads updated log file', async () => {
        writeLog('Written by an earlier run');
        const read = await watchSarifLog(logPath);
        writeLog('Rewritten by this run');
        const diags = await read();
        expect(diags!.map(d => d.diag.message)).to.deep.equal(['Rewritten by this run']);
    });

    test('Ignores broken log file', async () => {
        const read = await watchSarifLog(logPath);
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.writeFileSync(logPath, '{ "runs": [');
        expect(await read()).to.be.null;
    });
});
