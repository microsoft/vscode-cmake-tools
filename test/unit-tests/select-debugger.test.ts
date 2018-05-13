import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as path from 'path';

chai.use(chaiAsPromised);

import {expect} from 'chai';
import {CMakeCache} from '../../src/cache';
import * as Debugger from '@cmt/debugger';

// tslint:disable:no-unused-expression

const here = __dirname;
function getTestResourceFilePath(filename: string): string {
  return path.normalize(path.join(here, '../../../test/unit-tests', filename));
}

suite.only('Select debugger', async () => {
  test('Create debug config from cache - clang', async () => {
    const target = {name: 'Test', path: 'Target'};
    const cache = await CMakeCache.fromPath(getTestResourceFilePath('TestCMakeCache.txt'));
    const config = Debugger.getDebugConfigurationFromCache(cache, target, 'linux');

    expect(config.name).to.be.eq('Debug Test');
    expect(config['MIMode']).to.be.eq('lldb');
    expect(config.type).to.be.eq('cppdbg');
    expect(config['miDebuggerPath']).to.be.eq('/usr/local/bin/lldb');
  });

  test('Create debug config from cache - GCC', async () => {
    const target = {name: 'Test', path: 'Target'};
    const cache = await CMakeCache.fromPath(getTestResourceFilePath('TestCMakeCache-gcc.txt'));

    const config = Debugger.getDebugConfigurationFromCache(cache, target, 'linux');

    expect(config.name).to.be.eq('Debug Test');
    expect(config['MIMode']).to.be.eq('gdb');
    expect(config.type).to.be.eq('cppdbg');
    expect(config['miDebuggerPath']).to.be.eq('/usr/local/bin/gdb');
  });

  test('Create debug config from cache - GCC Apple', async () => {
    const target = {name: 'Test', path: 'Target'};
    const cache = await CMakeCache.fromPath(getTestResourceFilePath('TestCMakeCache-gcc.txt'));

    const config = Debugger.getDebugConfigurationFromCache(cache, target, 'darwin');

    expect(config.name).to.be.eq('Debug Test');
    expect(config['MIMode']).to.be.eq('lldb');
    expect(config.type).to.be.eq('cppdbg');
    expect(config['miDebuggerPath']).to.be.eq('/usr/local/bin/lldb');
  });

  test('Create debug config from cache - g++', async () => {
    const target = {name: 'Test', path: 'Target'};
    const cache = await CMakeCache.fromPath(getTestResourceFilePath('TestCMakeCache-g++.txt'));

    const config = Debugger.getDebugConfigurationFromCache(cache, target, 'linux');

    expect(config.name).to.be.eq('Debug Test');
    expect(config['MIMode']).to.be.eq('gdb');
    expect(config.type).to.be.eq('cppdbg');
    expect(config['miDebuggerPath']).to.be.eq('/usr/local/bin/gdb');
  });


  test('Create debug config from cache - Visual Studio Community 2017', async () => {
    const target = {name: 'Test', path: 'Target'};
    const cache = await CMakeCache.fromPath(getTestResourceFilePath('TestCMakeCache-msvc-com-2017.txt'));

    const config = Debugger.getDebugConfigurationFromCache(cache, target, 'win32');

    expect(config.name).to.be.eq('Debug Test');
    expect(config.type).to.be.eq('cppvsdbg');
  });
});