import {readKitsFile, getShellScriptEnvironment} from '@cmt/kit';
import {expect} from '@test/util';
import * as path from 'path';
import paths from '@cmt/paths';
import {fs} from '@cmt/pr';

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
      'CompilerKit 3 with PreferredGenerator',
      'ToolchainKit 1',
      'VSCode Kit 1',
      'VSCode Kit 2',
    ]);
  });

  test('Test load env vars from shell script', async() => {
    // write test batch file that sets TESTVAR12 and TESTVAR13
    const fname = `cmake-kit-test_${Math.random().toString()}.bat`;
    const batpath = path.join(paths.tmpDir, fname);
    await fs.writeFile(batpath, `set "TESTVAR12=abc"\r\nset "TESTVAR13=cde"`);

    const kit = { name: "Test Kit 1", environmentVariablesShellScript: batpath };
    const envVars = await getShellScriptEnvironment(kit);
    await fs.unlink(batpath);
    expect(envVars).to.not.be.undefined;

    if (envVars) {
      const envVarsArr = Array.from(envVars);
      // must contain all env vars, not only the ones we defined!
      expect(envVarsArr.length).to.be.greaterThan(2);
      expect(envVarsArr).to.deep.include(['TESTVAR12', 'abc']);
      expect(envVarsArr).to.deep.include(['TESTVAR12', 'cde']);
    }
  });
});
