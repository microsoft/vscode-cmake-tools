import {CMakeTools} from '@cmt/cmake-tools';
import {fs} from '@cmt/pr';
import {ProjectType} from '@cmt/quickstart';
import {DefaultEnvironment, expect} from '@test/util';
import * as path from 'path';


suite('[Quickstart]', async () => {
  let cmt: CMakeTools;
  let testEnv: DefaultEnvironment;

  setup(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(100000);

    testEnv
        = new DefaultEnvironment('test/extension-tests/without-cmakelist-file/project-folder', 'build', 'output.txt');
    cmt = await CMakeTools.create(testEnv.vsContext);
  });

  teardown(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(30000);
    await cmt.asyncDispose();
    testEnv.projectFolder.clear();
    testEnv.teardown();
  });

  test('Test create new project', async () => {
    // select default kit
    await cmt.scanForKits();
    await cmt.selectKit();

    // run quick start
    testEnv.quickStartProjectTypeSelection.type = ProjectType.Exectable;
    testEnv.quickStartProjectNameInput.projectName = 'Hallo';
    expect(await cmt.quickStart()).to.be.eq(0);

    // Check that no error war created at quickstart workflow
    expect(testEnv.errorMessagesQueue.length).to.be.eq(0);

    // Check creation of cmake file
    expect(testEnv.projectFolder.cmakeListContent).to.contain('project(Hallo VERSION 0.1.0)');

    // Check execution of configure()
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'expected cache is present');

    // Check opening of main file
    expect(testEnv.openTextDocumentQueue.length).to.be.eq(1);
    expect(testEnv.openTextDocumentQueue[0]).to.be.contains('main.cpp');
  }).timeout(120000);

  test('Test error on CMakeLists.txt file present', async () => {
    await fs.writeFile(path.join(testEnv.projectFolder.location, 'CMakeLists.txt'), 'dummy');

    expect(await cmt.quickStart()).to.be.not.eq(0);

    // Check that no error war created at quickstart workflow
    expect(testEnv.errorMessagesQueue.length).to.be.eq(1);
    expect(testEnv.errorMessagesQueue[0]).to.contain('Source code directory contains already a CMakeLists.txt');

    // Check execution of configure()
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(false, 'expected cache not present');
  }).timeout(120000);

  test('Test no project name', async () => {
    testEnv.quickStartProjectNameInput.projectName = '';

    expect(await cmt.quickStart()).to.be.not.eq(0);

    // Check execution of configure()
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(false, 'expected cache not present');
  }).timeout(120000);

  test('Test abort project type', async () => {
    testEnv.quickStartProjectNameInput.projectName = 'Hallo';
    testEnv.quickStartProjectTypeSelection.abort = true;

    expect(await cmt.quickStart()).to.be.not.eq(0);

    // Check execution of configure()
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(false, 'expected cache not present');
  }).timeout(120000);
});
