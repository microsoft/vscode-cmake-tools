import * as vscode from 'vscode';
import { lcovParser } from "@friedemannsommer/lcov-parser";
import * as nls from 'vscode-nls';
import * as logging from '@cmt/logging';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('ctest-coverage');

export async function handleCoverageInfoFiles(run: vscode.TestRun, coverageInfoFiles: string[], coverageData: WeakMap<vscode.FileCoverage, vscode.FileCoverageDetail[]>) {
    for (const coverageInfoFile of coverageInfoFiles) {
        let contents: Uint8Array;
        try {
            contents = await vscode.workspace.fs.readFile(vscode.Uri.file(coverageInfoFile));
        } catch (e) {
            log.warning(localize('test.openCoverageInfoFile', 'Could not open coverage info file: {0}. Skipping...', coverageInfoFile));
            return;
        }
        const sections = await lcovParser({ from: contents });
        for (const section of sections) {
            const coverage = new vscode.FileCoverage(vscode.Uri.file(section.path),
                new vscode.TestCoverageCount(
                    section.lines.hit,
                    section.lines.instrumented
                ), new vscode.TestCoverageCount(
                    section.branches.hit,
                    section.branches.instrumented
                ), new vscode.TestCoverageCount(
                    section.functions.hit,
                    section.functions.instrumented
                ));

            const lineBranches = new Map<number, vscode.BranchCoverage[]>();
            for (const branch of section.branches.details) {
                const branchCoverage = new vscode.BranchCoverage(branch.hit,
                    new vscode.Position(branch.line - 1, 0), branch.branch);

                const curr = lineBranches.get(branch.line);
                if (curr === undefined) {
                    lineBranches.set(branch.line, [branchCoverage]);
                } else {
                    curr.push(branchCoverage);
                    lineBranches.set(branch.line, curr);
                }
            }

            const declarations: vscode.DeclarationCoverage[] = [];
            for (const declaration of section.functions.details) {
                declarations.push(new vscode.DeclarationCoverage(declaration.name, declaration.hit,
                    new vscode.Position(declaration.line - 1, 0)));
            }

            const statements: vscode.StatementCoverage[] = [];
            for (const line of section.lines.details) {
                statements.push(new vscode.StatementCoverage(line.hit,
                    new vscode.Position(line.line - 1, 0),
                    lineBranches.get(line.line) ?? []));
            }
            coverageData.set(coverage, [...statements, ...declarations]);
            run.addCoverage(coverage);
        }
    }
}
