import {parseCompileFlags, CppConfigurationProvider} from '@cmt/cpptools';
import {expect} from '@test/util';
import { CMakeCache } from '@cmt/cache';
import * as path from 'path';
import * as codemodel_api from '@cmt/drivers/codemodel-driver-interface';
import * as vscode from 'vscode';

// tslint:disable:no-unused-expression

const here = __dirname;
function getTestResourceFilePath(filename: string): string {
  return path.normalize(path.join(here, '../../../test/unit-tests', filename));
}

suite('CppTools tests', () => {
  test('Parse some compiler flags', () => {
    let info = parseCompileFlags(['-DFOO=BAR']);
    expect(info.extraDefinitions).to.eql(['FOO=BAR']);
    info = parseCompileFlags(['-D', 'FOO=BAR']);
    expect(info.extraDefinitions).to.eql(['FOO=BAR']);
    info = parseCompileFlags(['-DFOO=BAR', '/D', 'BAZ=QUX']);
    expect(info.extraDefinitions).to.eql(['FOO=BAR', 'BAZ=QUX']);
    expect(info.standard).to.eql('c++17');
    info = parseCompileFlags(['-std=c++03']);
    expect(info.standard).to.eql('c++03');
  });

  test('Validate code model', async () => {
    const provider = new CppConfigurationProvider();
    const cache = await CMakeCache.fromPath(getTestResourceFilePath('TestCMakeCache.txt'));
    const sourceFile = path.join(here, 'main.cpp');
    const uri = vscode.Uri.file(sourceFile);
    const codeModel: codemodel_api.CodeModelContent = {
      configurations: [{
        projects: [{
          name: 'cpptools-test',
          sourceDirectory: here,
          targets: [
            {
              name: 'target1',
              type: 'EXECUTABLE',
              fileGroups: [{
                sources: [sourceFile],
                isGenerated: false,
                compileFlags: '-DFLAG1',
                language: 'CXX'
              }]
            },
            {
              name: 'target2',
              type: 'EXECUTABLE',
              fileGroups: [{
                sources: [sourceFile],
                isGenerated: false,
                compileFlags: '-DFLAG2',
                language: 'CXX'
              }]
            }
          ]
        }]
      }]
    };

    provider.updateConfigurationData({cache, codeModel, activeTarget: 'target1', folder: here});
    let configurations = await provider.provideConfigurations([uri]);
    expect(configurations.length).to.eq(1);
    expect(configurations[0].configuration.defines).to.contain('FLAG1');

    provider.updateConfigurationData({cache, codeModel, activeTarget: 'target2', folder: here});
    configurations = await provider.provideConfigurations([uri]);
    expect(configurations.length).to.eq(1);
    expect(configurations[0].configuration.defines).to.contain('FLAG2');

    provider.updateConfigurationData({cache, codeModel, activeTarget: 'all', folder: here});
    configurations = await provider.provideConfigurations([uri]);
    expect(configurations.length).to.eq(1);
    expect(configurations[0].configuration.defines.some(def => def === 'FLAG1' || def === 'FLAG2')).to.be.true;
    expect(configurations[0].configuration.defines).to.not.have.all.members(['FLAG1', 'FLAG2']);
  });
});
