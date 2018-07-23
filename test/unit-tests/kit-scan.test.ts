import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as path from 'path';

chai.use(chaiAsPromised);

import {expect} from 'chai';
import * as kit from '../../src/kit';
import {fs} from '../../src/pr';

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
  const fakebin = getTestRootFilePath('fakebin');
  const mingwMakePath = path.join(fakebin, 'mingw32-make');
  const mingwMakePathBackup = path.join(fakebin, 'mingw32-make.bak');

  async function disableMingwMake() { await fs.rename(mingwMakePath, mingwMakePathBackup); }

  teardown(async () => {
    if (await fs.exists(mingwMakePathBackup)) {
      await fs.rename(mingwMakePathBackup, mingwMakePath);
    }
  });

  test('Detect system kits never throws',
       async () => {
         // Don't care about the result, just check that we don't throw during the test
         await kit.scanForKits();
       })
      // Compiler detection can run a little slow
      .timeout(60000);

  test('Detect a GCC compiler file', async () => {
    const compiler = path.join(fakebin, 'gcc-42.1');
    const compkit = await kit.kitIfCompiler(compiler);
    expect(compkit).to.not.be.null;
    expect(compkit!.compilers).has.property('C').equal(compiler);
    expect(compkit!.compilers).to.not.have.property('CXX');
    expect(compkit!.name).to.eq('GCC 42.1');
  });

  test('Detect a GCC cross compiler compiler file', async () => {
    const compiler = path.join(fakebin, 'cross-compile-gcc');
    const compkit = await kit.kitIfCompiler(compiler);
    expect(compkit).to.not.be.null;
    expect(compkit!.compilers).has.property('C').equal(compiler);
    expect(compkit!.compilers).to.not.have.property('CXX');
    expect(compkit!.name).to.eq('GCC for cross-compile 0.2.1000');
  });

  test('Detect a Clang compiler file', async () => {
    const compiler = path.join(fakebin, 'clang-0.25');
    const compkit = await kit.kitIfCompiler(compiler);
    expect(compkit).to.not.be.null;
    expect(compkit!.compilers).has.property('C').eq(compiler);
    expect(compkit!.compilers).to.not.have.property('CXX');
    expect(compkit!.name).to.eq('Clang 0.25');
  });

  test('Detect an Apple-Clang compiler file', async () => {
    const compiler = path.join(fakebin, 'clang-8.1.0');
    const compkit = await kit.kitIfCompiler(compiler);
    expect(compkit).to.not.be.null;
    expect(compkit!.compilers).has.property('C').eq(compiler);
    expect(compkit!.compilers).to.not.have.property('CXX');
    expect(compkit!.name).to.eq('Clang 8.1.0');
  });


  test('Detect an MinGW compiler file on linux', async () => {
    if (process.platform === 'win32')
      return;

    await disableMingwMake();

    const compiler = path.join(fakebin, 'mingw32-gcc');
    const compkit = await kit.kitIfCompiler(compiler);

    expect(compkit).to.not.be.null;
    expect(compkit!.compilers).has.property('C').eq(compiler);
    expect(compkit!.compilers).to.not.have.property('CXX');

    expect(compkit!.name).to.eq('GCC for mingw32 6.3.0');
    expect(compkit!.preferredGenerator).to.be.undefined;
    expect(compkit!.environmentVariables).to.be.undefined;
  });

  test('Detect an MinGW compiler file on windows', async () => {
    if (process.platform !== 'win32')
      return;

    const compiler = path.join(fakebin, 'mingw32-gcc');
    const compkit = await kit.kitIfCompiler(compiler);

    expect(compkit).to.not.be.null;
    expect(compkit!.compilers).has.property('C').eq(compiler);
    expect(compkit!.compilers).to.not.have.property('CXX');

    expect(compkit!.name).to.eq('GCC for mingw32 6.3.0');
    expect(compkit!.preferredGenerator!.name).to.eq('MinGW Makefiles');
    expect(compkit!.environmentVariables!.PATH).include('fakebin');
    expect(compkit!.environmentVariables!.PATH).include('${env.PATH}');
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
        'Clang 0.25',
        'Clang 8.1.0',
        'GCC 42.1',
        'GCC for cross-compile 0.2.1000',
        'GCC for mingw32 6.3.0'
      ]);
    }).timeout(10000);
  });
});
