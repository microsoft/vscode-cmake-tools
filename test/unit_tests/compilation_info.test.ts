import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as path from 'path';
import * as vscode from 'vscode';

chai.use(chaiAsPromised);

import {expect} from 'chai';
import * as api from '../../src/api';
import * as compdb from '../../src/compdb';

const here = __dirname;
function getTestResourceFilePath(filename: string): string {
  return path.normalize(path.join(here, '../../../test/unit_tests', filename));
}

suite('Compilation info', () => {
  test('Parsing compilation databases', async() => {
    const dbpath = getTestResourceFilePath('test_compdb.json');
    const db = (await compdb.CompilationDatabase.fromFilePath(dbpath))!;
    expect(db).to.not.be.null;
    const source_path = "/home/clang-languageservice/main.cpp";
    const info = db.getCompilationInfoForUri(vscode.Uri.file(source_path))!;
    expect(info).to.not.be.null;
    expect(info.file).to.eq(source_path);
    expect(info.compile!.directory).to.eq('/home/clang-languageservice/build');
    expect(info.compile!.command)
        .to.eq(
            "/usr/local/bin/clang++   -DBOOST_THREAD_VERSION=3 -isystem ../extern/nlohmann-json/src  -g   -std=gnu++11 -o CMakeFiles/clang-languageservice.dir/main.cpp.o -c /home/clang-languageservice/main.cpp");
  });
  test('Parsing gnu-style compile info', () => {
    const raw: api.RawCompilationInfo = {
      command :
          'clang++ -I/foo/bar -isystem /system/path -fsome-compile-flag -DMACRO=DEFINITION -I ../relative/path "-I/path\\"with\\" embedded quotes/foo"',
      directory : '/some/dir',
      file : 'meow.cpp'
    };
    const info = compdb.parseRawCompilationInfo(raw);
    expect(raw.command).to.eq(info.compile!.command);
    expect(raw.directory).to.eq(info.compile!.directory);
    expect(raw.file).to.eq(info.file);
    let idx = info.includeDirectories.findIndex(i => i.path === '/system/path');
    expect(idx).to.be.gte(0);
    let inc = info.includeDirectories[idx];
    expect(inc.isSystem).to.be.true;
    expect(inc.path).to.eq('/system/path');
    idx = info.includeDirectories.findIndex(i => i.path === '/some/relative/path');
    expect(idx).to.be.gte(0);
    inc = info.includeDirectories[idx];
    expect(inc.isSystem).to.be.false;
    inc = info.includeDirectories[3];
    expect(inc.path).to.eq('/path"with" embedded quotes/foo');
    expect(info.compileDefinitions['MACRO']).to.eq('DEFINITION');
    expect(info.compileFlags[0]).to.eq('-fsome-compile-flag');
    expect(info.compiler).to.eq('clang++');
  });

  test('Parsing MSVC-style compile info', () => {
    const raw: api.RawCompilationInfo = {
      command :
          'cl.exe -I/foo/bar /I/system/path /Z+:some-compile-flag /DMACRO=DEFINITION -I ../relative/path "/I/path\\"with\\" embedded quotes/foo"',
      directory : '/some/dir',
      file : 'meow.cpp'
    };
    const info = compdb.parseRawCompilationInfo(raw);
    expect(raw.command).to.eq(info.compile!.command);
    expect(raw.directory).to.eq(info.compile!.directory);
    expect(raw.file).to.eq(info.file);
    let idx = info.includeDirectories.findIndex(i => i.path === '/system/path');
    expect(idx).to.be.gte(0);
    let inc = info.includeDirectories[idx];
    expect(inc.isSystem).to.be.false;
    expect(inc.path).to.eq('/system/path');
    idx = info.includeDirectories.findIndex(i => i.path === '/some/relative/path');
    expect(idx).to.be.gte(0);
    inc = info.includeDirectories[idx];
    expect(inc.isSystem).to.be.false;
    inc = info.includeDirectories[3];
    expect(inc.path).to.eq('/path"with" embedded quotes/foo');
    expect(info.compileDefinitions['MACRO']).to.eq('DEFINITION');
    expect(info.compileFlags[0]).to.eq('/Z+:some-compile-flag');
    expect(info.compiler).to.eq('cl.exe');
  });
});
