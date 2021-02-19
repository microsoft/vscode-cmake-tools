import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as path from 'path';
import * as vscode from 'vscode';

chai.use(chaiAsPromised);

import {expect} from 'chai';
import {CMakeCache} from '../../src/cache';
import * as Debugger from '@cmt/debugger';
import * as proc from '@cmt/proc';
import * as sinon from 'sinon';
import { Subprocess } from '@cmt/proc';
import { ChildProcess } from 'child_process';

// tslint:disable:no-unused-expression
// tslint:disable:no-floating-promises

const here = __dirname;
function getTestResourceFilePath(filename: string): string {
  return path.normalize(path.join(here, '../../../test/unit-tests', filename));
}

suite('Select debugger', async () => {
  const sandbox: sinon.SinonSandbox = sinon.createSandbox();

  teardown(() => { sandbox.verifyAndRestore(); });

  function createExecuteReturn(retc: number, child?: ChildProcess): Subprocess {
    return {
      result: Promise.resolve({
        retc,
        stderr: '',
        stdout: ''
      }),
      child
    };
  }

  test('Create debug config from cache - clang with fallback to gdb', async () => {
    const stub = sandbox.stub(proc, 'execute');
    stub.withArgs('lldb-mi').returns(createExecuteReturn(-1)); // Linux needs a separate installation of lldb -> fallback test
    stub.returns(createExecuteReturn(0));

    const target = {name: 'Test', path: 'Target'};
    const cache = await CMakeCache.fromPath(getTestResourceFilePath('TestCMakeCache.txt'));
    const config = await Debugger.getDebugConfigurationFromCache(cache, target, 'linux');
    expect(config).to.not.be.null;
    if (!config) {
      throw new Error();
    }
    expect(config.name).to.be.eq('Debug Test');
    expect(config.type).to.be.eq('cppdbg');
    expect(stub.called).to.be.true;

    // If CppTools extension is installed, the lldb-mi installed with that extension
    // will represent the debugger fallback instead of gdb.
    const cpptoolsExtension = vscode.extensions.getExtension('ms-vscode.cpptools');
    const cpptoolsDebuggerPath = cpptoolsExtension ? path.join(cpptoolsExtension.extensionPath, "debugAdapters", "lldb-mi", "bin", "lldb-mi") : undefined;
    if (cpptoolsDebuggerPath) {
      expect(config['MIMode']).to.be.eq('lldb');
      expect(config['miDebuggerPath']).to.be.eq(cpptoolsDebuggerPath);
      expect(stub.calledWith('gdb')).to.be.false;
    } else {
      expect(config['MIMode']).to.be.eq('gdb');
      expect(config['miDebuggerPath']).to.be.eq('gdb');
      expect(stub.calledWith('gdb')).to.be.true;
    }

    expect(stub.calledWith('lldb-mi')).to.be.true;
  });

  test('Create debug config from cache - GCC', async () => {
    const stub = sandbox.stub(proc, 'execute');
    stub.returns(createExecuteReturn(0));

    const target = {name: 'Test', path: 'Target'};
    const cache = await CMakeCache.fromPath(getTestResourceFilePath('TestCMakeCache-gcc.txt'));

    const config = await Debugger.getDebugConfigurationFromCache(cache, target, 'linux');
    expect(config).to.not.be.null;
    if (!config) {
      throw new Error();
    }
    expect(config.name).to.be.eq('Debug Test');
    expect(config['MIMode']).to.be.eq('gdb');
    expect(config.type).to.be.eq('cppdbg');
    expect(config['miDebuggerPath']).to.be.eq('gdb');
    expect(stub.calledWith('gdb')).to.be.true;
  });

  test('Create debug config from cache invalid gdb', async () => {
    const stub = sandbox.stub(proc, 'execute');
    stub.returns(createExecuteReturn(-1));

    const target = {name: 'Test', path: 'Target'};
    const cache = await CMakeCache.fromPath(getTestResourceFilePath('TestCMakeCache-gcc.txt'));

    expect(Debugger.getDebugConfigurationFromCache(cache, target, 'linux')).to.be.rejectedWith(Error);
  });

  test('Create debug config from cache - GCC 5 fallback test', async () => {
    const stub = sandbox.stub(proc, 'execute');
    stub.withArgs('gdb').returns(createExecuteReturn(0));
    stub.returns(createExecuteReturn(-2));

    const target = {name: 'Test', path: 'Target'};
    const cache = await CMakeCache.fromPath(getTestResourceFilePath('TestCMakeCache-gcc.txt'));

    const config = await Debugger.getDebugConfigurationFromCache(cache, target, 'linux');
    expect(config).to.not.be.null;
    if (!config) {
      throw new Error();
    }
    expect(config.name).to.be.eq('Debug Test');
    expect(config['MIMode']).to.be.eq('gdb');
    expect(config.type).to.be.eq('cppdbg');
    expect(config['miDebuggerPath']).to.be.eq('gdb');
    expect(stub.calledWith('gdb')).to.be.true;
  });

  test('Create debug config from cache - GCC Apple', async () => {
    const stub = sandbox.stub(proc, 'execute');
    stub.returns(createExecuteReturn(0));

    const target = {name: 'Test', path: 'Target'};
    const cache = await CMakeCache.fromPath(getTestResourceFilePath('TestCMakeCache-gcc.txt'));

    const config = await Debugger.getDebugConfigurationFromCache(cache, target, 'darwin');
    expect(config).to.not.be.null;
    if (!config) {
      throw new Error();
    }
    expect(config.name).to.be.eq('Debug Test');
    expect(config['MIMode']).to.be.eq('lldb');
    expect(config.type).to.be.eq('cppdbg');
    expect(config['miDebuggerPath']).to.be.eq('lldb');
    expect(stub.calledWith('lldb')).to.be.true;
  });

  test('Create debug config from cache - g++', async () => {
    const stub = sandbox.stub(proc, 'execute');
    stub.returns(createExecuteReturn(0));

    const target = {name: 'Test', path: 'Target'};
    const cache = await CMakeCache.fromPath(getTestResourceFilePath('TestCMakeCache-g++.txt'));

    const config = await Debugger.getDebugConfigurationFromCache(cache, target, 'linux');
    expect(config).to.not.be.null;
    if (!config) {
      throw new Error();
    }
    expect(config.name).to.be.eq('Debug Test');
    expect(config['MIMode']).to.be.eq('gdb');
    expect(config.type).to.be.eq('cppdbg');
    expect(config['miDebuggerPath']).to.be.eq('gdb');
    expect(stub.calledOnceWith('gdb')).to.be.true;
  });

  test('Create debug config from cache - Visual Studio Community 2017', async () => {
    const target = {name: 'Test', path: 'Target'};
    const cache = await CMakeCache.fromPath(getTestResourceFilePath('TestCMakeCache-msvc-com-2017.txt'));

    const config = await Debugger.getDebugConfigurationFromCache(cache, target, 'win32');
    expect(config).to.not.be.null;
    if (!config) {
      throw new Error();
    }
    expect(config.name).to.be.eq('Debug Test');
    expect(config.type).to.be.eq('cppvsdbg');
  });
});