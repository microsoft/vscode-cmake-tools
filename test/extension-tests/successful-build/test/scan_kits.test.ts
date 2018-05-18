import {CMakeTools} from '@cmt/cmake-tools';
import {DefaultEnvironment, expect} from '@test/util';
import * as fs from 'fs';

// tslint:disable:no-unused-expression

suite('[MinGW Tests]', async () => {
  let cmt: CMakeTools;
  let testEnv: DefaultEnvironment;
  let path_backup: string|undefined;
  const mingw_dirs: string[] = ['C:\\MinGW', 'C:\\mingw-w64\\x86_64-7.2.0-posix-seh-rt_v5-rev1\\mingw64'];

  setup(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(100000);

    const isMinGWPresent
        = mingw_dirs.reduce((currentExists, mingwPath) => currentExists && fs.existsSync(mingwPath), true);
    if (!isMinGWPresent)
      this.skip();

    testEnv = new DefaultEnvironment('test/extension-tests/successful-build/project-folder', 'build', 'output.txt');
    cmt = await CMakeTools.create(testEnv.vsContext, testEnv.wsContext);

    path_backup = process.env.PATH;
  });

  teardown(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(30000);
    await cmt.asyncDispose();
    testEnv.teardown();
    process.env.PATH = path_backup;
  });

  test('Test scan of mingw', async () => {
    process.env.PATH = '';

    // Set fake settings
    testEnv.config.updatePartial({
      mingwSearchDirs: mingw_dirs,
    });

    await cmt.scanForKits();
    const kits = cmt.getKits();
    const is_kit_MinGW_present = kits.find(kit => kit.name.search(/mingw32/g) != -1) ? true : false;
    const is_kit_MinGW_w64_present = kits.find(kit => kit.name.search(/x86_64-w64-mingw32/g) != -1) ? true : false;
    expect(is_kit_MinGW_present).to.be.true;
    expect(is_kit_MinGW_w64_present).to.be.true;
  }).timeout(60000);
});
