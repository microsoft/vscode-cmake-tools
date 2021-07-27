import {DirectoryContext} from '@cmt/workspace';
import * as path from 'path';
import * as vscode from 'vscode';
import * as xml2js from 'xml2js';
import * as zlib from 'zlib';

import * as api from './api';
import {CMakeDriver} from '@cmt/drivers/driver';
import * as logging from './logging';
import {fs} from './pr';
import {OutputConsumer} from './proc';
import * as util from './util';
import * as nls from 'vscode-nls';
import { testArgs } from './preset';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('ctest');

export interface BasicTestResults {
  passing: number;
  total: number;
}

interface SiteAttributes {}

type TestStatus = ('failed'|'notrun'|'passed');

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
  Status: TestStatus;
  FullCommandLine: string;
  FullName: string;
  Name: string;
  Path: string;
  Measurements: Map<string, TestMeasurement>;
  Output: string;
}

export interface TestingData {
  // Fill out when we need all the attributes
  TestList: string[];
  Test: Test[];
}

export interface SiteData {
  $: SiteAttributes;
  Testing: TestingData;
}

export interface CTestResults { Site: SiteData }

interface EncodedMeasurementValue {
  $: {encoding?: BufferEncoding; compression?: string};
  _: string;
}

// clang-format off
interface MessyResults {
  Site: {
    $: {};
    Testing: {
      TestList: {Test: string[]}[]; EndDateTime: string[];
      EndTestTime: string[];
      ElapsedMinutes: string[];
      Test: {
        $: {Status: TestStatus};
        FullCommandLine: string[];
        FullName: string[];
        Name: string[];
        Path: string[];
        Results: {
          NamedMeasurement:
              {$: {type: string; name: string}; Value: string[]}[];
          Measurement: { Value: [EncodedMeasurementValue|string] }[];
        }[];
      }[];
    }[];
  };
}

function parseXMLString<T>(xml: string): Promise<T> {
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

function decodeOutputMeasurement(node: EncodedMeasurementValue|string): string {
  if (typeof node === 'string') {
    return node;
  }
  let buffer = !!node.$.encoding ? Buffer.from(node._, node.$.encoding) : Buffer.from(node._, 'utf-8');
  if (!!node.$.compression) {
    buffer = zlib.unzipSync(buffer);
  }
  return buffer.toString('utf-8');
}
// clang-format on

function cleanupResultsXML(messy: MessyResults): CTestResults {
  const testing_head = messy.Site.Testing[0];
  if (testing_head.TestList.length === 1 && (testing_head.TestList[0] as any as string) === '') {
    // XML parsing is obnoxious. This condition means that there are no tests,
    // but CTest is still enabled.
    return {
      Site: {
        $: messy.Site.$,
        Testing: {
          TestList: [],
          Test: []
        }
      }
    };
  }
  return {
    Site: {
      $: messy.Site.$,
      Testing: {
        TestList: testing_head.TestList.map(l => l.Test[0]),
        Test: testing_head.Test.map((test): Test => ({
                                      FullName: test.FullName[0],
                                      FullCommandLine: test.FullCommandLine[0],
                                      Name: test.Name[0],
                                      Path: test.Path[0],
                                      Status: test.$.Status,
                                      Measurements: new Map<string, TestMeasurement>(),
                                      Output: decodeOutputMeasurement(test.Results[0].Measurement[0].Value[0])
                                    }))
      }
    }
  };
}

export async function readTestResultsFile(test_xml: string) {
  const content = (await fs.readFile(test_xml)).toString();
  const data = await parseXMLString(content) as MessyResults;
  const clean = cleanupResultsXML(data);
  return clean;
}

export function parseCatchTestOutput(output: string): FailingTestDecoration[] {
  const lines_with_ws = output.split('\n');
  const lines = lines_with_ws.map(l => l.trim());
  const decorations: FailingTestDecoration[] = [];
  for (let cursor = 0; cursor < lines.length; ++cursor) {
    const line = lines[cursor];
    const regex = process.platform === 'win32' ? /^(.*)\((\d+)\): FAILED:/ : /^(.*):(\d+): FAILED:/;
    const res = regex.exec(line);
    if (res) {
      const [_all, file, lineno_] = res;
      void _all;  // unused
      const lineno = parseInt(lineno_) - 1;
      let message = '~~~c++\n';
      for (let i = 0;; ++i) {
        const expr_line = lines_with_ws[cursor + i];
        if (expr_line.startsWith('======') || expr_line.startsWith('------')) {
          break;
        }
        message += expr_line + '\n';
      }

      decorations.push({
        fileName: file,
        lineNumber: lineno,
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
    vscode.window.onDidChangeActiveTextEditor(_ => { this._refreshActiveEditorDecorations(); });
  }

  private readonly _failingTestDecorationType = vscode.window.createTextEditorDecorationType({
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
  get binaryDir(): string { return this._binaryDir; }
  set binaryDir(v: string) {
    this._binaryDir = v;
    this._refreshActiveEditorDecorations();
  }

  private _showCoverageData: boolean = false;
  get showCoverageData(): boolean { return this._showCoverageData; }
  set showCoverageData(v: boolean) {
    this._showCoverageData = v;
    this._refreshAllEditorDecorations();
  }

  private _refreshAllEditorDecorations() {
    for (const editor of vscode.window.visibleTextEditors) {
      this._refreshEditorDecorations(editor);
    }
  }

  private _refreshActiveEditorDecorations() {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      // Seems that sometimes the activeTextEditor is undefined. A VSCode bug?
      this._refreshEditorDecorations(editor);
    }
  }

  private _refreshEditorDecorations(editor: vscode.TextEditor) {
    const fails_acc: vscode.DecorationOptions[] = [];
    const editor_file = util.lightNormalizePath(editor.document.fileName);
    for (const decor of this.failingTestDecorations) {
      const decor_file = util.lightNormalizePath(
          path.isAbsolute(decor.fileName) ? decor.fileName : path.join(this.binaryDir, decor.fileName));
      if (editor_file !== decor_file) {
        continue;
      }
      const file_line = editor.document.lineAt(decor.lineNumber);
      const range = new vscode.Range(decor.lineNumber,
                                     file_line.firstNonWhitespaceCharacterIndex,
                                     decor.lineNumber,
                                     file_line.range.end.character);
      fails_acc.push({
        hoverMessage: decor.hoverMessage,
        range
      });
    }
    editor.setDecorations(this._failingTestDecorationType, fails_acc);
  }

  private _failingTestDecorations: FailingTestDecoration[] = [];
  clearFailingTestDecorations() { this.failingTestDecorations = []; }
  addFailingTestDecoration(dec: FailingTestDecoration) {
    this._failingTestDecorations.push(dec);
    this._refreshActiveEditorDecorations();
  }
  get failingTestDecorations(): FailingTestDecoration[] { return this._failingTestDecorations; }
  set failingTestDecorations(v: FailingTestDecoration[]) {
    this._failingTestDecorations = v;
    this._refreshAllEditorDecorations();
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
  output(line: string) { log.info(line); }
  error(line: string) { this.output(line); }
}

export class CTestDriver implements vscode.Disposable {
  constructor(readonly ws: DirectoryContext) {}
  private readonly _decorationManager = new DecorationManager();

  private _testingEnabled: boolean = false;
  get testingEnabled(): boolean { return this._testingEnabled; }
  set testingEnabled(v: boolean) {
    this._testingEnabled = v;
    this._testingEnabledEmitter.fire(v);
  }

  private readonly _testingEnabledEmitter = new vscode.EventEmitter<boolean>();
  readonly onTestingEnabledChanged = this._testingEnabledEmitter.event;

  dispose() {
    this._testingEnabledEmitter.dispose();
    this._resultsChangedEmitter.dispose();
    this._testsChangedEmitter.dispose();
  }

  /**
   * Holds the most recent test informations
   */
  private _tests: api.Test[] = [];
  get tests(): api.Test[] { return this._tests; }
  set tests(v: api.Test[]) {
    this._tests = v;
    this._testsChangedEmitter.fire(v);
  }

  private readonly _testsChangedEmitter = new vscode.EventEmitter<api.Test[]>();
  readonly onTestsChanged = this._testsChangedEmitter.event;

  private _testResults: CTestResults|null = null;
  get testResults(): CTestResults|null { return this._testResults; }
  set testResults(v: CTestResults|null) {
    this._testResults = v;
    if (v) {
      const total = v.Site.Testing.Test.length;
      const passing = v.Site.Testing.Test.reduce((acc, test) => acc + (test.Status === 'passed' ? 1 : 0), 0);
      this._resultsChangedEmitter.fire({passing, total});
    } else {
      this._resultsChangedEmitter.fire(null);
    }
  }

  private readonly _resultsChangedEmitter = new vscode.EventEmitter<BasicTestResults|null>();
  readonly onResultsChanged = this._resultsChangedEmitter.event;

  async runCTest(driver: CMakeDriver): Promise<number> {
    log.showChannel();
    this._decorationManager.clearFailingTestDecorations();

    const ctestpath = await this.ws.getCTestPath(driver.cmakePathFromPreset);
    if (ctestpath === null) {
      log.info(localize('ctest.path.not.set', 'CTest path is not set'));
      return -2;
    }

    let ctestArgs: string[];
    if (driver.useCMakePresets) {
      if (!driver.testPreset) {
        log.error(localize('test.preset.not.set', 'Test preset is not set'));
        return -3;
      }
      // Add a few more args so we can show the result in status bar
      ctestArgs = ['-T', 'test'].concat(testArgs(driver.testPreset));
    } else {
      const configuration = driver.currentBuildType;
      ctestArgs = [`-j${this.ws.config.numCTestJobs}`, '-C', configuration].concat(
        this.ws.config.ctestDefaultArgs, this.ws.config.ctestArgs);
    }

    const child = await driver.executeCommand(
        ctestpath,
        ctestArgs,
        new CTestOutputLogger(),
        {environment: await driver.getCTestCommandEnvironment(), cwd: driver.binaryDir});
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
    const ctest_file = path.join(driver.binaryDir, 'CTestTestfile.cmake');
    if (!(await fs.exists(ctest_file))) {
      this.testingEnabled = false;
      return this.tests = [];
    }
    this._decorationManager.binaryDir = driver.binaryDir;
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
    const child = await driver.executeCommand(
      ctestpath,
      ["-N", ...buildConfigArgs],
      undefined,
      {
        cwd: driver.binaryDir,
        silent: true,
        environment: await driver.getCTestCommandEnvironment()
      }
    );
    const result = await child.result;
    if (result.retc !== 0) {
      // There was an error running CTest. Odd...
      log.error(localize('ctest.error', 'There was an error running ctest to determine available test executables'));
      return this.tests = [];
    }
    const tests = result.stdout?.split('\n')
                      .map(l => l.trim())
                      .filter(l => /^Test\s*#(\d+):\s(.*)/.test(l))
                      .map(l => /^Test\s*#(\d+):\s(.*)/.exec(l)!)
                      .map(([_, id, tname]) => ({id: parseInt(id!), name: tname!})) ?? [];
    const tagfile = path.join(driver.binaryDir, 'Testing', 'TAG');
    const tag = (await fs.exists(tagfile)) ? (await fs.readFile(tagfile)).toString().split('\n')[0].trim() : null;
    const tagdir = tag ? path.join(driver.binaryDir, 'Testing', tag) : null;
    const results_file = tagdir ? path.join(tagdir, 'Test.xml') : null;
    this.tests = tests;
    if (results_file && await fs.exists(results_file)) {
      console.assert(tagdir);
      await this._reloadTestResults(driver.sourceDir, tagdir!, results_file);
    } else {
      this.testResults = null;
    }

    return tests;
  }

  private async _reloadTestResults(_sourceDir: string, _tagdir: string, test_xml: string): Promise<void> {
    this.testResults = await readTestResultsFile(test_xml);
    const failing = this.testResults.Site.Testing.Test.filter(t => t.Status === 'failed');
    this._decorationManager.clearFailingTestDecorations();
    const new_decors = [] as FailingTestDecoration[];
    for (const t of failing) {
      new_decors.push(...await parseTestOutput(t.Output));
    }
    this._decorationManager.failingTestDecorations = new_decors;
  }

  /**
   * Marks all current tests as not run. Useful in case of build failure, for example.
   */
  markAllCurrentTestsAsNotRun(): void {
    const currentTestResults = this.testResults;
    if (!currentTestResults) {
      return;
    }
    for (const cTestRes of currentTestResults.Site.Testing.Test) {
      cTestRes.Status = 'notrun';
    }
    this.testResults = currentTestResults;
  }
}
