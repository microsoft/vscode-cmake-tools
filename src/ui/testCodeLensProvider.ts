import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as logging from '@cmt/logging';
import { ProjectController } from '@cmt/projectController';
import { CMakeProject } from '@cmt/cmakeProject';
import {
    debugTestFromCodeLensCommand,
    makeTestCodeLensCommand,
    normalizeTestName,
    projectIdOf,
    runTestFromCodeLensCommand,
    selectProjectForDocumentTest
} from '@cmt/ui/testCodeLensRouting';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
const log = logging.createLogger('testCodeLensProvider');

/**
 * Provides CodeLens entries for running and debugging tests directly from the editor.
 * Shows inline "Run" and "Debug" buttons at test definition locations.
 */
export class TestCodeLensProvider implements vscode.CodeLensProvider {
    private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

    // Cache test locations by normalized file path.
    private testLocationCache: Map<string, CachedLocations> = new Map();
    private readonly CACHE_VALIDITY_MS = 2000;

    constructor(private projectController: ProjectController) {
        // Watch for test changes to invalidate cache.
        for (const project of projectController.getAllCMakeProjects()) {
            project.cTestController.onTestsChanged(() => {
                this.testLocationCache.clear();
                this.onDidChangeCodeLensesEmitter.fire();
            });
        }
    }

    public provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.CodeLens[] {
        const language = document.languageId;
        if (!['cpp', 'c', 'cmake'].includes(language)) {
            return [];
        }

        try {
            const testLocations = this.getTestLocationsForDocument(document);

            if (token.isCancellationRequested) {
                return [];
            }

            const codeLenses: vscode.CodeLens[] = [];
            for (const testLoc of testLocations) {
                const range = new vscode.Range(
                    new vscode.Position(testLoc.line, 0),
                    new vscode.Position(testLoc.line, 0)
                );

                codeLenses.push(new vscode.CodeLens(range, makeTestCodeLensCommand(
                    runTestFromCodeLensCommand,
                    localize('test.codelens.run', '$(run) Run'),
                    testLoc.testName,
                    testLoc.projectId
                )));

                codeLenses.push(new vscode.CodeLens(range, makeTestCodeLensCommand(
                    debugTestFromCodeLensCommand,
                    localize('test.codelens.debug', '$(debug) Debug'),
                    testLoc.testName,
                    testLoc.projectId
                )));
            }

            return codeLenses;
        } catch (err) {
            log.error(`Error in provideCodeLenses: ${err}`);
            return [];
        }
    }

    public resolveCodeLens(
        codeLens: vscode.CodeLens,
        token: vscode.CancellationToken
    ): vscode.CodeLens {
        if (token.isCancellationRequested) {
            return codeLens;
        }

        return codeLens;
    }

    /**
     * Uses discovered test metadata first, then falls back to parsing doctest macros
     * from the current document when source mapping is unavailable.
     */
    private getTestLocationsForDocument(document: vscode.TextDocument): TestLocation[] {
        const filePath = this.normalizePath(document.uri.fsPath);
        const now = Date.now();

        const cached = this.testLocationCache.get(filePath);
        if (cached && cached.documentVersion === document.version && (now - cached.timestamp) < this.CACHE_VALIDITY_MS) {
            return cached.locations;
        }

        const mappedLocations: TestLocation[] = [];
        const knownTestNames = new Set<string>();
        const normalizedKnownTestNames = new Set<string>();
        const projects = this.projectController.getAllCMakeProjects();

        for (const project of projects) {
            const testsForOutline = project.cTestController.getTestsForOutline(project.codeModelContent);
            for (const testName of project.cTestController.getTestNames() || []) {
                knownTestNames.add(testName);
                normalizedKnownTestNames.add(normalizeTestName(testName));
            }

            for (const testInfo of testsForOutline) {
                const normalizedSourcePath = testInfo.sourceFilePath
                    ? this.normalizePath(testInfo.sourceFilePath)
                    : undefined;

                if (normalizedSourcePath === filePath && testInfo.sourceFileLine !== undefined) {
                    mappedLocations.push({
                        testName: testInfo.name,
                        line: Math.max(0, testInfo.sourceFileLine - 1),
                        executablePath: testInfo.executablePath,
                        projectId: projectIdOf(project)
                    });
                }
            }
        }

        const parsedLocations = this.findDoctestLocations(document, knownTestNames, normalizedKnownTestNames, projects);
        // Keyed by project as well as by test name, so that a same-named test in another project is
        // not dropped in favor of a parsed location belonging to a different project.
        const parsedNames = new Set(parsedLocations.map(location => `${location.projectId}:${location.testName}`));
        const resolvedLocations = parsedLocations.length > 0
            ? [
                ...mappedLocations.filter(location => !parsedNames.has(`${location.projectId}:${location.testName}`)),
                ...parsedLocations
            ]
            : mappedLocations;

        const dedupedLocations = this.deduplicateLocations(resolvedLocations);
        this.testLocationCache.set(filePath, {
            documentVersion: document.version,
            timestamp: now,
            locations: dedupedLocations
        });

        return dedupedLocations;
    }

    /**
     * Fallback for cases where ctest source metadata is missing. A location is only surfaced when
     * the owning project can be determined, so that the CodeLens always routes to a single project.
     */
    private findDoctestLocations(document: vscode.TextDocument, knownTestNames: Set<string>, normalizedKnownTestNames: Set<string>, projects: CMakeProject[]): TestLocation[] {
        const text = document.getText();
        const locations: TestLocation[] = [];
        const doctestRegex = /\bTEST_CASE\s*\(\s*"([^"]+)"/g;
        let match: RegExpExecArray | null;

        while ((match = doctestRegex.exec(text)) !== null) {
            const testName = match[1].trim();
            if (!testName) {
                continue;
            }

            // If tests are already discovered, only show known test names.
            if (knownTestNames.size > 0
                && !knownTestNames.has(testName)
                && !normalizedKnownTestNames.has(normalizeTestName(testName))) {
                continue;
            }

            const project = selectProjectForDocumentTest(projects, document.uri.fsPath, testName);
            if (!project) {
                log.debug(localize('test.codelens.owner.not.found', "Skipping CodeLens for test '{0}': unable to determine the owning CMake project.", testName));
                continue;
            }

            locations.push({
                testName,
                line: document.positionAt(match.index).line,
                executablePath: '',
                projectId: projectIdOf(project)
            });
        }

        return locations;
    }

    private deduplicateLocations(locations: TestLocation[]): TestLocation[] {
        const deduped = new Map<string, TestLocation>();
        for (const location of locations) {
            const key = `${location.projectId}:${location.testName}:${location.line}`;
            if (!deduped.has(key)) {
                deduped.set(key, location);
            }
        }

        return Array.from(deduped.values()).sort((a, b) => a.line - b.line);
    }

    /**
     * Normalize path for cross-platform comparison.
     */
    private normalizePath(filePath: string): string {
        return filePath.toLowerCase().replace(/\\/g, '/');
    }

    dispose() {
        this.onDidChangeCodeLensesEmitter.dispose();
    }
}

interface TestLocation {
    testName: string;
    line: number;
    executablePath: string;
    /** Identity of the CMake project that owns this test; carried in the CodeLens arguments. */
    projectId: string;
}

interface CachedLocations {
    documentVersion: number;
    timestamp: number;
    locations: TestLocation[];
}
