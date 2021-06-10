/**
 * Smoke test module.
 */

import 'module-alias/register';

import * as path from 'path';
import {SmokeContext, SUITE_REGISTRY, SmokeSuite, SmokeTest} from './smoke';
import {fs} from '@cmt/pr';
import * as vscode from 'vscode';


// The TestRunner interface is expected to be available for VSCode to run our tests
interface TestRunner {
  run(testRunDir: string, testRunCallback: (val: Error|null) => void): void;
}

/**
 * The actual TestRunner class that executes our smoke tests.
 */
class CMakeToolsSmokeTestRunner implements TestRunner {
  private _nFailures = 0;
  /**
   * Run the tests. This is called by VSCode to run our tests.
   * @param smokeOutDir The directory to which the smoke tests were compiled
   * @param cb The test CompletionHandler
   */
  run(smokeOutDir: string, cb: (val: Error|null, nFailures: number|null) => void): void {
    this._run(smokeOutDir)
        // Success? Call with null.
        .then(() => cb(null, this._nFailures))
        // Failure? Pass on the error
        .catch(e => cb(e, this._nFailures));
  }

  /**
   * Run the actual tests. Implemented as an async function.
   * @param smokeOutDir The directory to where smoke tests were compiled
   */
  private async _run(smokeOutDir: string): Promise<void> {
    // The real smoke directory is passed via an environment variable
    const smoke_dir = process.env['CMT_SMOKE_DIR']!;
    console.assert(smoke_dir, '$CMT_SMOKE_DIR environment variable must be set correctly');
    // Find all the directories within the smoke directory
    const items = await fs.readdir(smoke_dir);
    for (const leaf of items) {
      const test_dirpath = path.join(smoke_dir, leaf);
      const st = await fs.stat(test_dirpath);
      // Find only directories that do not begin with an underscore:
      if (!leaf.startsWith('_') && st.isDirectory()) {
        // Execute the tests in this directory
        await this._runDirTest(smoke_dir, smokeOutDir, test_dirpath);
      }
    }
  }

  private async _runDirTest(smokeDir: string, smokeOutDir: string, testDir: string) {
    // `pr_root` is a directory where we put the project that we will test against.
    const pr_root = path.join(smokeDir, '_project-dir');
    const pr_root_workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(pr_root));
    if (!pr_root_workspaceFolder) {
      throw Error(`Path ${pr_root} does not exist`);
    }
    // Wipe the project-root dir clean
    await this._wipeDirectory(pr_root);

    // Copy the contents of the smoke test directory into the project root
    await this._copyContents(testDir, pr_root);

    // Get the path to the transpiled test.js file for this smoke test
    const test_rel = path.relative(smokeDir, testDir);
    const test_out = path.join(smokeOutDir, test_rel);
    const test_js = path.join(test_out, 'test.js');
    const ext_dir = path.normalize(path.join(smokeDir, '../..'));
    const ctx = new SmokeContext(pr_root_workspaceFolder, ext_dir);
    try {
      await this._runTestFile(ctx, test_js);
    } finally {
      // Always clean up after ourselves...
      await this._wipeDirectory(pr_root);
    }
  }

  private async _runTestFile(ctx: SmokeContext, test_js: string) {
    SUITE_REGISTRY.reset();
    console.log(`- Loading test suites from file ${test_js}`);
    require(test_js);
    for (const init of SUITE_REGISTRY.inits) {
      console.log(`  - Loading test suite: ${init.name}`);
      let suite: SmokeSuite;
      try {
        suite = await init.realize();
      } catch (e) {
        console.error(`Failed to initialize suite "${init.name}": ${e}`);
        this._nFailures += 1;
        continue;
      }
      try {
        console.log(`  - Running test suite: ${init.name}`);
        await this._runSuite(suite, ctx);
      } catch (e) {
        console.error(`Error while running suite "${suite.name}": ${e}`);
        this._nFailures += 1;
        continue;
      }
    }
  }

  private async _runSuite(suite: SmokeSuite, ctx: SmokeContext) {
    for (const test of suite.tests) {
      const prefix = `    - Running test ${suite.name}/${test.name}`;
      console.log(prefix);
      for (const setup of suite.setups) {
        await this._runSuiteTest(setup, ctx);
      }
      try {
        await this._runSuiteTest(test, ctx);
        console.log(`${prefix} - PASS`);
      } catch (e) {
        console.error(`${prefix} - FAIL! XX`);
        this._nFailures += 1;
      } finally {
        for (const teardown of suite.teardowns) {
          await this._runSuiteTest(teardown, ctx);
        }
      }
    }
  }

  private async _runSuiteTest(test: SmokeTest, ctx: SmokeContext) {
    try {
      await Promise.resolve(test.fn(ctx));
    } catch (e) {
      console.error(`Error during test execution "${test.name}":`, e);
      throw e;
    }
  }

  private async _copyContents(inPath: string, outPath: string) {
    for (const leaf of await fs.readdir(inPath)) {
      const in_file = path.join(inPath, leaf);
      const out_file = path.join(outPath, leaf);
      const stat = await fs.stat(in_file);
      if (stat.isDirectory()) {
        await fs.mkdir_p(out_file);
        await this._copyContents(in_file, out_file);
      } else {
        await fs.hardLinkFile(in_file, out_file);
      }
    }
  }

  private async _wipeDirectory(dirPath: string) {
    for (const leaf of await fs.readdir(dirPath)) {
      if (leaf === '.dummy-file.txt') {
        // We keep this file around so that git has something to commit.
        continue;
      }
      const filepath = path.join(dirPath, leaf);
      await fs.rmdir(filepath);
    }
  }
}

module.exports = new CMakeToolsSmokeTestRunner();
