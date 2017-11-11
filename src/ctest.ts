import * as vscode from 'vscode';

import * as path from 'path';

import * as xml2js from 'xml2js';

import * as api from './api';
import {CMakeDriver} from './driver';
import {fs} from './pr';

import * as logging from './logging';
import config from './config';
import {OutputConsumer} from './proc';

const log = logging.createLogger('ctest');

export interface BasicTestResults {
  passing: number;
  total: number;
}

interface SiteAttributes {}

type TestStatus = ('failed' | 'notrun' | 'passed');

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

export interface CTestResults { Site: SiteData; }


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
// TODO: Bring back test coverage
// interface MessyCoverage {
//   Site: {
//     $: {};
//     CoverageLog: {
//       File: {
//         $: {
//           Name: string;
//           FullPath: string;
//         };
//         Report: {
//           Line: {
//             $: {
//               Number: string;
//               Count: string;
//             };
//           }[];
//         }[];
//       }[];
//     }[];
//   };
// }

// interface Coverage {
//   [filename: string]: number[];
// }
// clang-format on

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

function cleanupResultsXML(messy: MessyResults): CTestResults {
  return {
    Site : {
      $ : messy.Site.$,
      Testing : {
        TestList : messy.Site.Testing[0].TestList.map(l => l.Test[0]),
        Test : messy.Site.Testing[0].Test.map((test): Test => ({
                                                FullName : test.FullName[0],
                                                FullCommandLine : test.FullCommandLine[0],
                                                Name : test.Name[0],
                                                Path : test.Path[0],
                                                Status : test.$.Status,
                                                Measurements : new Map<string, TestMeasurement>(),
                                                Output : test.Results[0].Measurement[0].Value[0]
                                              }))
      }
    }
  };
}

export async function readTestResultsFile(test_xml: string):
    Promise<CTestResults> {
      const content = (await fs.readFile(test_xml)).toString();
      const data = await parseXMLString(content) as MessyResults;
      const clean = cleanupResultsXML(data);
      return clean;
    }

class CTestOutputLogger implements OutputConsumer {
  output(line: string) { log.info(line);} error(line: string) { this.output(line);}
};

export class CTestDriver implements vscode.Disposable {
  private _testingEnabled: boolean = false;
  public get testingEnabled(): boolean { return this._testingEnabled; }
  public set testingEnabled(v: boolean) {
    this._testingEnabled = v;
    this._testingEnabledEmitter.fire(v);
  }

  private readonly _testingEnabledEmitter = new vscode.EventEmitter<boolean>();
  public readonly onTestingEnabledChanged = this._testingEnabledEmitter.event;

  dispose() {
    this._testingEnabledEmitter.dispose();
    this._resultsChangedEmitter.dispose();
    this._testsChangedEmitter.dispose();
  }

  /**
   * Holds the most recent test informations
   */
  private _tests: api.Test[] = [];
  public get tests(): api.Test[] { return this._tests; }
  public set tests(v: api.Test[]) {
    this._tests = v;
    this._testsChangedEmitter.fire(v);
  }

  private readonly _testsChangedEmitter = new vscode.EventEmitter<api.Test[]>();
  public readonly onTestsChanged = this._testsChangedEmitter.event;

  private _testResults: CTestResults | null;
  public get testResults(): CTestResults | null { return this._testResults; }
  public set testResults(v: CTestResults | null) {
    this._testResults = v;
    if (v) {
      const total = this.tests.length;
      const passing
          = v.Site.Testing.Test.reduce((acc, test) => acc + (test.Status === 'passed' ? 1 : 0), 0);
      this._resultsChangedEmitter.fire({passing, total});
    } else {
      this._resultsChangedEmitter.fire(null);
    }
  }

  private readonly _resultsChangedEmitter = new vscode.EventEmitter<BasicTestResults | null>();
  public readonly onResultsChanged = this._resultsChangedEmitter.event;

  async runCTest(driver: CMakeDriver): Promise<number> {
    log.showChannel();

    // TODO: Pass in configuration for -C
    const configuration = 'Debug';
    const child = driver.executeCommand(
        config.ctestPath,
        [ `-j${config.numCTestJobs}`, '-C', configuration, '-T', 'test', '--output-on-failure' ]
            .concat(config.ctestArgs),
        new CTestOutputLogger(),
        {environment : config.testEnvironment, cwd : driver.binaryDir});

    const res = await child.result;
    await this.reloadTests(driver);
    if (res.retc === null) {
      log.info('CTest run was terminated');
      return -1;
    } else {
      log.info('CTest finished with return code', res.retc);
    }
    return res.retc;
  }

  /**
   * @brief Reload the list of CTest tests
   */
  public async reloadTests(driver: CMakeDriver): Promise<api.Test[]> {
    const ctest_file = path.join(driver.binaryDir, 'CTestTestfile.cmake');
    if (!(await fs.exists(ctest_file))) {
      this.testingEnabled = false;
      return this.tests = [];
    }
    // TODO: Bring back decoration manager
    // this._decorationManager.binaryDir = driver.binaryDir;
    this.testingEnabled = true;

    // TOOD: Load the real config
    const config = 'Debug';
    const result = await driver
                       .executeCommand('ctest',
                                       [ '-N', '-C', config ],
                                       undefined,
                                       {cwd : driver.binaryDir, silent : true})
                       .result;
    if (result.retc !== 0) {
      // There was an error running CTest. Odd...
      console.error(
          '[vscode] There was an error running ctest to determine available test executables');
      return this.tests = [];
    }
    const tests = result.stdout.split('\n')
                      .map(l => l.trim())
                      .filter(l => /^Test\s*#(\d+):\s(.*)/.test(l))
                      .map(l => /^Test\s*#(\d+):\s(.*)/.exec(l) !)
                      .map(([ _, id, tname ]) => ({id : parseInt(id !), name : tname !}));
    const tagfile = path.join(driver.binaryDir, 'Testing', 'TAG');
    const tag = (await fs.exists(tagfile))
        ? (await fs.readFile(tagfile)).toString().split('\n')[0].trim()
        : null;
    const tagdir = tag ? path.join(driver.binaryDir, 'Testing', tag) : null;
    const results_file = tagdir ? path.join(tagdir, 'Test.xml') : null;
    this.tests = tests;
    if (results_file && await fs.exists(results_file)) {
      console.assert(tagdir);
      await this._reloadTestResults(driver.sourceDir, tagdir !, results_file);
    } else {
      this.testResults = null;
    }

    return tests;
  }


  private async _reloadTestResults(_sourceDir: string, _tagdir: string, test_xml: string):
      Promise<void> {
    this.testResults = await readTestResultsFile(test_xml);
    // const failing =
    //     this.testResults.Site.Testing.Test.filter(t => t.Status === 'failed');
    // this._decorationManager.clearFailingTestDecorations();
    // let new_decors = [] as FailingTestDecoration[];
    // for (const t of failing) {
    //   new_decors.push(...await parseTestOutput(t.Output));
    // }
    // this._decorationManager.failingTestDecorations = new_decors;

    // const coverage = await readTestCoverageFiles(tagdir);
    // const decors = generateCoverageDecorations(sourcedir, coverage)
    // this._decorationManager.coverageDecorations = decors;
  }
}