import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as logging from '@cmt/logging';
import { ProjectController } from '@cmt/projectController';

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

                codeLenses.push(new vscode.CodeLens(range, {
                    title: localize('test.codelens.run', '$(run) Run'),
                    command: 'cmake.runTestFromCodeLens',
                    arguments: [testLoc.testName]
                }));

                codeLenses.push(new vscode.CodeLens(range, {
                    title: localize('test.codelens.debug', '$(debug) Debug'),
                    command: 'cmake.debugTestFromCodeLens',
                    arguments: [testLoc.testName]
                }));
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

        for (const project of this.projectController.getAllCMakeProjects()) {
            const testsForOutline = project.cTestController.getTestsForOutline(project.codeModelContent);
            for (const testName of project.cTestController.getTestNames() || []) {
                knownTestNames.add(testName);
                normalizedKnownTestNames.add(this.normalizeTestName(testName));
            }

            for (const testInfo of testsForOutline) {
                const normalizedSourcePath = testInfo.sourceFilePath
                    ? this.normalizePath(testInfo.sourceFilePath)
                    : undefined;

                if (normalizedSourcePath === filePath && testInfo.sourceFileLine !== undefined) {
                    mappedLocations.push({
                        testName: testInfo.name,
                        line: Math.max(0, testInfo.sourceFileLine - 1),
                        executablePath: testInfo.executablePath
                    });
                }
            }
        }

        const parsedLocations = this.findDoctestLocations(document, knownTestNames, normalizedKnownTestNames);
        const parsedNames = new Set(parsedLocations.map(location => location.testName));
        const resolvedLocations = parsedLocations.length > 0
            ? [
                ...mappedLocations.filter(location => !parsedNames.has(location.testName)),
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
     * Fallback for cases where ctest source metadata is missing.
     */
    private findDoctestLocations(document: vscode.TextDocument, knownTestNames: Set<string>, normalizedKnownTestNames: Set<string>): TestLocation[] {
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
                && !normalizedKnownTestNames.has(this.normalizeTestName(testName))) {
                continue;
            }

            locations.push({
                testName,
                line: document.positionAt(match.index).line,
                executablePath: ''
            });
        }

        return locations;
    }

    private deduplicateLocations(locations: TestLocation[]): TestLocation[] {
        const deduped = new Map<string, TestLocation>();
        for (const location of locations) {
            const key = `${location.testName}:${location.line}`;
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

    private normalizeTestName(testName: string): string {
        return testName
            .toLowerCase()
            .replace(/^\s*scenario:\s*/, '')
            .replace(/\[[^\]]*\]/g, ' ')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    dispose() {
        this.onDidChangeCodeLensesEmitter.dispose();
    }
}

interface TestLocation {
    testName: string;
    line: number;
    executablePath: string;
}

interface CachedLocations {
    documentVersion: number;
    timestamp: number;
    locations: TestLocation[];
}
