import {scanForKits} from '@cmt/kit';
import {fs} from '@cmt/pr';
import {expect} from '@test/util';

// tslint:disable:no-unused-expression

suite('[MinGW Tests]', async () => {
  const mingw_dirs: string[] = ['C:\\MinGW', 'C:\\mingw-w64\\x86_64-7.2.0-posix-seh-rt_v5-rev1\\mingw64'];

  setup(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(100000);

    let is_mingw_present = true;
    for (const dir of mingw_dirs) {
      if (!await fs.exists(dir)) {
        is_mingw_present = false;
      }
    }
    if (!is_mingw_present)
      this.skip();
  });

  test('Test scan of mingw', async () => {
    const kits = await scanForKits({
      scanDirs: [],
      minGWSearchDirs: mingw_dirs,
    });
    const is_kit_MinGW_present = kits.find(kit => kit.name.search(/mingw32/g) != -1) ? true : false;
    const is_kit_MinGW_w64_present = kits.find(kit => kit.name.search(/x86_64-w64-mingw32/g) != -1) ? true : false;
    expect(is_kit_MinGW_present).to.be.true;
    expect(is_kit_MinGW_w64_present).to.be.true;
  }).timeout(60000);
});
