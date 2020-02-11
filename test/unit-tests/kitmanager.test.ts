import {readKitsFile} from '@cmt/kit';
import {expect} from '@test/util';
import * as path from 'path';
import * as vscode from 'vscode';

// tslint:disable:no-unused-expression

const here = __dirname;
function getTestResourceFilePath(filename: string): string {
  return path.normalize(path.join(here, '../../../test/unit-tests', filename));
}

// for safety, ensure we reset the state of the process.env after every test since we're manipulating it in this suite.
const env = {...process.env};

suite('Kits test', async () => {
  teardown(() => {
    process.env = env;
  });

  test('Test load of kit from test file', async () => {
    const kits = await readKitsFile(getTestResourceFilePath('test_kit.json'));
    const names = kits.map(k => k.name);
    expect(names).to.deep.eq([
      'CompilerKit 1',
      'CompilerKit 2',
      'CompilerKit 3 with PreferredGenerator',
      'ToolchainKit 1',
      'ToolchainKit 2',
      'ToolchainKit 3',
      'VSCode Kit 1',
      'VSCode Kit 2',
    ]);
  });

  test('Test use of env var in toolchain kit specified from test file', async () => {
    process.env.CMAKE_TOOLS_TEST_SOME_ENV_VAR = "Test";
    const folderName = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : "";
    const kits = await readKitsFile(getTestResourceFilePath('test_kit.json'));

    expect(kits.filter(k => "ToolchainKit 2" === k.name)[0].toolchainFile).to.eq("Test/toolchain.cmake");
    expect(kits.filter(k => "ToolchainKit 3" === k.name)[0].toolchainFile).to.eq(`${folderName}/toolchain.cmake`);
  });
});
