import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { ConfigurationReader, OptionConfig } from '@cmt/config';
import { StatusBar } from '@cmt/status';

suite('Install status button', () => {
    const sandbox = sinon.createSandbox();
    let config: ConfigurationReader;
    let options: OptionConfig;
    let status: StatusBar;
    let install: vscode.StatusBarItem;
    let show: sinon.SinonSpy;
    let hide: sinon.SinonSpy;
    let createItem: sinon.SinonSpy;

    setup(() => {
        config = ConfigurationReader.create(vscode.workspace.workspaceFolders?.[0]);
        options = config.options;
        sandbox.stub(config, 'options').get(() => options);
        createItem = sandbox.spy(vscode.window, 'createStatusBarItem');
        status = new StatusBar(config);
        const item = createItem.returnValues.find((value: vscode.StatusBarItem) => value.command === 'cmake.install');
        if (!item) {
            throw new Error('Install status button was not created.');
        }
        install = item;
        show = sandbox.spy(install, 'show');
        hide = sandbox.spy(install, 'hide');
    });

    teardown(() => {
        status?.dispose();
        config?.dispose();
        sandbox.restore();
    });

    test('shows next to Build with the default settings and invokes the install command', () => {
        status.update();

        sinon.assert.calledOnce(show);
        sinon.assert.notCalled(hide);
        expect(install.text).to.equal('$(desktop-download) Install');
        const build = createItem.returnValues.find((item: vscode.StatusBarItem) => item.command === 'cmake.build');
        expect(build.priority).to.be.greaterThan(install.priority!);
        expect(install.command).to.equal('cmake.install');
    });

    for (const usePresets of [true, false]) {
        test(`remains available in ${usePresets ? 'presets' : 'kits'} mode`, () => {
            status.useCMakePresets(usePresets);
            status.update();

            sinon.assert.calledOnce(show);
            sinon.assert.notCalled(hide);
        });
    }

    test('respects the per-button hidden setting', () => {
        options = { ...options, advanced: { ...options.advanced, install: { statusBarVisibility: 'hidden' } } };
        status.update();

        sinon.assert.calledOnce(hide);
        sinon.assert.notCalled(show);
    });

    test('can show only its icon', () => {
        options = { ...options, advanced: { ...options.advanced, install: { statusBarVisibility: 'icon' } } };
        status.update();

        expect(install.text).to.equal('$(desktop-download)');
        expect(install.tooltip).to.equal('CMake: Build and install the project');
        sinon.assert.calledOnce(show);
    });

    test('inherits the global visibility when no per-button setting is provided', () => {
        options = { statusBarVisibility: 'hidden', advanced: {} };
        status.update();

        sinon.assert.calledOnce(hide);
        sinon.assert.notCalled(show);
    });

    test('hides during a build and restores afterward while Build offers Stop', () => {
        status.setIsBusy(true);
        sinon.assert.calledOnce(hide);
        const stop = createItem.returnValues.find((item: vscode.StatusBarItem) => item.command === 'cmake.stop');
        expect(stop).not.to.equal(undefined);

        status.setIsBusy(false);
        sinon.assert.calledOnce(show);
        expect(install.command).to.equal('cmake.install');
    });

    test('does not override a hidden setting when a build finishes', () => {
        options = { ...options, advanced: { ...options.advanced, install: { statusBarVisibility: 'hidden' } } };
        status.setIsBusy(true);
        status.setIsBusy(false);

        sinon.assert.notCalled(show);
    });

    test('respects overall project visibility', () => {
        status.setVisible(false);
        sinon.assert.calledOnce(hide);
        sinon.assert.notCalled(show);

        status.setVisible(true);
        sinon.assert.calledOnce(show);
    });
});
