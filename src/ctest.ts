import { DirectoryContext } from '@cmt/workspace';
import * as path from 'path';
import * as vscode from 'vscode';
import * as xml2js from 'xml2js';
import * as zlib from 'zlib';

import { CMakeDriver } from '@cmt/drivers/drivers';
import * as logging from './logging';
import { fs } from './pr';
import { OutputConsumer } from './proc';
import * as util from './util';
import * as nls from 'vscode-nls';
import { testArgs, TestPreset } from './preset';
import { expandString } from './expand';
import * as proc from '@cmt/proc';
import { ProjectController } from './projectController';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('ctest');

/**
 * Information about a CTest test
 */
export interface CTest {
    id: number;
    name: string;
}

interface SiteAttributes {}

type TestStatus = ('failed' | 'notrun' | 'passed');

export interface FailingTestDecoration {
    fileName: string;
    lineNumber: number;
    hoverMessage: string;
}

export interface TestMeasurement {
    type: string;
    name: string;
    value: any;
}

export interface Test {
    status: TestStatus;
    fullCommandLine: string;
    fullName: string;
    name: string;
    path: string;
    measurements: Map<string, TestMeasurement>;
    output: string;
}

export interface TestingData {
    // Fill out when we need all the attributes
    testList: string[];
    test: Test[];
}

export interface SiteData {
    $: SiteAttributes;
    testing: TestingData;
}

export interface CTestResults { site: SiteData }

interface EncodedMeasurementValue {
    $: { encoding?: BufferEncoding; compression?: string };
    _: string;
}

interface MessyResults {
    Site: {
        $: {};
        Testing: {
            TestList: { Test: string[] }[];
            EndDateTime: string[];
            EndTestTime: string[];
            ElapsedMinutes: string[];
            Test: {
                $: { Status: TestStatus };
                FullCommandLine: string[];
                FullName: string[];
                Name: string[];
                Path: string[];
                Results: {
                    NamedMeasurement:
                    { $: { type: string; name: string }; Value: string[] }[];
                    Measurement: { Value: [EncodedMeasurementValue | string] }[];
                }[];
            }[];
        }[];
    };
}

function parseXmlString<T>(xml: string): Promise<T> {
    return new Promise((resolve, reject) => {
        xml2js.parseString(xml, (err, result) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
}

function decodeOutputMeasurement(node: EncodedMeasurementValue | string): string {
    if (typeof node === 'string') {
        return node;
    }
    let buffer = !!node.$.encoding ? Buffer.from(node._, node.$.encoding) : Buffer.from(node._, 'utf-8');
    if (!!node.$.compression) {
        buffer = zlib.unzipSync(buffer);
    }
    return buffer.toString('utf-8');
}

function cleanupResultsXml(messy: MessyResults): CTestResults {
    const testingHead = messy.Site.Testing[0];
    if (testingHead.TestList.length === 1 && (testingHead.TestList[0] as any as string) === '') {
        // XML parsing is obnoxious. This condition means that there are no tests,
        // but CTest is still enabled.
        return {
            site: {
                $: messy.Site.$,
                testing: {
                    testList: [],
                    test: []
                }
            }
        };
    }
    return {
        site: {
            $: messy.Site.$,
            testing: {
                testList: testingHead.TestList[0].Test,
                test: testingHead.Test.map((test): Test => {
                    const measurements = new Map<string, TestMeasurement>();
                    for (const namedMeasurement of test.Results[0].NamedMeasurement) {
                        measurements.set(namedMeasurement.$.name, {
                            type: namedMeasurement.$.type,
                            name: namedMeasurement.$.name,
                            value: decodeOutputMeasurement(namedMeasurement.Value[0])
                        });
                    }
                    return {
                        fullName: test.FullName[0],
                        fullCommandLine: test.FullCommandLine[0],
                        name: test.Name[0],
                        path: test.Path[0],
                        status: test.$.Status,
                        measurements,
                        output: decodeOutputMeasurement(test.Results[0].Measurement[0].Value[0])
                    };
                })
            }
        }
    };
}

export async function readTestResultsFile(testXml: string): Promise<CTestResults | undefined> {
    try {
        const content = (await fs.readFile(testXml)).toString();
        const data = await parseXmlString(content) as MessyResults;
        const clean = cleanupResultsXml(data);
        return clean;
    } catch {
        return undefined;
    }
}

export function parseCatchTestOutput(output: string): FailingTestDecoration[] {
    const untrimmedLines = output.split('\n');
    const lines = untrimmedLines.map(l => l.trim());
    const decorations: FailingTestDecoration[] = [];
    for (let cursor = 0; cursor < lines.length; ++cursor) {
        const line = lines[cursor];
        const regex = process.platform === 'win32' ? /^(.*)\((\d+)\): FAILED:/ : /^(.*):(\d+): FAILED:/;
        const result = regex.exec(line);
        if (result) {
            const [, file, arg2] = result;
            const lineNumber = parseInt(arg2) - 1;
            let message = '~~~c++\n';
            for (let i = 0; cursor + i < untrimmedLines.length; ++i) {
                const untrimmedLine = untrimmedLines[cursor + i];
                if (untrimmedLine.startsWith('======') || untrimmedLine.startsWith('------')) {
                    break;
                }
                message += untrimmedLine + '\n';
            }

            decorations.push({
                fileName: file,
                lineNumber: lineNumber,
                hoverMessage: `${message}\n~~~`
            });
        }
    }
    return decorations;
}

export async function parseTestOutput(output: string): Promise<FailingTestDecoration[]> {
    if (/is a Catch .* host application\./.test(output)) {
        return parseCatchTestOutput(output);
    } else {
        return [];
    }
}

export class DecorationManager {
    constructor() {
        vscode.window.onDidChangeActiveTextEditor(_ => this.refreshActiveEditorDecorations());
    }

    private readonly failingTestDecorationType = vscode.window.createTextEditorDecorationType({
        borderColor: 'rgba(255, 0, 0, 0.2)',
        borderWidth: '1px',
        borderRadius: '3px',
        borderStyle: 'solid',
        cursor: 'pointer',
        backgroundColor: 'rgba(255, 0, 0, 0.1)',
        overviewRulerColor: 'red',
        overviewRulerLane: vscode.OverviewRulerLane.Center,
        after: {
            contentText: 'Failed',
            backgroundColor: 'darkred',
            margin: '10px'
        }
    });

    private _binaryDir: string = '';
    get binaryDir(): string {
        return this._binaryDir;
    }
    set binaryDir(v: string) {
        this._binaryDir = v;
        this.refreshActiveEditorDecorations();
    }

    private _showCoverageData: boolean = false;
    get showCoverageData(): boolean {
        return this._showCoverageData;
    }
    set showCoverageData(v: boolean) {
        this._showCoverageData = v;
        this.refreshAllEditorDecorations();
    }

    private refreshAllEditorDecorations() {
        for (const editor of vscode.window.visibleTextEditors) {
            this.refreshEditorDecorations(editor);
        }
    }

    private refreshActiveEditorDecorations() {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            // Seems that sometimes the activeTextEditor is undefined. A VSCode bug?
            this.refreshEditorDecorations(editor);
        }
    }

    private refreshEditorDecorations(editor: vscode.TextEditor) {
        const fails: vscode.DecorationOptions[] = [];
        const editorFile = util.lightNormalizePath(editor.document.fileName);
        for (const decor of this.failingTestDecorations) {
            const decoratedFile = util.lightNormalizePath(path.isAbsolute(decor.fileName) ? decor.fileName : path.join(this.binaryDir, decor.fileName));
            if (editorFile !== decoratedFile) {
                continue;
            }
            try {
                const fileLine = editor.document.lineAt(decor.lineNumber);
                const range = new vscode.Range(decor.lineNumber, fileLine.firstNonWhitespaceCharacterIndex, decor.lineNumber, fileLine.range.end.character);
                fails.push({ hoverMessage: decor.hoverMessage, range });
            } catch {
            }
        }
        editor.setDecorations(this.failingTestDecorationType, fails);
    }

    private _failingTestDecorations: FailingTestDecoration[] = [];
    clearFailingTestDecorations() {
        this.failingTestDecorations = [];
    }
    addFailingTestDecoration(dec: FailingTestDecoration) {
        this._failingTestDecorations.push(dec);
        this.refreshActiveEditorDecorations();
    }
    get failingTestDecorations(): FailingTestDecoration[] {
        return this._failingTestDecorations;
    }
    set failingTestDecorations(v: FailingTestDecoration[]) {
        this._failingTestDecorations = v;
        this.refreshAllEditorDecorations();
    }

    // XXX: Revive coverage decorations?
    // private _coverageDecorations : CoverageDecoration[] = [];
    // get coverageDecorations() : CoverageDecoration[] {
    //   return this._coverageDecorations;
    // }
    // set coverageDecorations(v : CoverageDecoration[]) {
    //   this._coverageDecorations = v;
    //   this._refreshAllEditorDecorations();
    // }
}

class CTestOutputLogger implements OutputConsumer {
    output(line: string) {
        log.info(line);
    }
    error(line: string) {
        this.output(line);
    }
}

export class CTestDriver implements vscode.Disposable {
    /**
     * @param projectController Required for test explorer to work properly. Setting as optional to avoid breaking tests.
     */
    constructor(readonly ws: DirectoryContext, private readonly projectController?: ProjectController) {}
    private readonly decorationManager = new DecorationManager();

    private _testingEnabled: boolean = false;
    get testingEnabled(): boolean {
        return this._testingEnabled;
    }
    set testingEnabled(v: boolean) {
        this._testingEnabled = v;
        this.testingEnabledEmitter.fire(v);
    }

    private readonly testingEnabledEmitter = new vscode.EventEmitter<boolean>();
    readonly onTestingEnabledChanged = this.testingEnabledEmitter.event;

    dispose() {
        this.testingEnabledEmitter.dispose();
        this.testsChangedEmitter.dispose();
    }

    /**
     * Holds the most recent test informations
     */
    private _tests: CTest[] = [];
    get tests(): CTest[] {
        return this._tests;
    }
    set tests(v: CTest[]) {
        this._tests = v;
        this.testsChangedEmitter.fire(v);
    }

    private readonly testsChangedEmitter = new vscode.EventEmitter<CTest[]>();
    readonly onTestsChanged = this.testsChangedEmitter.event;

    private testItemCollectionToArray(collection: vscode.TestItemCollection): vscode.TestItem[] {
        if (!collection) {
            return [];
        }
        const items: vscode.TestItem[] = [];
        collection.forEach(item => items.push(item));
        return items;
    };

    private async getCTestArgs(driver: CMakeDriver, customizedTask: boolean = false, testPreset?: TestPreset): Promise<string[]> {
        let ctestArgs: string[];
        if (customizedTask && testPreset) {
            ctestArgs = ['-T', 'test'].concat(testArgs(testPreset));
        } else if (!customizedTask && driver.useCMakePresets) {
            if (!driver.testPreset) {
                throw(localize('test.preset.not.set', 'Test preset is not set'));
            }
            // Add a few more args so we can show the result in status bar
            ctestArgs = ['-T', 'test'].concat(testArgs(driver.testPreset));
        } else {
            const configuration = driver.currentBuildType;
            const opts = driver.expansionOptions;
            const jobs = await expandString(this.ws.config.numCTestJobs, opts);
            const defaultArgs = [];
            for (const value of this.ws.config.ctestDefaultArgs) {
                defaultArgs.push(await expandString(value, opts));
            }
            const args = [];
            for (const value of this.ws.config.ctestArgs) {
                args.push(await expandString(value, opts));
            }
            ctestArgs = [`-j${jobs}`, '-C', configuration].concat(defaultArgs, args);
        }
        return ctestArgs;
    }

    public async runCTest(driver: CMakeDriver, customizedTask: boolean = false, testPreset?: TestPreset, consumer?: proc.OutputConsumer): Promise<number> {
        if (!customizedTask) {
            // We don't want to focus on log channel when running tasks.
            log.showChannel();
        }

        if (!testExplorer) {
            await this.refreshTests(driver);
        }

        if (!testExplorer) {
            log.info(localize('no.tests.found', 'No tests found'));
            return -1;
        } else {
            this.decorationManager.failingTestDecorations = [];

            const tests = this.testItemCollectionToArray(testExplorer.items);
            const run = testExplorer.createTestRun(new vscode.TestRunRequest());
            const ctestArgs = await this.getCTestArgs(driver, customizedTask, testPreset);
            const returnCode = await this.runCTestHelper(tests, run, driver, undefined, ctestArgs, undefined, customizedTask, consumer);
            run.end();
            return returnCode;
        }
    }

    private ctestErrored(test: vscode.TestItem, run: vscode.TestRun, message: vscode.TestMessage): void {
        if (test.children.size > 0) {
            const children = this.testItemCollectionToArray(test.children);
            for (const child of children) {
                this.ctestErrored(child, run, message);
            }
        } else {
            run.errored(test, message);
        }
    }

    private async runCTestHelper(tests: vscode.TestItem[], run: vscode.TestRun, driver?: CMakeDriver, ctestPath?: string, ctestArgs?: string[], cancellation?: vscode.CancellationToken, customizedTask: boolean = false, consumer?: proc.OutputConsumer): Promise<number> {
        let returnCode: number = 0;
        for (const test of tests) {
            if (cancellation && cancellation.isCancellationRequested) {
                run.skipped(test);
                continue;
            }

            let _driver: CMakeDriver | null;
            if (driver) {
                _driver = driver;
            } else {
                const folder = test.parent ? test.parent.id : test.id;
                if (!this.projectController) {
                    this.ctestErrored(test, run, { message: localize('no.project.found', 'No project found for folder {0}', folder) });
                    continue;
                }
                const project = await this.projectController.getProjectForFolder(folder);
                if (!project) {
                    this.ctestErrored(test, run, { message: localize('no.project.found', 'No project found for folder {0}', folder) });
                    continue;
                }
                _driver = await project.getCMakeDriverInstance();
                if (!_driver) {
                    this.ctestErrored(test, run, { message: localize('no.driver.found', 'No driver found for folder {0}', folder) });
                    continue;
                }
            }

            let _ctestPath: string | null;
            if (ctestPath) {
                _ctestPath = ctestPath;
            } else {
                _ctestPath = await this.ws.getCTestPath(_driver.cmakePathFromPreset);
                if (_ctestPath === null) {
                    this.ctestErrored(test, run, { message: localize('ctest.path.not.set', 'CTest path is not set') });
                    continue;
                }
            }

            let _ctestArgs: string[] | undefined;
            if (ctestArgs) {
                _ctestArgs = ctestArgs;
            } else {
                _ctestArgs = await this.getCTestArgs(_driver, customizedTask);
            }

            if (test.children.size > 0) {
                // Shouldn't reach here now, but not hard to write so keeping it in case we want to have more complicated test hierarchies
                const children = this.testItemCollectionToArray(test.children);
                if (await this.runCTestHelper(children, run, _driver, _ctestPath, _ctestArgs, cancellation, customizedTask, consumer)) {
                    returnCode = -1;
                }
            } else {
                run.started(test);

                const testResults = await this.runCTestImpl(_driver, _ctestPath, _ctestArgs, customizedTask, consumer, test.id);

                if (testResults) {
                    if (testResults.site.testing.test.length === 1) {
                        run.appendOutput(testResults.site.testing.test[0].output);

                        const durationStr = testResults.site.testing.test[0].measurements.get("Execution Time")?.value;
                        const duration = durationStr ? parseFloat(durationStr) * 1000 : undefined;

                        if (testResults.site.testing.test[0].status === 'passed') {
                            run.passed(test, duration);
                        } else {
                            run.failed(
                                test,
                                new vscode.TestMessage(localize('test.failed', 'Test failed with exit code {0}.', testResults.site.testing.test[0].measurements.get("Exit Value")?.value)),
                                duration
                            );
                            returnCode = -1;
                        }
                    } else {
                        run.failed(test, new vscode.TestMessage(localize('expect.one.test.results', 'Expecting one test result.')));
                        returnCode = -1;
                    }
                } else {
                    run.failed(test, new vscode.TestMessage(localize('test.results.not.found', 'Test results not found.')));
                    returnCode = -1;
                }
            }
        }

        return returnCode;
    };

    private async runCTestImpl(driver: CMakeDriver, ctestPath: string, ctestArgs: string[], customizedTask: boolean = false, consumer?: proc.OutputConsumer, testName?: string): Promise<CTestResults | undefined> {
        this.decorationManager.clearFailingTestDecorations();

        if (testName) {
            // Override the existing -R arguments
            ctestArgs.push('-R', testName);
        }

        const child = driver.executeCommand(
            ctestPath,
            ctestArgs,
            ((customizedTask && consumer) ? consumer : new CTestOutputLogger()),
            { environment: await driver.getCTestCommandEnvironment(), cwd: driver.binaryDir });
        const res = await child.result;
        if (res.retc === null) {
            log.info(localize('ctest.run.terminated', 'CTest run was terminated'));
        } else {
            log.info(localize('ctest.finished.with.code', 'CTest finished with return code {0}', res.retc));
        }

        const tagFile = path.join(driver.binaryDir, 'Testing', 'TAG');
        const tag = (await fs.exists(tagFile)) ? (await fs.readFile(tagFile)).toString().split('\n')[0].trim() : null;
        const tagDir = tag ? path.join(driver.binaryDir, 'Testing', tag) : null;
        const resultsFile = tagDir ? path.join(tagDir, 'Test.xml') : null;
        if (resultsFile && await fs.exists(resultsFile)) {
            // TODO: Should we handle the case where resultsFiles doesn't exist?
            console.assert(tagDir);
            return this.loadTestResults(resultsFile);
        }

        return undefined;
    }

    /**
     * @brief Refresh the list of CTest tests
     * @returns 0 when successful
     */
    async refreshTests(driver: CMakeDriver): Promise<number> {
        if (util.isTestMode()) {
            // ProjectController can't be initialized in test mode, so we don't have a usable test explorer
            return 0;
        }

        const initializedTestExplorer = this.ensureTestExplorerInitialized();
        const sourceDir = util.platformNormalizePath(driver.sourceDir);
        const testExplorerRoot = initializedTestExplorer.items.get(sourceDir);
        if (!testExplorerRoot) {
            throw(localize('folder.not.found.in.test.explorer', 'Folder is not found in Test Explorer: {0}', sourceDir));
        }
        // Clear all children and re-add later
        testExplorerRoot.children.replace([]);

        // TODO: There's no way to mark tests as outdated now.
        const ctestFile = path.join(driver.binaryDir, 'CTestTestfile.cmake');
        if (!(await fs.exists(ctestFile))) {
            this.testingEnabled = false;
            return -1;
        }
        this.decorationManager.binaryDir = driver.binaryDir;
        this.testingEnabled = true;

        const ctestpath = await this.ws.getCTestPath(driver.cmakePathFromPreset);
        if (ctestpath === null) {
            log.info(localize('ctest.path.not.set', 'CTest path is not set'));
            return -2;
        }

        const buildConfigArgs: string[] = [];
        if (driver.useCMakePresets) {
            const buildConfig = driver.testPreset?.configuration;
            if (buildConfig) {
                buildConfigArgs.push('-C', buildConfig);
            }
        } else {
            buildConfigArgs.push('-C', driver.currentBuildType);
        }
        const result = await driver.executeCommand(ctestpath, ['-N', ...buildConfigArgs], undefined, { cwd: driver.binaryDir, silent: true }).result;
        if (result.retc !== 0) {
            // There was an error running CTest. Odd...
            log.error(localize('ctest.error', 'There was an error running ctest to determine available test executables'));
            return result.retc || -3;
        }
        this.tests = result.stdout?.split('\n')
            .map(l => l.trim())
            .filter(l => /^Test\s*#(\d+):\s(.*)/.test(l))
            .map(l => /^Test\s*#(\d+):\s(.*)/.exec(l)!)
            .map(([, id, tname]) => ({ id: parseInt(id!), name: tname! })) ?? [];

        // Add tests to the test explorer
        for (const test of this.tests) {
            testExplorerRoot.children.add(initializedTestExplorer.createTestItem(test.name, test.name));
        }

        return 0;
    }

    private async loadTestResults(testXml: string): Promise<CTestResults | undefined> {
        const testResults = await readTestResultsFile(testXml);
        const failing = testResults?.site.testing.test.filter(t => t.status === 'failed') || [];
        this.decorationManager.clearFailingTestDecorations();
        for (const t of failing) {
            this.decorationManager.failingTestDecorations.push(...await parseTestOutput(t.output));
        }
        return testResults;
    }

    private async runTestHandler(request: vscode.TestRunRequest, cancellation: vscode.CancellationToken) {
        if (!testExplorer) {
            return;
        }

        const requestedTests = request.include || this.testItemCollectionToArray(testExplorer.items);
        // Filter out duplicate tests, i.e., both the parent and child are requested
        const parents = new Set<string>();
        requestedTests.forEach(t => {
            if (!t.parent) {
                parents.add(t.id);
            }
        });
        const tests: vscode.TestItem[] = [];
        requestedTests.forEach(t => {
            if (!t.parent || !parents.has(t.parent.id)) {
                tests.push(t);
            }
        });

        const run = testExplorer.createTestRun(request);
        await this.runCTestHelper(tests, run, undefined, undefined, undefined, cancellation);
        run.end();
    };

    /**
     * Initializes the VS Code Test Controller if it is not already initialized.
     * Should only be called by refreshTests since it adds tests to the controller.
     */
    private ensureTestExplorerInitialized(): vscode.TestController {
        if (!testExplorer) {
            testExplorer = vscode.tests.createTestController('cmakeToolsCTest', 'CTest');

            // Cast to any since this is not supported yet in the API we use.
            (testExplorer as any).refreshHandler = () => vscode.commands.executeCommand('cmake.refreshTestsAll');

            if (this.projectController) {
                for (const project of this.projectController.getAllCMakeProjects()) {
                    const folderPath = util.platformNormalizePath(project.folderPath);
                    testExplorer.items.add(testExplorer.createTestItem(folderPath, folderPath));
                }
            }

            testExplorer.createRunProfile(
                'Run Tests',
                vscode.TestRunProfileKind.Run,
                (request: vscode.TestRunRequest, cancellation: vscode.CancellationToken) => this.runTestHandler(request, cancellation),
                true
            );
            // TODO
            // testExplorer.createRunProfile('Debug Tests', vscode.TestRunProfileKind.Debug, runHandler);
        }
        return testExplorer;
    }

    addTestExplorerRoot(folder: string) {
        if (!testExplorer) {
            return;
        }

        const normalizedFolder = util.platformNormalizePath(folder);
        testExplorer.items.add(testExplorer.createTestItem(normalizedFolder, normalizedFolder));
    }

    removeTestExplorerRoot(folder: string) {
        if (!testExplorer) {
            return;
        }

        const normalizedFolder = util.platformNormalizePath(folder);
        testExplorer.items.delete(normalizedFolder);
    }

    /**
     * If returning false, the test explorer is not available, and refreshTests can be called to construct it.
     * Since there's no way to reveal the explorer itself, this function reveals the first test in the test explorer.
     */
    async revealTestExplorer(): Promise<boolean> {
        if (!testExplorer) {
            return false;
        }

        const tests = this.testItemCollectionToArray(testExplorer.items);
        if (tests.length === 0) {
            return false;
        }

        await vscode.commands.executeCommand('vscode.revealTestInExplorer', tests[0]);
        return true;
    }
}

// Only have one instance of the test controller
let testExplorer: vscode.TestController | undefined;
