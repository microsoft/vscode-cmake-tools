import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as path from 'path';

chai.use(chaiAsPromised);

import {expect} from 'chai';
import * as kit from '../../src/kit';
import * as triple from '../../src/triple';
import {fs} from '../../src/pr';

import {CMakeTools} from '@cmt/cmake-tools';
import {clearExistingKitConfigurationFile, DefaultEnvironment,} from '@test/util';

// tslint:disable:no-unused-expression

const here = __dirname;
function getTestRootFilePath(filename: string): string {
  return path.normalize(path.join(here, '../../..', 'test', filename));
}

function getPathWithoutCompilers() {
  if (process.arch == 'win32') {
    return 'C:\\TMP';
  } else {
    return '/tmp';
  }
}

suite('Kits scan test', async () => {
  let cmt: CMakeTools;
  let testEnv: DefaultEnvironment;

  const fakebin = getTestRootFilePath('fakebin');
  const mingwMakePath = path.join(fakebin, 'mingw32-make');
  const mingwMakePathBackup = path.join(fakebin, 'mingw32-make.bak');

  async function disableMingwMake() { await fs.rename(mingwMakePath, mingwMakePathBackup); }

  teardown(async () => {
    if (await fs.exists(mingwMakePathBackup)) {
      await fs.rename(mingwMakePathBackup, mingwMakePath);
    }
  });

  test('gcc target triple match', () => {
    expect(triple.findTargetTriple('Reading specs from ../lib/gcc-lib/powerpc-wrs-vxworks/gcc-2.96/specs'))
      .to.equal('powerpc-wrs-vxworks');
    expect(triple.findTargetTriple(`Reading specs from C:\\WindRiver-VxWorks653-2.2.0.0\\gnu\\3.3.2-vxworks653\\x86-win32\\bin\..\\lib\\gcc-lib\\powerpc-wrs-vxworksae\\3.3.2\\specs`))
      .to.equal('powerpc-wrs-vxworksae');
    expect(triple.findTargetTriple('Target: x86_64-linux-gnu'))
      .to.equal('x86_64-linux-gnu');
    expect(triple.findTargetTriple('Target: x86_64-alpine-linux-musl'))
      .to.equal('x86_64-alpine-linux-musl');
    expect(triple.findTargetTriple('Target: powerpc-wrs-vxworks'))
      .to.equal('powerpc-wrs-vxworks');
    expect(triple.findTargetTriple('Target: x86_64-w64-mingw32'))
      .to.equal('x86_64-w64-mingw32');
    expect(triple.findTargetTriple('Target: i686-w64-mingw32'))
      .to.equal('i686-w64-mingw32');
    expect(triple.findTargetTriple('Target: x86_64-pc-msys'))
      .to.equal('x86_64-pc-msys');
    expect(triple.findTargetTriple('Target: x86_64-pc-windows-msvc'))
      .to.equal('x86_64-pc-windows-msvc');
    expect(triple.findTargetTriple('Target: arm-none-eabi'))
      .to.equal('arm-none-eabi');
    expect(triple.findTargetTriple('Target: arm-none-linux-gnueabi'))
      .to.equal('arm-none-linux-gnueabi');
    expect(triple.findTargetTriple('Target: arm-linux-gnueabihf'))
      .to.equal('arm-linux-gnueabihf');
  });

  test('Detect system kits never throws',
       async () => {
          const build_loc = 'build';
          const exe_res = 'output.txt';

          testEnv = new DefaultEnvironment('test/extension-tests/successful-build/project-folder', build_loc, exe_res);
          cmt = await CMakeTools.create(testEnv.vsContext, testEnv.wsContext);

          await clearExistingKitConfigurationFile();

         // Don't care about the result, just check that we don't throw during the test
         await kit.scanForKits(cmt);
       })
      // Compiler detection can run a little slow
      .timeout(60000);

  test('Detect a GCC compiler file', async () => {
    const compiler = path.join(fakebin, 'gcc-42.1');
    const compkit = await kit.kitIfCompiler(compiler);
    expect(compkit).to.not.be.null;
    expect(compkit!.compilers).has.property('C').equal(compiler);
    expect(compkit!.compilers).to.not.have.property('CXX');
    expect(compkit!.name).to.eq('GCC 42.1 x86_64-pc-linux-gnu');
  });

  test('Detect a GCC cross compiler compiler file', async () => {
    const compiler = path.join(fakebin, 'cross-compile-gcc');
    const compkit = await kit.kitIfCompiler(compiler);
    expect(compkit).to.not.be.null;
    expect(compkit!.compilers).has.property('C').equal(compiler);
    expect(compkit!.compilers).to.not.have.property('CXX');
    expect(compkit!.name).to.eq('GCC 0.2.1000 arm-none-eabi');
  });

  test('Detect a Clang compiler file', async () => {
    const compiler = path.join(fakebin, 'clang-0.25');
    const compkit = await kit.kitIfCompiler(compiler);
    expect(compkit).to.not.be.null;
    expect(compkit!.compilers).has.property('C').eq(compiler);
    expect(compkit!.compilers).to.not.have.property('CXX');
    expect(compkit!.name).to.eq('Clang 0.25 x86_64-pc-linux-gnu');
  });

  test('Detect an Apple-Clang compiler file', async () => {
    const compiler = path.join(fakebin, 'clang-8.1.0');
    const compilerInfo = await kit.getCompilerVersion('Clang', compiler);
    expect(compilerInfo).to.not.be.null;
    expect(compilerInfo?.version).to.eq('8.1.0');
    expect(compilerInfo?.target.targetArch).to.eq('x64');

    const compkit = await kit.kitIfCompiler(compiler);
    expect(compkit).to.not.be.null;
    expect(compkit!.compilers).has.property('C').eq(compiler);
    expect(compkit!.compilers).to.not.have.property('CXX');
    expect(compkit!.name).to.eq('Clang 8.1.0 x86_64-apple-darwin16.7.0');
  });


  test('Detect an MinGW compiler file on linux', async () => {
    if (process.platform === 'win32')
      return;

    await disableMingwMake();

    const compiler = path.join(fakebin, 'mingw32-gcc');
    const compilerInfo = await kit.getCompilerVersion('GCC', compiler);
    expect(compilerInfo).to.not.be.null;
    expect(compilerInfo?.version).to.eq('6.3.0');
    expect(compilerInfo?.target.targetArch).to.eq('x64');

    const compkit = await kit.kitIfCompiler(compiler);

    expect(compkit).to.not.be.null;
    expect(compkit!.compilers).has.property('C').eq(compiler);
    expect(compkit!.compilers).to.not.have.property('CXX');

    expect(compkit!.name).to.eq('GCC 6.3.0 x86_64-w64-mingw32');
    expect(compkit!.preferredGenerator).to.be.undefined;
    expect(compkit!.environmentVariables).to.be.undefined;
  });

  // Test is broken, the use of env path has changed
  test.skip('Detect an MinGW compiler file on windows', async () => {
    if (process.platform !== 'win32')
      return;

    const compiler = path.join(fakebin, 'mingw32-gcc');
    const compkit = await kit.kitIfCompiler(compiler);

    expect(compkit).to.not.be.null;
    expect(compkit!.compilers).has.property('C').eq(compiler);
    expect(compkit!.compilers).to.not.have.property('CXX');

    expect(compkit!.name).to.eq('GCC 6.3.0 x86_64-w64-mingw32');
    expect(compkit!.preferredGenerator!.name).to.eq('MinGW Makefiles');
    expect(compkit!.environmentVariables!.PATH).include('fakebin');
  });

  test('Detect non-compiler program', async () => {
    const program = path.join(fakebin, 'gcc-666');
    const nil = await kit.kitIfCompiler(program);
    expect(nil).to.be.null;
  });

  test('Detect non existing program', async () => {
    const program = path.join(fakebin, 'unknown');
    const nil = await kit.kitIfCompiler(program);
    expect(nil).to.be.null;
  });

  test('Scan non exisiting dir for kits', async () => {
    const kits = await kit.scanDirForCompilerKits('');
    expect(kits.length).to.eq(0);
  });

  suite('Scan directory', async () => {
    let path_with_compilername = '';
    setup(async () => { path_with_compilername = path.join(fakebin, 'gcc-4.3.2'); });
    teardown(async () => {
      if (await fs.exists(path_with_compilername)) {
        await fs.rmdir(path_with_compilername);
      }
    });
    test('Scan directory with compiler name', async () => {
      await fs.mkdir(path_with_compilername);
      // Scan the directory with fake compilers in it
      const kits = await kit.scanDirForCompilerKits(fakebin);
      expect(kits.length).to.eq(5);
    });

    test('Scan file with compiler name', async () => {
      await fs.writeFile(path_with_compilername, '');
      // Scan the directory with fake compilers in it
      const kits = await kit.scanDirForCompilerKits(fakebin);
      expect(kits.length).to.eq(5);
    });
  });

  suite('Rescan kits', async () => {
    test('check empty kit list if no compilers in path', async () => {
      const partial_path = getPathWithoutCompilers();
      const kits = await kit.scanDirForCompilerKits(partial_path);
      const nonVSKits = kits.filter(item => !!item.visualStudio);
      expect(nonVSKits.length).to.be.eq(0);
    }).timeout(10000);

    test('check fake compilers in kit file', async () => {
      const fakebin_dir = getTestRootFilePath('fakebin');
      const kits = await kit.scanDirForCompilerKits(fakebin_dir);
      expect(kits.length).to.be.eq(5);
      const names = kits.map(k => k.name).sort();
      expect(names).to.deep.eq([
        'Clang 0.25 x86_64-pc-linux-gnu',
        'Clang 8.1.0 x86_64-apple-darwin16.7.0',
        'GCC 0.2.1000 arm-none-eabi',
        'GCC 42.1 x86_64-pc-linux-gnu',
        'GCC 6.3.0 x86_64-w64-mingw32'
      ]);
    }).timeout(10000);
  });
});
