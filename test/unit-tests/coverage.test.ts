import { handleCoverageInfoFiles } from "@cmt/coverage";
import * as vscode from "vscode";
import { expect, getTestResourceFilePath } from "@test/util";
import * as path from "path";

suite('Coverage Handling', () => {

    test('Coverage Info (LCOV)', async () => {
        const filesCoverages: vscode.FileCoverage[] = [];
        const testRun: vscode.TestRun = {
            name: '',
            token: {} as vscode.CancellationToken,
            isPersisted: false,
            enqueued: (_test: vscode.TestItem) => {},
            started: (_test: vscode.TestItem) => {},
            passed: (_test: vscode.TestItem, _duration: number) => {},
            failed: (_test: vscode.TestItem, _message: vscode.TestMessage | vscode.TestMessage[], _duration: number) => {},
            skipped: (_test: vscode.TestItem) => {},
            errored: (_test: vscode.TestItem, _message: vscode.TestMessage | vscode.TestMessage[], _duration: number) => {},
            appendOutput: (_output: string, _location?: vscode.Location, _test?: vscode.TestItem) => {},
            addCoverage: (fileCoverage: vscode.FileCoverage) => {
                filesCoverages.push(fileCoverage);
            },
            end: () => {},
            onDidDispose: (_listener: () => void): vscode.Disposable => new vscode.Disposable(() => {})
        };

        const coverageData = new WeakMap<vscode.FileCoverage, vscode.FileCoverageDetail[]>();
        await handleCoverageInfoFiles(testRun, [getTestResourceFilePath('lcov.info')], coverageData);
        expect(filesCoverages.length).to.eq(1);
        expect(filesCoverages[0].uri.fsPath).to.eq(path.join(path.sep, 'tmp', 'lcov', 'main.cpp'));
        const coverageDetail = coverageData.get(filesCoverages[0]);
        expect(coverageDetail).to.not.be.undefined;

        expect(coverageDetail![0].executed).to.eq(1);
        expect((coverageDetail![0].location as vscode.Position).line).to.eq(2);

        expect(coverageDetail![1].executed).to.eq(1);
        expect((coverageDetail![1].location as vscode.Position).line).to.eq(3);
    });
});
