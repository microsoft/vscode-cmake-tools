import { DirectoryContext } from '@cmt/workspace';
import * as path from 'path';
import * as vscode from 'vscode';
import * as xml2js from 'xml2js';
import * as zlib from 'zlib';

import * as api from './api';
import { CMakeDriver } from '@cmt/drivers/cmakeDriver';
import * as logging from './logging';
import { fs } from './pr';
import { OutputConsumer } from './proc';
import * as util from './util';
import * as nls from 'vscode-nls';
import { testArgs, TestPreset } from './preset';
import { expandString } from './expand';
import * as proc from '@cmt/proc';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('ctest');

export interface BasicTestResults {
    passing: number;
    total: number;
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
                    { $: { Type: string; Name: string }; Value: string[] }[];
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
                test: testingHead.Test.map((test): Test => ({
                    fullName: test.FullName[0],
                    fullCommandLine: test.FullCommandLine[0],
                    name: test.Name[0],
                    path: test.Path[0],
                    status: test.$.Status,
                    measurements: new Map<string, TestMeasurement>(),
                    output: decodeOutputMeasurement(test.Results[0].Measurement[0].Value[0])
                }))
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
    constructor(readonly ws: DirectoryContext) {}
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
        this.resultsChangedEmitter.dispose();
        this.testsChangedEmitter.dispose();
    }

    /**
     * Holds the most recent test informations
     */
    private _tests: api.Test[] = [];
    get tests(): api.Test[] {
        return this._tests;
    }
    set tests(v: api.Test[]) {
        this._tests = v;
        this.testsChangedEmitter.fire(v);
    }

    private readonly testsChangedEmitter = new vscode.EventEmitter<api.Test[]>();
    readonly onTestsChanged = this.testsChangedEmitter.event;

    private _testResults?: CTestResults;
    get testResults(): CTestResults | undefined {
        return this._testResults;
    }
    set testResults(v: CTestResults | undefined) {
        this._testResults = v;
        if (v) {
            const total = v.site.testing.test.length;
            const passing = v.site.testing.test.reduce((acc, test) => acc + (test.status === 'passed' ? 1 : 0), 0);
            this.resultsChangedEmitter.fire({ passing, total });
        } else {
            this.resultsChangedEmitter.fire(null);
        }
    }

    private readonly resultsChangedEmitter = new vscode.EventEmitter<BasicTestResults | null>();
    readonly onResultsChanged = this.resultsChangedEmitter.event;

    public async runCTest(driver: CMakeDriver, customizedTask: boolean = false, testPreset?: TestPreset, consumer?: proc.OutputConsumer): Promise<number|null> {
        if (!customizedTask) {
            // We don't want to focus on log channel when running tasks.
            log.showChannel();
        }
        this.decorationManager.clearFailingTestDecorations();

        const ctestpath = await this.ws.getCTestPath(driver.cmakePathFromPreset);
        if (ctestpath === null) {
            log.info(localize('ctest.path.not.set', 'CTest path is not set'));
            return -2;
        }

        let ctestArgs: string[];
        if (customizedTask && testPreset) {
            ctestArgs = ['-T', 'test'].concat(testArgs(testPreset));
        } else if (!customizedTask && driver.useCMakePresets) {
            if (!driver.testPreset) {
                log.error(localize('test.preset.not.set', 'Test preset is not set'));
                return -3;
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

        const child = driver.executeCommand(
            ctestpath,
            ctestArgs,
            ((customizedTask && consumer) ? consumer : new CTestOutputLogger()),
            { environment: await driver.getCTestCommandEnvironment(), cwd: driver.binaryDir });
        const res = await child.result;
        await this.reloadTests(driver);
        if (res.retc === null) {
            log.info(localize('ctest.run.terminated', 'CTest run was terminated'));
            return -1;
        } else {
            log.info(localize('ctest.finished.with.code', 'CTest finished with return code {0}', res.retc));
        }
        return res.retc;
    }

    /**
     * @brief Reload the list of CTest tests
     */
    async reloadTests(driver: CMakeDriver): Promise<api.Test[]> {
        const ctestFile = path.join(driver.binaryDir, 'CTestTestfile.cmake');
        if (!(await fs.exists(ctestFile))) {
            this.testingEnabled = false;
            return this.tests = [];
        }
        this.decorationManager.binaryDir = driver.binaryDir;
        this.testingEnabled = true;

        const ctestpath = await this.ws.getCTestPath(driver.cmakePathFromPreset);
        if (ctestpath === null) {
            log.info(localize('ctest.path.not.set', 'CTest path is not set'));
            return this.tests = [];
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
            return this.tests = [];
        }
        const tests = result.stdout?.split('\n')
            .map(l => l.trim())
            .filter(l => /^Test\s*#(\d+):\s(.*)/.test(l))
            .map(l => /^Test\s*#(\d+):\s(.*)/.exec(l)!)
            .map(([, id, tname]) => ({ id: parseInt(id!), name: tname! })) ?? [];
        const tagFile = path.join(driver.binaryDir, 'Testing', 'TAG');
        const tag = (await fs.exists(tagFile)) ? (await fs.readFile(tagFile)).toString().split('\n')[0].trim() : null;
        const tagDir = tag ? path.join(driver.binaryDir, 'Testing', tag) : null;
        const resultsFile = tagDir ? path.join(tagDir, 'Test.xml') : null;
        this.tests = tests;
        if (resultsFile && await fs.exists(resultsFile)) {
            console.assert(tagDir);
            await this.reloadTestResults(resultsFile);
        } else {
            this.testResults = undefined;
        }

        return tests;
    }

    private async reloadTestResults(testXml: string): Promise<void> {
        this.testResults = await readTestResultsFile(testXml);
        const failing = this.testResults?.site.testing.test.filter(t => t.status === 'failed') || [];
        this.decorationManager.clearFailingTestDecorations();
        const newDecors = [] as FailingTestDecoration[];
        for (const t of failing) {
            newDecors.push(...await parseTestOutput(t.output));
        }
        this.decorationManager.failingTestDecorations = newDecors;
    }

    /**
     * Marks all current tests as not run. Useful in case of build failure, for example.
     */
    markAllCurrentTestsAsNotRun(): void {
        const currentTestResults = this.testResults;
        if (!currentTestResults) {
            return;
        }
        for (const cTestRes of currentTestResults.site.testing.test || []) {
            cTestRes.status = 'notrun';
        }
        this.testResults = currentTestResults;
    }
}

