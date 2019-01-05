import {readKitsFile} from '@cmt/kit';
import {expect} from '@test/util';
import * as path from 'path';

// tslint:disable:no-unused-expression

const here = __dirname;
function getTestResourceFilePath(filename: string): string {
  return path.normalize(path.join(here, '../../../test/unit-tests', filename));
}


suite('Kits test', async () => {
  test('Test load of kit from test file', async () => {
    const kits = await readKitsFile(getTestResourceFilePath('test_kit.json'));
    const names = kits.map(k => k.name);
    expect(names).to.deep.eq([
      'CompilerKit 1',
      'CompilerKit 2',
      'CompilerKit 3 with PreferedGenerator',
      'ToolchainKit 1',
      'ToolchainKit 2',
      'VSCode Kit 1',
      'VSCode Kit 2',
    ]);

    // ${CMAKE_TOOLS_TEST_SOME_ENV_VAR}/toolchain.cmake -> Test/toolchain.cmake if our env var mapping works.
    process.env["CMAKE_TOOLS_TEST_SOME_ENV_VAR"] = "Test";
    expect(kits.filter(k => "ToolchainKit 2" == k.name)[0].toolchainFile).to.eq("Test/toolchain.cmake");
  });
});
