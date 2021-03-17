import {parseCompileFlags, getIntelliSenseMode, CppConfigurationProvider} from '@cmt/cpptools';
import {expect} from '@test/util';
import { CMakeCache } from '@cmt/cache';
import * as path from 'path';
import * as codemodel_api from '@cmt/drivers/codemodel-driver-interface';
import * as vscode from 'vscode';
import { Version } from 'vscode-cpptools';
import * as util from '@cmt/util';

// tslint:disable:no-unused-expression

const here = __dirname;
function getTestResourceFilePath(filename: string): string {
  return path.normalize(path.join(here, '../../../test/unit-tests', filename));
}

suite('CppTools tests', () => {
  test('Parse some compiler flags', () => {
    // Parse definition
    const cpptoolsVersion3 = Version.v3;
    const cpptoolsVersion4 = Version.v4;

    // Verify CppTools API version 4
    let info = parseCompileFlags(cpptoolsVersion4, ['-DFOO=BAR']);
    expect(info.extraDefinitions).to.eql(['FOO=BAR']);
    info = parseCompileFlags(cpptoolsVersion4, ['-D', 'FOO=BAR']);
    expect(info.extraDefinitions).to.eql(['FOO=BAR']);
    info = parseCompileFlags(cpptoolsVersion4, ['-DFOO=BAR', '/D', 'BAZ=QUX']);
    expect(info.extraDefinitions).to.eql(['FOO=BAR', 'BAZ=QUX']);
    expect(info.standard).to.eql(undefined);
    // Parse language standard
    info = parseCompileFlags(cpptoolsVersion4, ['-std=c++03']);
    expect(info.standard).to.eql('c++03');
    info = parseCompileFlags(cpptoolsVersion4, ['-std=gnu++14']);
    expect(info.standard).to.eql('gnu++14');
    info = parseCompileFlags(cpptoolsVersion4, ['-std=c17']);
    expect(info.standard).to.eql('c17');
    // Parse target architecture
    info = parseCompileFlags(cpptoolsVersion4, ['--target=aarch64-arm-none-eabi']);
    expect(info.targetArch).to.eql('arm64');
    info = parseCompileFlags(cpptoolsVersion4, ['-target', 'arm-arm-none-eabi']);
    expect(info.targetArch).to.eql('arm');
    info = parseCompileFlags(cpptoolsVersion4, ['-arch=x86_64']);
    expect(info.targetArch).to.eql('x64');
    info = parseCompileFlags(cpptoolsVersion4, ['-arch', 'aarch64']);
    expect(info.targetArch).to.eql('arm64');
    info = parseCompileFlags(cpptoolsVersion4, ['-arch', 'i686']);
    expect(info.targetArch).to.eql('x86');
    info = parseCompileFlags(cpptoolsVersion4, ['/arch:x86_64']);
    expect(info.targetArch).to.eql('x64');
    info = parseCompileFlags(cpptoolsVersion4, ['-march=amd64']);
    expect(info.targetArch).to.eql('x64');
    info = parseCompileFlags(cpptoolsVersion4, ['-m32']);
    expect(info.targetArch).to.eql('x86');
    info = parseCompileFlags(cpptoolsVersion4, ['-m00']);
    expect(info.targetArch).to.eql(undefined);

    // Verify CppTools API version 3
    info = parseCompileFlags(cpptoolsVersion3, ['-std=c++03']);
    expect(info.standard).to.eql('c++03');
    info = parseCompileFlags(cpptoolsVersion3, ['-std=gnu++14']);
    expect(info.standard).to.eql('c++14');
    info = parseCompileFlags(cpptoolsVersion3, ['-std=c17']);
    expect(info.standard).to.eql('c11');
  });

  test('Get IntelliSenseMode', () => {
    const cpptoolsVersion3 = Version.v3;
    const cpptoolsVersion4 = Version.v4;

    // Verify CppTools API version 4
    let mode = getIntelliSenseMode(cpptoolsVersion4, 'armclang', 'arm');
    expect(mode).to.eql('clang-arm');
    mode = getIntelliSenseMode(cpptoolsVersion4, 'armclang', 'arm64');
    expect(mode).to.eql('clang-arm64');
    mode = getIntelliSenseMode(cpptoolsVersion4, 'armclang', undefined);
    expect(mode).to.eql('clang-arm');
    mode = getIntelliSenseMode(cpptoolsVersion4, 'clang', 'x64');
    expect(mode).to.eql('clang-x64');
    mode = getIntelliSenseMode(cpptoolsVersion4, 'clang', 'arm');
    expect(mode).to.eql('clang-arm');
    mode = getIntelliSenseMode(cpptoolsVersion4, 'gcc', undefined);
    expect(mode).to.eql('gcc-x64');
    mode = getIntelliSenseMode(cpptoolsVersion4, 'g++', 'x86');
    expect(mode).to.eql('gcc-x86');
    mode = getIntelliSenseMode(cpptoolsVersion4, 'arm-none-eabi-g++', undefined);
    expect(mode).to.eql('gcc-arm');
    mode = getIntelliSenseMode(cpptoolsVersion4, 'aarch64-linux-gnu-gcc', undefined);
    expect(mode).to.eql('gcc-arm64');
    mode = getIntelliSenseMode(cpptoolsVersion4, 'bin//Hostx64//x64//cl.exe', undefined);
    expect(mode).to.eql('msvc-x64');
    mode = getIntelliSenseMode(cpptoolsVersion4, 'bin//Hostx64//x86//cl.exe', undefined);
    expect(mode).to.eql('msvc-x86');
    mode = getIntelliSenseMode(cpptoolsVersion4, 'bin//Hostx64//ARM//cl.exe', undefined);
    expect(mode).to.eql('msvc-arm');
    mode = getIntelliSenseMode(cpptoolsVersion4, 'bin//Hostx64//ARM64//cl.exe', undefined);
    expect(mode).to.eql('msvc-arm64');
    mode = getIntelliSenseMode(cpptoolsVersion4, 'cl.exe', undefined);
    expect(mode).to.eql('msvc-x64');

    // Verify CppTools API version 3
    mode = getIntelliSenseMode(cpptoolsVersion3, 'bin//Hostx64//arm//cl.exe', undefined);
    expect(mode).to.eql('msvc-x86');
    mode = getIntelliSenseMode(cpptoolsVersion3, 'bin//Hostx64//arm64//cl.exe', undefined);
    expect(mode).to.eql('msvc-x64');
    mode = getIntelliSenseMode(cpptoolsVersion3, 'arm-none-eabi-g++', undefined);
    expect(mode).to.eql('gcc-x86');
    mode = getIntelliSenseMode(cpptoolsVersion3, 'aarch64-linux-gnu-gcc', undefined);
    expect(mode).to.eql('gcc-x64');
    mode = getIntelliSenseMode(cpptoolsVersion3, 'clang', 'arm64');
    expect(mode).to.eql('clang-x64');
    mode = getIntelliSenseMode(cpptoolsVersion3, 'clang', 'arm');
    expect(mode).to.eql('clang-x86');
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
      }],
      toolchains: new Map<string, codemodel_api.CodeModelToolchain>()
    };

    provider.updateConfigurationData({cache, codeModel, activeTarget: 'target1', folder: here});

    // Update configuration with a 2nd workspace folder.
    const smokeFolder = path.join(here, '../smoke');
    const sourceFile2 = path.join(smokeFolder, 'main.cpp');
    const uri2 = vscode.Uri.file(sourceFile2);
    const codeModel2: codemodel_api.CodeModelContent = {
      configurations: [{
        projects: [{
          name: 'cpptools-test2',
          sourceDirectory: smokeFolder,
          targets: [
            {
              name: 'target3',
              type: 'EXECUTABLE',
              fileGroups: [{
                sources: [sourceFile2],
                isGenerated: false,
                compileFlags: '-DFLAG3',
                language: 'CXX'
              }]
            }]
        }]
      }],
      toolchains: new Map<string, codemodel_api.CodeModelToolchain>([['CXX', { path: 'path_from_toolchain_object' }]])
    };
    provider.updateConfigurationData({cache, codeModel: codeModel2, activeTarget: 'target3', folder: smokeFolder});

    let configurations = await provider.provideConfigurations([vscode.Uri.file(sourceFile2)]);
    expect(configurations.length).to.eq(1);
    expect(configurations[0].configuration.compilerPath).to.eq('path_from_toolchain_object');

    configurations = await provider.provideConfigurations([uri]);
    expect(configurations.length).to.eq(1);
    expect(configurations[0].configuration.defines).to.contain('FLAG1');

    provider.updateConfigurationData({cache, codeModel, activeTarget: 'target2', folder: here});
    configurations = await provider.provideConfigurations([uri]);
    expect(configurations.length).to.eq(1);
    expect(configurations[0].configuration.defines).to.contain('FLAG2');
    expect(configurations[0].configuration.compilerPath).to.eq('clang++');

    provider.updateConfigurationData({cache, codeModel, activeTarget: 'all', folder: here});
    configurations = await provider.provideConfigurations([uri]);
    expect(configurations.length).to.eq(1);
    expect(configurations[0].configuration.defines.some(def => def === 'FLAG1' || def === 'FLAG2')).to.be.true;
    expect(configurations[0].configuration.defines).to.not.have.all.members(['FLAG1', 'FLAG2']);

    // Verify the per-folder browsePath.
    const canProvideBrowseConfigPerFolder: boolean = await provider.canProvideBrowseConfigurationsPerFolder();
    expect(canProvideBrowseConfigPerFolder).to.eq(true);
    const browseConfig = await provider.provideFolderBrowseConfiguration(vscode.Uri.file(here));
    expect(browseConfig.browsePath.length).to.eq(1);
    expect(browseConfig.browsePath[0]).to.eq(util.platformNormalizePath(here));

    // Verify the browsePath with a different folder.
    const configurations2 = await provider.provideConfigurations([uri2]);
    expect(configurations2.length).to.eq(1);
    expect(configurations2[0].configuration.defines).to.contain('FLAG3');
    const browseConfig2 = await provider.provideFolderBrowseConfiguration(vscode.Uri.file(smokeFolder));
    expect(browseConfig2.browsePath.length).to.eq(1);
    expect(browseConfig2.browsePath[0]).to.eq(util.platformNormalizePath(smokeFolder));
  });
});
