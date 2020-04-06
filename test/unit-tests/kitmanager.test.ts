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
    const fname_extension = process.platform == 'win32' ? 'bat' : 'sh';
    const fname = `cmake-kit-test-${Math.random().toString()}.${fname_extension}`;
    const script_path = path.join(paths.tmpDir, fname);
    // generate a file with test batch / shell script that sets two env vars
    if (process.platform == 'win32') {
      await fs.writeFile(script_path, `set "TESTVAR12=abc"\r\nset "TESTVAR13=cde"`);
    } else {
      await fs.writeFile(script_path, `export "TESTVAR12=abc"\nexport "TESTVAR13=cde"`);
    }

    const kit = { name: "Test Kit 1", environmentSetupScript: script_path };
    const env_vars = await getShellScriptEnvironment(kit);
    await fs.unlink(script_path);
    expect(env_vars).to.not.be.undefined;

    if (env_vars) {
      const env_vars_arr = Array.from(env_vars);
      // must contain all env vars, not only the ones we defined!
      expect(env_vars_arr.length).to.be.greaterThan(2);
      expect(env_vars_arr).to.deep.include(['TESTVAR12', 'abc']);
      expect(env_vars_arr).to.deep.include(['TESTVAR13', 'cde']);
    }
  });
});
