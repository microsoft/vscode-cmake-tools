/* eslint-disable no-unused-expressions */
import { CMakeProject } from '@cmt/cmakeProject';
import { DefaultEnvironment, expect, getFirstSystemKit } from '@test/util';
//import sinon = require('sinon');
import * as fs from 'fs';
import * as path from 'path';

suite('Debug/Launch interface', () => {
    let cmakeProject: CMakeProject;
    let testEnv: DefaultEnvironment;

    setup(async function (this: Mocha.Context) {
        this.timeout(100000);

        testEnv = new DefaultEnvironment('test/end-to-end-tests/successful-build/project-folder', 'build', 'output.txt');
        cmakeProject = await CMakeProject.create(testEnv.wsContext, "${workspaceFolder}/");
        await cmakeProject.setKit(await getFirstSystemKit());
        testEnv.projectFolder.buildDirectory.clear();
        expect(await cmakeProject.build()).to.be.eq(0);
    });

    teardown(async function (this: Mocha.Context) {
        this.timeout(30000);
        await cmakeProject.asyncDispose();
        testEnv.teardown();
    });

    test('Test buildTargetName for use in other extensions or launch.json', async () => {
        const executablesTargets = await cmakeProject.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);

        expect(await cmakeProject.buildTargetName()).to.be.eq(await cmakeProject.allTargetName);

        await cmakeProject.setDefaultTarget(executablesTargets[0].name);
        expect(await cmakeProject.buildTargetName()).to.be.eq(executablesTargets[0].name);
    });

    test('Test launchTargetPath for use in other extensions or launch.json', async () => {
        const executablesTargets = await cmakeProject.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);

        await cmakeProject.setLaunchTargetByName(executablesTargets[0].name);

        expect(await cmakeProject.launchTargetPath()).to.be.eq(executablesTargets[0].path);
    });

    test('Test launchTargetDirectory for use in other extensions or launch.json', async () => {
        const executablesTargets = await cmakeProject.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);

        await cmakeProject.setLaunchTargetByName(executablesTargets[0].name);

        expect(await cmakeProject.launchTargetDirectory()).to.be.eq(path.dirname(executablesTargets[0].path));
    });

    test('Test launchTargetFilename for use in other extensions or launch.json', async () => {
        const executablesTargets = await cmakeProject.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);

        await cmakeProject.setLaunchTargetByName(executablesTargets[0].name);

        expect(await cmakeProject.launchTargetFilename()).to.be.eq(path.basename(executablesTargets[0].path));
    });

    test('Test launchTargetNameForSubstitution for use in other extensions or launch.json', async () => {
        const executablesTargets = await cmakeProject.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);

        await cmakeProject.setLaunchTargetByName(executablesTargets[0].name);

        expect(await cmakeProject.launchTargetNameForSubstitution()).to.be.eq(path.parse(executablesTargets[0].path).name);
    });

    test('Test getLaunchTargetPath for use in other extensions or launch.json', async () => {
        const executablesTargets = await cmakeProject.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);

        await cmakeProject.setLaunchTargetByName(executablesTargets[0].name);

        expect(await cmakeProject.getLaunchTargetPath()).to.be.eq(executablesTargets[0].path);
    });

    test('Test getLaunchTargetDirectory for use in other extensions or launch.json', async () => {
        const executablesTargets = await cmakeProject.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);

        await cmakeProject.setLaunchTargetByName(executablesTargets[0].name);

        expect(await cmakeProject.getLaunchTargetDirectory()).to.be.eq(path.dirname(executablesTargets[0].path));
    });

    test('Test getLaunchTargetFilename for use in other extensions or launch.json', async () => {
        const executablesTargets = await cmakeProject.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);

        await cmakeProject.setLaunchTargetByName(executablesTargets[0].name);

        expect(await cmakeProject.getLaunchTargetFilename()).to.be.eq(path.basename(executablesTargets[0].path));
    });

    test('Test getLaunchTargetName for use in other extensions or launch.json', async () => {
        const executablesTargets = await cmakeProject.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);

        await cmakeProject.setLaunchTargetByName(executablesTargets[0].name);

        expect(await cmakeProject.getLaunchTargetName()).to.be.eq(path.parse(executablesTargets[0].path).name);
    });

    test('Test build on launch (default)', async () => {
        testEnv.config.updatePartial({ buildBeforeRun: undefined });

        const executablesTargets = await cmakeProject.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);
        await cmakeProject.setLaunchTargetByName(executablesTargets[0].name);

        const launchProgramPath = await cmakeProject.launchTargetPath();
        expect(launchProgramPath).to.be.not.null;
        const validPath: string = launchProgramPath!;

        // Check that the compiled files does not exist
        fs.unlinkSync(validPath);
        expect(fs.existsSync(validPath)).to.be.false;

        // Check that the 'get' version does not rebuild the target
        await cmakeProject.getLaunchTargetPath();
        expect(fs.existsSync(validPath)).to.be.false;

        // Check that the original version does rebuild the target
        await cmakeProject.launchTargetPath();
        expect(fs.existsSync(validPath)).to.be.false;
    }).timeout(60000);

    test('Test build on launch on by config', async () => {
        testEnv.config.updatePartial({ buildBeforeRun: true });

        const executablesTargets = await cmakeProject.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);
        await cmakeProject.setLaunchTargetByName(executablesTargets[0].name);

        const launchProgramPath = await cmakeProject.launchTargetPath();
        expect(launchProgramPath).to.be.not.null;
        const validPath: string = launchProgramPath!;

        // Check that the compiled files does not exist
        fs.unlinkSync(validPath);
        expect(fs.existsSync(validPath)).to.be.false;

        await cmakeProject.launchTargetPath();

        // Check that it is compiled as a new file
        expect(fs.existsSync(validPath)).to.be.true;
    }).timeout(60000);

    test('Test build on launch off by config', async () => {
        testEnv.config.updatePartial({ buildBeforeRun: false });

        const executablesTargets = await cmakeProject.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);
        await cmakeProject.setLaunchTargetByName(executablesTargets[0].name);

        const launchProgramPath = await cmakeProject.launchTargetPath();
        expect(launchProgramPath).to.be.not.null;
        const validPath: string = launchProgramPath!;

        // Check that the compiled files does not exist
        fs.unlinkSync(validPath);
        expect(fs.existsSync(validPath)).to.be.false;

        await cmakeProject.launchTargetPath();

        // Check that it is compiled as a new file
        expect(fs.existsSync(validPath)).to.be.false;
    }).timeout(60000);

    test('Test launch target', async () => {
        testEnv.config.updatePartial({ buildBeforeRun: false });

        const executablesTargets = await cmakeProject.executableTargets;
        expect(executablesTargets.length).to.not.eq(0);
        await cmakeProject.setLaunchTargetByName(executablesTargets[0].name);

        const launchProgramPath = await cmakeProject.launchTargetPath();
        expect(launchProgramPath).to.be.not.null;

        // Remove file if exists
        const createdFileOnExecution = path.join(path.dirname(launchProgramPath!), 'test.txt');
        if (fs.existsSync(createdFileOnExecution)) {
            fs.unlinkSync(createdFileOnExecution);
        }

        const terminal = await cmakeProject.launchTarget();
        expect(terminal).to.be.not.null;
        expect(terminal!.name).to.eq(`CMake/Launch - ${executablesTargets[0].name}`);

        const start = new Date();
        // Needed to get launch target result
        await new Promise(resolve => setTimeout(resolve, 3000));

        const elapsed = (new Date().getTime() - start.getTime()) / 1000;
        console.log(`Waited ${elapsed} seconds for output file to appear`);

        const exists = fs.existsSync(createdFileOnExecution);
        // Check that it is compiled as a new file
        expect(exists).to.be.true;

        terminal?.dispose();

        // Needed to ensure things get disposed
        await new Promise((resolve) => setTimeout(resolve, 3000));
    }).timeout(60000);

    test('Test launch same target multiple times when newTerminal run is enabled', async () => {
        testEnv.config.updatePartial({
            buildBeforeRun: false,
            launchBehavior: "newTerminal"
        });

        const executablesTargets = await cmakeProject.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);
        await cmakeProject.setLaunchTargetByName(executablesTargets[0].name);

        const launchProgramPath = await cmakeProject.launchTargetPath();
        expect(launchProgramPath).to.be.not.null;

        // Remove file if exists
        const createdFileOnExecution = path.join(
            path.dirname(launchProgramPath!),
            "test.txt"
        );
        if (fs.existsSync(createdFileOnExecution)) {
            fs.unlinkSync(createdFileOnExecution);
        }

        const term1 = await cmakeProject.launchTarget();
        expect(term1).to.be.not.null;
        const term1Pid = await term1?.processId;

        const term2 = await cmakeProject.launchTarget();
        expect(term2).to.be.not.null;
        expect(term2!.name).to.eq(
            `CMake/Launch - ${executablesTargets[0].name}`
        );

        const term2Pid = await term2?.processId;
        expect(term1Pid).to.not.eq(term2Pid);
        term1?.dispose();
        term2?.dispose();

        // Needed to ensure things get disposed
        await new Promise((resolve) => setTimeout(resolve, 3000));
    }).timeout(60000);

    test('Test launch same target multiple times when newTerminal run is disabled', async () => {
        testEnv.config.updatePartial({
            buildBeforeRun: false,
            launchBehavior: "reuseTerminal"
        });

        const executablesTargets = await cmakeProject.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);
        await cmakeProject.setLaunchTargetByName(executablesTargets[0].name);

        const launchProgramPath = await cmakeProject.launchTargetPath();
        expect(launchProgramPath).to.be.not.null;

        // Remove file if exists
        const createdFileOnExecution = path.join(
            path.dirname(launchProgramPath!),
            "test.txt"
        );
        if (fs.existsSync(createdFileOnExecution)) {
            fs.unlinkSync(createdFileOnExecution);
        }

        const term1 = await cmakeProject.launchTarget();
        expect(term1).to.be.not.null;
        const term1Pid = await term1?.processId;

        const term2 = await cmakeProject.launchTarget();
        expect(term2).to.be.not.null;

        const term2Pid = await term2?.processId;
        expect(term1Pid).to.eq(term2Pid);
        term1?.dispose();
        term2?.dispose();

        // Needed to ensure things get disposed
        await new Promise((resolve) => setTimeout(resolve, 3000));
    }).timeout(60000);
});
