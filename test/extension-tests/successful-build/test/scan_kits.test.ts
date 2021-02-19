import {scanForKits} from '@cmt/kit';
import {fs} from '@cmt/pr';
import {expect} from '@test/util';

// tslint:disable:no-unused-expression

suite('[MinGW Tests]', async () => {
  const mingw_dirs: string[] = ['C:\\Qt\\Tools\\mingw492_32', 'C:\\mingw-w64\\x86_64-7.2.0-posix-seh-rt_v5-rev1\\mingw64'];

  setup(async function(this: Mocha.Context) {
    this.timeout(100000);
  });

  test('Test scan of mingw', async () => {
    const kits = await scanForKits(undefined, {
      scanDirs: [],
      minGWSearchDirs: mingw_dirs,
    });
    const is_kit_MinGW_present = kits.find(kit => kit.name.indexOf('GCC for i686-w64-mingw32 4.9.2') >= 0) ? true : false;
    const is_kit_MinGW_w64_present = kits.find(kit => kit.name.indexOf('GCC for x86_64-w64-mingw32 7.2.0') >= 0) ? true : false;
    console.log(JSON.stringify(kits, null, 2));

    if (await fs.exists(mingw_dirs[0])) {
      expect(is_kit_MinGW_present).to.equal(true);
    }
    if (await fs.exists(mingw_dirs[1])) {
      expect(is_kit_MinGW_w64_present).to.equal(true);
    }
  }).timeout(100000);
});
