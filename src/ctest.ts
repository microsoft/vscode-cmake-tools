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

interface MessyResults {
  Site: {$: {}, Testing: {TestList: {Test: string[]}[]
  EndDateTime: string[]
  EndTestTime: string[]
  ElapsedMinutes: string[]
  Test: {$: {Status: TestStatus}, FullCommandLine: string[]
  FullName: string[]
  Name: string[]
  Path: string[]
  Results: {NamedMeasurement: {$: {type: string
                            name: string
                        },
                        Value: string[]
                    }[]
                    Measurement: {
                        Value: string[]
                    }[]
                }[]
            }[]
        }[]
    };
}

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

  private _binaryDir: string;
  public get binaryDir(): string {
    return this._binaryDir;
  }
  public set binaryDir(v: string) {
    this._binaryDir = v;
    this._refreshActiveEditorDecorations();
  }


  private _refreshActiveEditorDecorations() {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      // Seems that sometimes the activeTextEditor is undefined. A VSCode bug?
      this._refreshEditorDecorations(vscode.window.activeTextEditor);
    }
  }

  private _refreshEditorDecorations(editor: vscode.TextEditor) {
    const to_apply: vscode.DecorationOptions[] = [];
    for (const decor of this.failingTestDecorations) {
      const editor_file = util.normalizePath(editor.document.fileName);
      const decor_file = util.normalizePath(
          path.isAbsolute(decor.fileName) ?
              decor.fileName :
              path.join(this._binaryDir, decor.fileName));
      if (editor_file !== decor_file) {
        continue;
      }
      const file_line = editor.document.lineAt(decor.lineNumber);
      const range = new vscode.Range(
          decor.lineNumber, file_line.firstNonWhitespaceCharacterIndex,
          decor.lineNumber, file_line.range.end.character);
      to_apply.push({
        hoverMessage: decor.hoverMessage,
        range: range,
      });
    }
    editor.setDecorations(this._failingTestDecorationType, to_apply);
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
    for (const editor of vscode.window.visibleTextEditors) {
      this._refreshEditorDecorations(editor);
    }
  }
}

export class CTestController {
  private readonly _decorationManager = new DecorationManager();
  protected readonly _channel = new util.ThrottledOutputChannel('CMake/Build');

  public async executeCTest(binarydir: string, configuration: string):
      Promise<number> {
    // Reset test decorations
    this._channel.clear();
    this._channel.show();
    this._decorationManager.failingTestDecorations = [];
    const pr = util.execute(
        'ctest',
        [
          '-j' + config.numCTestJobs, '-C', configuration, '-T', 'test',
          '--output-on-failure'
        ].concat(config.ctestArgs),
        config.testEnvironment as any, binarydir, this._channel);
    const rp = pr.onComplete.then(res => res.retc);
    rp.then(async() => {
      await this.reloadTests(binarydir, configuration);
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
  public async reloadTests(binaryDir: string, config: string):
      Promise<api.Test[]> {
    const ctest_file = path.join(binaryDir, 'CTestTestfile.cmake');
    if (!(await async.exists(ctest_file))) {
      this.testingEnabled = false;
      return this.tests = [];
    }
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
      await this._reloadTestResults(results_file);
    } else {
      this.testResults = null;
    }
    this._decorationManager.binaryDir = binaryDir;
    return tests;
  }

  private async _reloadTestResults(test_xml: string): Promise<void> {
    this.testResults = await readTestResultsFile(test_xml);
    const failing =
        this.testResults.Site.Testing.Test.filter(t => t.Status === 'failed');
    this._decorationManager.clearFailingTestDecorations();
    let new_decors = [] as FailingTestDecoration[];
    for (const t of failing) {
      new_decors.push(...await parseTestOutput(t.Output));
    }
    this._decorationManager.failingTestDecorations = new_decors;
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