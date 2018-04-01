import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as path from 'path';

chai.use(chaiAsPromised);

import {expect} from 'chai';
import {CMakeQuickStart, ProjectType} from '../../src/quickstart';
import {fs} from '../../src/pr';

// tslint:disable:no-unused-expression

const here = __dirname;
function getTestWorkspace(): string { return path.normalize(path.join(here, '../../../', 'testWorkspace')); }


suite('QuickStart test', async () => {
  const working_path = getTestWorkspace();
  setup(async () => { await fs.mkdir_p(working_path); });

  teardown(async () => { await fs.rmdir(working_path); });

  test('CMakeLists.txt exists', async () => {
    await fs.writeFile(path.join(working_path, 'CMakeLists.txt'), 'Dummy');

    expect(() => new CMakeQuickStart(working_path)).to.throws(
        'Source code directory contains already a CMakeLists.txt');
  });


  test('Create library', async () => {
    const obj = new CMakeQuickStart(working_path);
    await obj.createProject('libraryTest', ProjectType.Library);

    // Check cmake file
    const cmakeFilePath = path.join(working_path, 'CMakeLists.txt');
    expect(await fs.exists(cmakeFilePath), 'Expect new CMakeLists.txt file in workspace_path').to.be.true;

    const cmakeListContent = (await fs.readFile(cmakeFilePath)).toString();
    expect(cmakeListContent).to.contain('add_library(libraryTest libraryTest.cpp)');
    expect(cmakeListContent).to.contain('project(libraryTest VERSION 0.1.0)');

    // Check library source code
    const libraryBodyFilePath = path.join(working_path, 'libraryTest.cpp');
    expect(await fs.exists(libraryBodyFilePath), 'Expect new "libraryTest.cpp" in workspace_path').to.be.true;
    const libraryBodyFileContent = (await fs.readFile(libraryBodyFilePath)).toString();
    expect(libraryBodyFileContent).to.contain('std::cout << "Hello, from libraryTest!\\n"');
  });

  test('Create library file exists', async () => {
    const libraryBodyFilePath = path.join(working_path, 'libraryTest.cpp');
    await fs.writeFile(libraryBodyFilePath, 'OldFile');
    const obj = new CMakeQuickStart(working_path);
    await obj.createProject('libraryTest', ProjectType.Exectable);

    const libraryBodyFileContent = (await fs.readFile(libraryBodyFilePath)).toString();
    expect(libraryBodyFileContent, 'libraryTest.cpp file is overwritten unexpected.').to.contain('OldFile');
  });

  test('Create executeable', async () => {
    const obj = new CMakeQuickStart(working_path);
    await obj.createProject('executableTest', ProjectType.Exectable);

    // Check cmake file
    const cmakeFilePath = path.join(working_path, 'CMakeLists.txt');
    expect(await fs.exists(cmakeFilePath), 'Expect new CMakeLists.txt file in workspace_path').to.be.true;

    const cmakeListContent = (await fs.readFile(cmakeFilePath)).toString();
    expect(cmakeListContent).to.contain('add_executable(executableTest main.cpp)');
    expect(cmakeListContent).to.contain('project(executableTest VERSION 0.1.0)');

    // Check source code
    const executableBodyFilePath = path.join(working_path, 'main.cpp');
    expect(await fs.exists(executableBodyFilePath), 'Expect new "main.cpp" in workspace_path').to.be.true;
    const executableBodyFileContent = (await fs.readFile(executableBodyFilePath)).toString();
    expect(executableBodyFileContent).to.contain('std::cout << "Hello, world!\\n";');
  });

  test('Create executable file exists', async () => {
    const mainFilePath = path.join(working_path, 'main.cpp');
    await fs.writeFile(mainFilePath, 'OldFile');
    const obj = new CMakeQuickStart(working_path);
    await obj.createProject('executableTest', ProjectType.Exectable);

    const mainBodyFileContent = (await fs.readFile(mainFilePath)).toString();
    expect(mainBodyFileContent, 'Main body file is overwritten unexpected.').to.contain('OldFile');
  });
});
