import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as path from 'path';
import * as vscode from 'vscode';

chai.use(chaiAsPromised);

import {expect} from 'chai';
import * as sinon from 'sinon';

import * as json5 from 'json5';
import * as ajv from 'ajv';

import * as kit from '../../src/kit';
import {fs} from '../../src/pr';
import * as state from '../../src/state';

// tslint:disable:no-unused-expression

const here = __dirname;
function getTestRootFilePath(filename: string): string {
  return path.normalize(path.join(here, '../../..', 'test', filename));
}


function getTestResourceFilePath(filename: string): string {
  return path.normalize(path.join(here, '../../../test/unit-tests', filename));
}

function getResourcePath(filename: string): string { return path.normalize(path.join(here, '../../..', filename)); }

function getPathWithoutCompilers() {
  if (process.arch == 'win32') {
    return 'C:\\TMP';
  } else {
    return '/tmp';
  }
}

suite('Kits scan test', async () => {
  const fakebin = getTestRootFilePath('fakebin');
  test('Detect system kits never throws',
       async () => {
         // Don't care about the result, just check that we don't throw during the test
         await kit.scanForKits();
       })
      // Compiler detection can run a little slow
      .timeout(12000);

  test('Detect a GCC compiler file', async () => {
    const compiler = path.join(fakebin, 'gcc-42.1');
    const compkit = await kit.kitIfCompiler(compiler);
    expect(compkit).to.not.be.null;
    expect(compkit!.compilers).has.property('C').equal(compiler);
    expect(compkit!.compilers).to.not.have.property('CXX');
    expect(compkit!.name).to.eq('GCC 42.1');
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
      expect(kits.length).to.eq(3);
    });

    test('Scan file with compiler name', async () => {
      await fs.writeFile(path_with_compilername, '');
      // Scan the directory with fake compilers in it
      const kits = await kit.scanDirForCompilerKits(fakebin);
      expect(kits.length).to.eq(3);
    });
  });

  suite('Rescan kits', async () => {
    let km: kit.KitManager;
    const path_rescan_kit = getTestResourceFilePath('rescan_kit.json');
    let sandbox: sinon.SinonSandbox;
    let path_backup: string|undefined;
    setup(async () => {
      sandbox = sinon.sandbox.create();
      const stateMock = sandbox.createStubInstance(state.StateManager);
      sandbox.stub(stateMock, 'activeKitName').get(() => null).set(() => {});
      km = new kit.KitManager(stateMock, path_rescan_kit);

      // Mock showInformationMessage to suppress needed user choice
      sandbox.stub(vscode.window, 'showInformationMessage')
          .callsFake(() => ({title: 'No', isCloseAffordance: true, doOpen: false}));

      path_backup = process.env.PATH;
    });
    teardown(async () => {
      sandbox.restore();
      if (await fs.exists(path_rescan_kit)) {
        await fs.rmdir(path_rescan_kit);
      }
      process.env.PATH = path_backup;
    });

    async function readValidKitFile(file_path: string): Promise<any[]> {
      const rawKitsFromFile = (await fs.readFile(file_path, 'utf8'));
      expect(rawKitsFromFile.length).to.be.not.eq(0);

      const kitFile = json5.parse(rawKitsFromFile);

      const schema = json5.parse(await fs.readFile(getResourcePath('schemas/kits-schema.json'), 'utf8'));
      const validator = new ajv({allErrors: true, format: 'full'}).compile(schema);
      expect(validator(kitFile)).to.be.true;

      return kitFile;
    }

    test('init kit file creation no compilers in path', async () => {
      process.env['PATH'] = getPathWithoutCompilers();

      await km.initialize();

      const newKitFileExists = await fs.exists(path_rescan_kit);
      expect(newKitFileExists).to.be.true;
    }).timeout(10000);

    test('check valid kit file for test system compilers', async () => {
      await km.initialize();

      await readValidKitFile(path_rescan_kit);
    }).timeout(30000);

    test('check empty kit file no compilers in path', async () => {
      process.env['PATH'] = getPathWithoutCompilers();

      await km.initialize();

      const kitFile = await readValidKitFile(path_rescan_kit);
      const nonVSKits = kitFile.filter(item => item.visualStudio == null);
      expect(nonVSKits.length).to.be.eq(0);
    }).timeout(10000);

    // Fails because PATH is tried to split but a empty path is not splitable
    test('check empty kit file', async () => {
      process.env.PATH = '';

      await km.initialize();

      const newKitFileExists = await fs.exists(path_rescan_kit);
      expect(newKitFileExists).to.be.true;
    });

    test('check empty kit file', async () => {
      delete process.env['PATH'];

      await km.initialize();

      const newKitFileExists = await fs.exists(path_rescan_kit);
      expect(newKitFileExists).to.be.true;
    });

    test('check fake compilers in kit file', async () => {
      process.env['PATH'] = getTestRootFilePath('fakebin');

      await km.initialize();

      const kitFile = await readValidKitFile(path_rescan_kit);
      const nonVSKits = kitFile.filter(item => item.visualStudio == null);
      expect(nonVSKits.length).to.be.eq(3);
    }).timeout(10000);

    test('check check combination of scan and old kits', async () => {
      process.env['PATH'] = getTestRootFilePath('fakebin');
      await fs.copyFile(getTestResourceFilePath('test_kit.json'), path_rescan_kit);

      await km.initialize();
      await km.rescanForKits();

      const names = km.kits.map(item => item.name);

      expect(names).to.contains('CompilerKit 1');
      expect(names).to.contains('CompilerKit 2');
      expect(names).to.contains('CompilerKit 3 with PreferedGenerator');
      expect(names).to.contains('ToolchainKit 1');
      expect(names).to.contains('VSCode Kit 1');
      expect(names).to.contains('VSCode Kit 2');
      expect(names).to.contains('Clang 0.25');
      expect(names).to.contains('GCC 42.1');
    }).timeout(10000);
  });
});
