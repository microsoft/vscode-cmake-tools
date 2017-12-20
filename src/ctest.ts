import * as path from 'path';
import * as vscode from 'vscode';
import * as xml2js from 'xml2js';

import * as api from './api';
import * as async from './async';
import {config} from './config';
import * as util from './util';
import {Maybe} from './util';

interface SiteAttributes {}

type TestStatus = ('failed')

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

export interface Results { Site: SiteData; }

// clang-format off
interface MessyResults {
  Site: {
    $: {},
    Testing: {
      TestList: {Test: string[]}[]; EndDateTime: string[];
      EndTestTime: string[];
      ElapsedMinutes: string[];
      Test: {
        $: {Status: TestStatus},
        FullCommandLine: string[];
        FullName: string[];
        Name: string[];
        Path: string[];
        Results: {
          NamedMeasurement:
              {$: {type: string; name: string;}, Value: string[];}[]
          Measurement: {Value: string[];}[];
        }[];
      }[];
    }[];
  };
}

interface MessyCoverage {
  Site: {
    $: {};
    CoverageLog: {
      File: {
        $: {
          Name: string;
          FullPath: string;
        };
        Report: {
          Line: {
            $: {
              Number: string;
              Count: string;
            };
          }[];
        }[];
      }[];
    }[];
  };
}

interface Coverage {
  [filename: string]: number[];
}
// clang-format on

function cleanupResultsXML(messy: MessyResults): Results {
  return {
    Site: {
      $: messy.Site.$,
      Testing: {
        TestList: messy.Site.Testing[0].TestList.map(l => l.Test[0]),
        Test: messy.Site.Testing[0].Test.map(
            (test): Test => ({
              FullName: test.FullName[0],
              FullCommandLine: test.FullCommandLine[0],
              Name: test.Name[0],
              Path: test.Path[0],
              Status: test.$.Status,
              Measurements: new Map<string, TestMeasurement>(),
              Output: test.Results[0].Measurement[0].Value[0]
            }))
      }
    }
  };
}

function cleanupCoverageXML(messy: MessyCoverage): Coverage {
  return messy.Site.CoverageLog[0].File.reduce<Coverage>(
      (acc, file) => {
        acc[file.$.FullPath] = file.Report[0].Line.map(l => parseInt(l.$.Count));
        return acc;
      },
      {});
}

function parseXMLString(xml: string): Promise<any> {
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

export async function readTestResultsFile(test_xml: string): Promise<Results> {
  const content = (await async.readFile(test_xml)).toString();
  const data = await parseXMLString(content) as MessyResults;
  const clean = cleanupResultsXML(data);
  return clean;
}

export async function readTestCoverageFiles(tagdir: string): Promise<Coverage> {
  let counter = 0;
  const acc: Coverage = {};
  while (1) {
    const logfile = path.join(tagdir, `CoverageLog-${counter++}.xml`);
    if (!await async.exists(logfile)) {
      break;
    }
    console.log('Reading in CTest coverage report', logfile);
    const content = (await async.readFile(logfile)).toString();
    const mess = await parseXMLString(content) as MessyCoverage;
    Object.assign(acc, cleanupCoverageXML(mess));
  }
  return acc;
}

export function parseCatchTestOutput(output: string): FailingTestDecoration[] {
  const lines_with_ws = output.split('\n');
  const lines = lines_with_ws.map(l => l.trim());
  const decorations: FailingTestDecoration[] = [];
  for (let cursor = 0; cursor < lines.length; ++cursor) {
    const line = lines[cursor];
    const regex = process.platform === 'win32' ?
        new RegExp(/^(.*)\((\d+)\): FAILED:/) :
        new RegExp(/^(.*):(\d+): FAILED:/);
    const res = regex.exec(line);
    if (res) {
      const [_, file, lineno_] = res;
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
        hoverMessage: `${message}\n~~~`,
      });
    }
  }
  return decorations;
}

export async function parseTestOutput(output: string):
    Promise<FailingTestDecoration[]> {
  if (/is a Catch .* host application\./.test(output)) {
    return parseCatchTestOutput(output);
  } else {
    return [];
  }
}

export interface CoverageDecoration {
  file: string;
  executionCounter: number;
  start: number;
  end: number;
}

export function generateCoverageDecorations(sourceDir: string, cover: Coverage): CoverageDecoration[] {
  const acc = [] as CoverageDecoration[];
  for (const filename in cover) {
    const lines = cover[filename];
    const filepath = path.isAbsolute(filename) ? filename : path.join(sourceDir, filename);
    let slide: CoverageDecoration | null = null;
    let last_count = Number.POSITIVE_INFINITY;
    for (let line_ in cover[filename]) {
      const line = parseInt(line_);
      const exe = cover[filename][line];
      if (!slide || exe != last_count) {
        // We ignore coverage of -1, meaning the line is not executable
        if (slide && last_count != -1) {
          acc.push(slide);
        }
        slide = {
          file: filepath,
          start: line,
          end: line,
          executionCounter: exe
        };
      } else {
        console.assert(exe == last_count);
        slide.end = line;
      }
      last_count = exe;
    }
    if (slide && last_count != -1) {
      acc.push(slide);
    }
  }
  return acc;
}

interface TestResults {
  passing: number;
  total: number;
}

export class DecorationManager {
  constructor() {
    vscode.window.onDidChangeActiveTextEditor(_ => {
      this._refreshActiveEditorDecorations();
    });
  }
  private readonly _failingTestDecorationType =
      vscode.window.createTextEditorDecorationType({
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
          margin: '10px',
        },
      });

  private readonly _coverageMissDecorationType =
    vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(255, 0, 0, 0.1)',
      isWholeLine: true
    });

  private readonly _coverageHitLowDecorationType =
    vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(0, 200, 0, 0.1)',
      isWholeLine: true
    });

  private readonly _coverageHitHighDecorationType =
    vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(0, 200, 0, 0.3)',
      isWholeLine: true
    });

  private _binaryDir: string;
  public get binaryDir(): string {
    return this._binaryDir;
  }
  public set binaryDir(v: string) {
    this._binaryDir = v;
    this._refreshActiveEditorDecorations();
  }

  private _showCoverageData : boolean = false;
  public get showCoverageData() : boolean {
    return this._showCoverageData;
  }
  public set showCoverageData(v : boolean) {
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
    const editor_file = util.normalizePath(editor.document.fileName);
    for (const decor of this.failingTestDecorations) {
      const decor_file = util.normalizePath(
          path.isAbsolute(decor.fileName) ?
              decor.fileName :
              path.join(this.binaryDir, decor.fileName));
      if (editor_file !== decor_file) {
        continue;
      }
      const file_line = editor.document.lineAt(decor.lineNumber);
      const range = new vscode.Range(
          decor.lineNumber, file_line.firstNonWhitespaceCharacterIndex,
          decor.lineNumber, file_line.range.end.character);
      fails_acc.push({
        hoverMessage: decor.hoverMessage,
        range: range,
      });
    }
    editor.setDecorations(this._failingTestDecorationType, fails_acc);

    for (const t of [this._coverageMissDecorationType, this._coverageHitLowDecorationType, this._coverageHitHighDecorationType]) {
      editor.setDecorations(t, []);
    }
    if (this.showCoverageData) {
      const miss_acc: vscode.DecorationOptions[] = [];
      const low_acc: vscode.DecorationOptions[] = [];
      const high_acc: vscode.DecorationOptions[] = [];
      for (const decor of this.coverageDecorations) {
        const decor_file = util.normalizePath(decor.file);
        if (editor_file !== decor_file) {
          continue;
        }
        const start_line = editor.document.lineAt(decor.start);
        const end_line = editor.document.lineAt(decor.end);
        const range = new vscode.Range(decor.start, start_line.firstNonWhitespaceCharacterIndex, decor.end, end_line.range.end.character);
        (decor.executionCounter == 0
          ? miss_acc
          : decor.executionCounter >= 3
            ? high_acc
            : low_acc).push({
          range: range,
          hoverMessage: decor.executionCounter.toString(),
        });
      }
      editor.setDecorations(this._coverageMissDecorationType, miss_acc);
      editor.setDecorations(this._coverageHitLowDecorationType, low_acc);
      editor.setDecorations(this._coverageHitHighDecorationType, high_acc);
    }
  }

  private _failingTestDecorations: FailingTestDecoration[] = [];
  clearFailingTestDecorations() {
    this.failingTestDecorations = [];
  }
  addFailingTestDecoration(dec: FailingTestDecoration) {
    this._failingTestDecorations.push(dec);
    this._refreshActiveEditorDecorations();
  }
  public get failingTestDecorations(): FailingTestDecoration[] {
    return this._failingTestDecorations;
  }
  public set failingTestDecorations(v: FailingTestDecoration[]) {
    this._failingTestDecorations = v;
    this._refreshAllEditorDecorations();
  }

  private _coverageDecorations : CoverageDecoration[] = [];
  public get coverageDecorations() : CoverageDecoration[] {
    return this._coverageDecorations;
  }
  public set coverageDecorations(v : CoverageDecoration[]) {
    this._coverageDecorations = v;
    this._refreshAllEditorDecorations();
  }
}

export class CTestController {
  private readonly _decorationManager = new DecorationManager();
  protected readonly _channel = new util.ThrottledOutputChannel('CMake/Build');

  public async executeCTest(sourceDir: string,
      binarydir: string, configuration: string,
      env: NodeJS.ProcessEnv): Promise<number> {
    // Reset test decorations
    this._channel.clear();
    this._channel.show();
    this._decorationManager.failingTestDecorations = [];
    const pr = util.execute(
        config.ctestPath,
        [
          '-j' + config.numCTestJobs, '-C', configuration, '-T', 'test',
          '--output-on-failure'
        ].concat(config.ctestArgs),
        util.mergeEnvironment(config.testEnvironment as any, env), binarydir,
        this._channel);
    const rp = pr.onComplete.then(res => res.retc);
    rp.then(async() => {
      await this.reloadTests(sourceDir, binarydir, configuration);
      if (this.testResults) {
        for (const test of this.testResults.Site.Testing.Test.filter(
                 t => t.Status === 'failed')) {
          this._channel.append(
              `The test "${test.Name}" failed with the following output:\n` +
              '----------' +
              '-----------------------------------' +
              Array(test.Name.length).join('-') +
              `\n${test.Output.trim()
                  .split('\n')
                  .map(line => '    ' + line)
                  .join('\n')}\n`);
          // Only show the channel when a test fails
          this._channel.show();
        }
      }
    });

    return rp;
  }

  /**
   * @brief Reload the list of CTest tests
   */
  public async reloadTests(sourceDir: string, binaryDir: string, config: string):
      Promise<api.Test[]> {
    const ctest_file = path.join(binaryDir, 'CTestTestfile.cmake');
    if (!(await async.exists(ctest_file))) {
      this.testingEnabled = false;
      return this.tests = [];
    }
    this._decorationManager.binaryDir = binaryDir;
    this.testingEnabled = true;
    const bt = config;
    const result =
        await async.execute('ctest', ['-N', '-C', bt], {cwd: binaryDir});
    if (result.retc !== 0) {
      // There was an error running CTest. Odd...
      console.error(
          '[vscode] There was an error running ctest to determine available test executables');
      return this.tests = [];
    }
    const tests =
        result.stdout.split('\n')
            .map(l => l.trim())
            .filter(l => /^Test\s*#(\d+):\s(.*)/.test(l))
            .map(l => /^Test\s*#(\d+):\s(.*)/.exec(l)!)
            .map(([_, id, tname]) => ({id: parseInt(id!), name: tname!}));
    const tagfile = path.join(binaryDir, 'Testing', 'TAG');
    const tag = (await async.exists(tagfile)) ?
        (await async.readFile(tagfile)).toString().split('\n')[0].trim() :
        null;
    const tagdir = tag ? path.join(binaryDir, 'Testing', tag) : null;
    const results_file = tagdir ? path.join(tagdir, 'Test.xml') : null;
    this.tests = tests;
    if (results_file && await async.exists(results_file)) {
      console.assert(tagdir);
      await this._reloadTestResults(sourceDir, tagdir!, results_file);
    } else {
      this.testResults = null;
    }

    return tests;
  }

  private async _reloadTestResults(sourcedir: string, tagdir: string, test_xml: string): Promise<void> {
    this.testResults = await readTestResultsFile(test_xml);
    const failing =
        this.testResults.Site.Testing.Test.filter(t => t.Status === 'failed');
    this._decorationManager.clearFailingTestDecorations();
    let new_decors = [] as FailingTestDecoration[];
    for (const t of failing) {
      new_decors.push(...await parseTestOutput(t.Output));
    }
    this._decorationManager.failingTestDecorations = new_decors;

    const coverage = await readTestCoverageFiles(tagdir);
    const decors = generateCoverageDecorations(sourcedir, coverage)
    this._decorationManager.coverageDecorations = decors;
  }

  /**
   * Hods the most recent test informations
   */
  private _tests: api.Test[] = [];
  public get tests(): api.Test[] {
    return this._tests;
  }
  public set tests(v: api.Test[]) {
    this._tests = v;
    this._testsChangedEmitter.fire(v);
    ;
  }

  /**
   * Whether we show coverage data in the editor or not
   */
  public get showCoverageData() : boolean {
    return this._decorationManager.showCoverageData;
  }
  public set showCoverageData(v : boolean) {
    this._decorationManager.showCoverageData = v;
  }

  private readonly _testsChangedEmitter = new vscode.EventEmitter<api.Test[]>();
  public readonly onTestsChanged = this._testsChangedEmitter.event;

  private _testResults: Maybe<Results>;
  public get testResults(): Maybe<Results> {
    return this._testResults;
  }
  public set testResults(v: Maybe<Results>) {
    this._testResults = v;
    if (v) {
      const total = this.tests.length;
      const passing = v.Site.Testing.Test.reduce(
          (acc, test) => acc + (test.Status !== 'failed' ? 1 : 0), 0);
      this._resultsChangedEmitter.fire({passing, total});
    } else {
      this._resultsChangedEmitter.fire(null);
    }
  }

  private readonly _resultsChangedEmitter =
      new vscode.EventEmitter<TestResults|null>();
  public readonly onResultsChanged = this._resultsChangedEmitter.event;


  private _testingEnabled: boolean = false;
  public get testingEnabled(): boolean {
    return this._testingEnabled;
  }
  public set testingEnabled(v: boolean) {
    this._testingEnabled = v;
    this._testingEnabledEmitter.fire(v);
  }

  private readonly _testingEnabledEmitter = new vscode.EventEmitter<boolean>();
  public readonly onTestingEnabledChanged = this._testingEnabledEmitter.event;

  public setBinaryDir(dir: string) {
    this._decorationManager.binaryDir = dir;
  }
}