/* eslint-disable no-unused-expressions */
import { CMakeTools } from '@cmt/cmake-tools';
import { DefaultEnvironment, expect, getFirstSystemKit } from '@test/util';
//import sinon = require('sinon');
import * as fs from 'fs';
import * as path from 'path';
import { TerminalOptions } from 'vscode';

suite('Debug/Launch interface', async () => {
    let cmt: CMakeTools;
    let testEnv: DefaultEnvironment;

    setup(async function (this: Mocha.Context) {
        this.timeout(100000);

        testEnv = new DefaultEnvironment('test/extension-tests/successful-build/project-folder', 'build', 'output.txt');
        cmt = await CMakeTools.create(testEnv.vsContext, testEnv.wsContext);
        await cmt.setKit(await getFirstSystemKit(cmt));
        testEnv.projectFolder.buildDirectory.clear();
        expect(await cmt.build()).to.be.eq(0);
    });

    teardown(async function (this: Mocha.Context) {
        this.timeout(30000);
        await cmt.asyncDispose();
        testEnv.teardown();
    });

    test('Test call of debugger', async () => {
        const executablesTargets = await cmt.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);
        await cmt.setLaunchTargetByName(executablesTargets[0].name);

        await cmt.debugTarget();
        //sinon.assert.calledWith(testEnv.vs_debug_start_debugging);
    }).timeout(60000);

    test('Test buildTargetName for use in other extensions or launch.json', async () => {
        const executablesTargets = await cmt.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);

        expect(await cmt.buildTargetName()).to.be.eq(await cmt.allTargetName);

        await cmt.setDefaultTarget(executablesTargets[0].name);
        expect(await cmt.buildTargetName()).to.be.eq(executablesTargets[0].name);
    });

    test('Test launchTargetPath for use in other extensions or launch.json', async () => {
        const executablesTargets = await cmt.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);

        await cmt.setLaunchTargetByName(executablesTargets[0].name);

        expect(await cmt.launchTargetPath()).to.be.eq(executablesTargets[0].path);
    });

    test('Test launchTargetDirectory for use in other extensions or launch.json', async () => {
        const executablesTargets = await cmt.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);

        await cmt.setLaunchTargetByName(executablesTargets[0].name);

        expect(await cmt.launchTargetDirectory()).to.be.eq(path.dirname(executablesTargets[0].path));
    });

    test('Test launchTargetFilename for use in other extensions or launch.json', async () => {
        const executablesTargets = await cmt.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);

        await cmt.setLaunchTargetByName(executablesTargets[0].name);

        expect(await cmt.launchTargetFilename()).to.be.eq(path.basename(executablesTargets[0].path));
    });

    test('Test getLaunchTargetPath for use in other extensions or launch.json', async () => {
        const executablesTargets = await cmt.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);

        await cmt.setLaunchTargetByName(executablesTargets[0].name);

        expect(await cmt.getLaunchTargetPath()).to.be.eq(executablesTargets[0].path);
    });

    test('Test getLaunchTargetDirectory for use in other extensions or launch.json', async () => {
        const executablesTargets = await cmt.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);

        await cmt.setLaunchTargetByName(executablesTargets[0].name);

        expect(await cmt.getLaunchTargetDirectory()).to.be.eq(path.dirname(executablesTargets[0].path));
    });

    test('Test getLaunchTargetFilename for use in other extensions or launch.json', async () => {
        const executablesTargets = await cmt.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);

        await cmt.setLaunchTargetByName(executablesTargets[0].name);

        expect(await cmt.getLaunchTargetFilename()).to.be.eq(path.basename(executablesTargets[0].path));
    });

    test('Test build on launch (default)', async () => {
        testEnv.config.updatePartial({ buildBeforeRun: undefined });

        const executablesTargets = await cmt.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);
        await cmt.setLaunchTargetByName(executablesTargets[0].name);

        const launchProgramPath = await cmt.launchTargetPath();
        expect(launchProgramPath).to.be.not.null;
        const validPath: string = launchProgramPath!;

        // Check that the compiled files does not exist
        fs.unlinkSync(validPath);
        expect(fs.existsSync(validPath)).to.be.false;

        // Check that the 'get' version does not rebuild the target
        await cmt.getLaunchTargetPath();
        expect(fs.existsSync(validPath)).to.be.false;

        // Check that the original version does rebuild the target
        await cmt.launchTargetPath();
        expect(fs.existsSync(validPath)).to.be.false;
    }).timeout(60000);

    test('Test build on launch on by config', async () => {
        testEnv.config.updatePartial({ buildBeforeRun: true });

        const executablesTargets = await cmt.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);
        await cmt.setLaunchTargetByName(executablesTargets[0].name);

        const launchProgramPath = await cmt.launchTargetPath();
        expect(launchProgramPath).to.be.not.null;
        const validPath: string = launchProgramPath!;

        // Check that the compiled files does not exist
        fs.unlinkSync(validPath);
        expect(fs.existsSync(validPath)).to.be.false;

        await cmt.launchTargetPath();

        // Check that it is compiled as a new file
        expect(fs.existsSync(validPath)).to.be.true;
    }).timeout(60000);

    test('Test build on launch off by config', async () => {
        testEnv.config.updatePartial({ buildBeforeRun: false });

        const executablesTargets = await cmt.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);
        await cmt.setLaunchTargetByName(executablesTargets[0].name);

        const launchProgramPath = await cmt.launchTargetPath();
        expect(launchProgramPath).to.be.not.null;
        const validPath: string = launchProgramPath!;

        // Check that the compiled files does not exist
        fs.unlinkSync(validPath);
        expect(fs.existsSync(validPath)).to.be.false;

        await cmt.launchTargetPath();

        // Check that it is compiled as a new file
        expect(fs.existsSync(validPath)).to.be.false;
    }).timeout(60000);

    test('Test launch target', async () => {
        testEnv.config.updatePartial({ buildBeforeRun: false });

        const executablesTargets = await cmt.executableTargets;
        expect(executablesTargets.length).to.not.eq(0);
        await cmt.setLaunchTargetByName(executablesTargets[0].name);

        const launchProgramPath = await cmt.launchTargetPath();
        expect(launchProgramPath).to.be.not.null;

        // Remove file if exists
        const createdFileOnExecution = path.join(path.dirname(launchProgramPath!), 'test.txt');
        if (fs.existsSync(createdFileOnExecution)) {
            fs.unlinkSync(createdFileOnExecution);
        }

        const terminal = await cmt.launchTarget();
        expect(terminal).to.be.not.null;
        expect(terminal!.name).to.eq('CMake/Launch');

        const start = new Date();
        let exists = false;
        for (let i = 0; i < 30; ++i) {
            // Needed to get launch target result
            await new Promise(resolve => setTimeout(resolve, 1000));
            exists = fs.existsSync(createdFileOnExecution);
            const elapsed = (new Date().getTime() - start.getTime()) / 1000;
            console.log(`File: ${createdFileOnExecution} exists:${exists}  elapsed:${elapsed} launchProgramPath:${launchProgramPath} name:${executablesTargets[0].name}`);
            if (exists) {
                break;
            }
        }
        console.log(`Target files:${JSON.stringify(fs.readdirSync(path.dirname(launchProgramPath!)))} cwd:${(terminal?.creationOptions as TerminalOptions).cwd}`);

        // Check that it is compiled as a new file
        expect(exists).to.be.true;
    }).timeout(60000);

    test('Test launch same target multiple times when newTerminal run is enabled', async () => {
        testEnv.config.updatePartial({
            buildBeforeRun: false,
            launchBehavior: 'newTerminal'
        });

        const executablesTargets = await cmt.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);
        await cmt.setLaunchTargetByName(executablesTargets[0].name);

        const launchProgramPath = await cmt.launchTargetPath();
        expect(launchProgramPath).to.be.not.null;

        // Remove file if exists
        const createdFileOnExecution = path.join(path.dirname(launchProgramPath!), 'test.txt');
        if (fs.existsSync(createdFileOnExecution)) {
            fs.unlinkSync(createdFileOnExecution);
        }

        const term1 = await cmt.launchTarget();
        expect(term1).to.be.not.null;
        const term1Pid = await term1?.processId;

        const term2 = await cmt.launchTarget();
        expect(term2).to.be.not.null;
        expect(term2!.name).of.be.eq('CMake/Launch');

        const term2Pid = await term2?.processId;
        expect(term1Pid).to.not.eq(term2Pid);
    }).timeout(60000);

    test('Test launch same target multiple times when newTerminal run is disabled', async () => {
        testEnv.config.updatePartial({
            buildBeforeRun: false,
            launchBehavior: 'reuseTerminal'
        });

        const executablesTargets = await cmt.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);
        await cmt.setLaunchTargetByName(executablesTargets[0].name);

        const launchProgramPath = await cmt.launchTargetPath();
        expect(launchProgramPath).to.be.not.null;

        // Remove file if exists
        const createdFileOnExecution = path.join(path.dirname(launchProgramPath!), 'test.txt');
        if (fs.existsSync(createdFileOnExecution)) {
            fs.unlinkSync(createdFileOnExecution);
        }

        const term1 = await cmt.launchTarget();
        expect(term1).to.be.not.null;
        const term1Pid = await term1?.processId;

        const term2 = await cmt.launchTarget();
        expect(term2).to.be.not.null;

        const term2Pid = await term2?.processId;
        expect(term1Pid).to.eq(term2Pid);
    }).timeout(60000);
});

