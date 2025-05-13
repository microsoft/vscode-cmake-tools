import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as logging from '@cmt/logging';
import { demangle } from 'demangler-js';
import { platformNormalizePath } from './util';

const { lcovParser } = require("@friedemannsommer/lcov-parser");

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('ctest-coverage');

/**
 * Processes coverage information files and updates the provided test run with coverage data.
 *
 * @param run - The test run to update with coverage data.
 * @param coverageInfoFiles - An array of file paths to coverage information files.
 * @param coverageData - A WeakMap to store the coverage data, mapping `vscode.FileCoverage` to an array of `vscode.FileCoverageDetail`.
 *
 * This function reads each coverage information file, parses its contents, and extracts coverage data for lines, branches, and functions.
 * It then creates `vscode.FileCoverage` objects and populates them with the extracted data, including branch coverage and function declarations.
 * The coverage data is stored in the provided `coverageData` WeakMap and added to the test run.
 *
 * If a coverage information file cannot be opened, a warning is logged and the file is skipped.
 */
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
            const coverage = new vscode.FileCoverage(vscode.Uri.file(platformNormalizePath(section.path.trim())),
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
                const demangledName = demangle(declaration.name);
                declarations.push(new vscode.DeclarationCoverage(demangledName, declaration.hit,
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
