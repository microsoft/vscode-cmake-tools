/* eslint-disable no-unused-expressions */
import {readKitsFile, baseKitEnvironment} from '@cmt/kit';
import { computeExpandedEnvironment, emptyExpansionOptions, mergeEnvironmentWithExpand } from '@cmt/expand';
import { EnvironmentVariables } from '@cmt/proc';
import * as util from '@cmt/util';
import {expect} from '@test/util';
import * as path from 'path';
import paths from '@cmt/paths';
import {fs} from '@cmt/pr';

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
      'ToolchainKit 4',
      'VSCode Kit 1',
      'VSCode Kit 2'
    ]);
  });

  test('Test use of env var in toolchain kit specified from test file', async () => {
    process.env.CMAKE_TOOLS_TEST_SOME_ENV_VAR = "Test";
    const kits = await readKitsFile(getTestResourceFilePath('test_kit.json'));

    expect(kits.filter(k => k.name === "ToolchainKit 2")[0].toolchainFile).to.eq("Test/toolchain.cmake");
    expect(kits.filter(k => k.name === "ToolchainKit 3")[0].toolchainFile).to.eq("test-project-without-cmakelists/toolchain.cmake");
    expect(kits.filter(k => k.name === "ToolchainKit 4")[0].toolchainFile).to.eq("test-project-without-cmakelists/Test/toolchain.cmake");
  });

  test('Test mergeEnvironmentWithExpand', async() => {
    util.envSet(process.env, "TESTVAR_HOST", "host");
    const kit_envs = {
      TESTVAR_SIMPLE: "simple",
      TESTVAR_COMPOSITE:
        "prefix_${env.TESTVAR_HOST}__${env.TESTVAR12}__${dollar}_${env.not_found_var}"
    };
    const merged_envs = await mergeEnvironmentWithExpand(
      true,
      [process.env as EnvironmentVariables, kit_envs],
      emptyExpansionOptions()
    );
    expect(util.envGetValue(merged_envs, "TESTVAR_COMPOSITE")).to.equal(
      "prefix_host__${env.TESTVAR12}__${dollar}_${env.not_found_var}"
    );
  });

  test('Test load env vars from shell script', async() => {
    const fname_extension = process.platform === 'win32' ? 'bat' : 'sh';
    const fname = `cmake-kit-test-${Math.random().toString()}.${fname_extension}`;
    const script_path = path.join(paths.tmpDir, fname);
    // generate a file with test batch / shell script that sets two env vars
    if (process.platform === 'win32') {
      await fs.writeFile(script_path, `set "TESTVAR12=abc"\r\nset "TESTVAR13=cde"`);
    } else {
      await fs.writeFile(script_path, `export "TESTVAR12=abc"\nexport "TESTVAR13=cde"`);
    }

    const opts = emptyExpansionOptions();
    util.envSet(process.env, "TESTVAR_HOST", "host");
    const kit_envs = {
      TESTVAR_COMPOSITE:
        "__${env.TESTVAR_HOST}__${env.TESTVAR12}__${dollar}_${env.not_found_var}",
      TESTVAR_SIMPLE: "simple"
    };
    let env_vars = await baseKitEnvironment(kit_envs, script_path, opts);
    await fs.unlink(script_path);
    expect(env_vars).to.not.be.undefined;

    if (env_vars) {
      const env_vars_arr = Object.entries(env_vars);
      // must contain all env vars, not only the ones we defined!
      expect(env_vars_arr.length).to.be.greaterThan(3);
      expect(env_vars_arr).to.deep.include(['TESTVAR12', 'abc']);
      expect(env_vars_arr).to.deep.include(['TESTVAR13', 'cde']);
      expect(util.envGetValue(env_vars, "TESTVAR_COMPOSITE")).to.equal(
        "__host__${env.TESTVAR12}__${dollar}_${env.not_found_var}"
      );
      env_vars = await computeExpandedEnvironment(
        env_vars,
        env_vars,
        false,
        opts
      );
      expect(util.envGetValue(env_vars, "TESTVAR_COMPOSITE")).to.equal(
        "__host__abc__$_"
      );
    }
  });
});
