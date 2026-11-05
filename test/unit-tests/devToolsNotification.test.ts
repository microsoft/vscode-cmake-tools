import { DevToolsNotification } from '@cmt/ui/devToolsNotification';
import { TestMemento } from '@test/helpers/vscodefake/memento';
import { expect } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

suite('C++ DevTools notification', () => {
    const sandbox = sinon.createSandbox();
    let getExtension: sinon.SinonStub;
    let appRoot: sinon.SinonStub;
    let readFile: sinon.SinonStub;
    let showInformationMessage: sinon.SinonStub;
    let executeCommand: sinon.SinonStub;
    let notification: DevToolsNotification;
    let globalState: TestMemento;
    let extensionChanges: vscode.EventEmitter<void>;
    let subscription: vscode.Disposable | undefined;

    setup(() => {
        subscription = undefined;
        extensionChanges = new vscode.EventEmitter<void>();
        notification = new DevToolsNotification();
        globalState = new TestMemento();
        getExtension = sandbox.stub(vscode.extensions, 'getExtension').returns(undefined);
        getExtension.withArgs('GitHub.copilot-chat').returns({ id: 'GitHub.copilot-chat', isActive: false });
        sandbox.stub(vscode.extensions, 'onDidChange').value(extensionChanges.event);
        appRoot = sandbox.stub(vscode.env, 'appRoot').value('');
        readFile = sandbox.stub().rejects(vscode.FileSystemError.FileNotFound());
        sandbox.stub(vscode.workspace, 'fs').value({ ...vscode.workspace.fs, readFile });
        showInformationMessage = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
        executeCommand = sandbox.stub(vscode.commands, 'executeCommand').resolves(undefined);
    });

    teardown(() => {
        subscription?.dispose();
        extensionChanges.dispose();
        sandbox.restore();
    });

    for (const id of ['GitHub.copilot', 'GitHub.copilot-chat']) {
        test(`shows the toast for installed ${id} without activating it or querying models`, async () => {
            const activate = sandbox.stub().resolves(undefined);
            getExtension.withArgs('GitHub.copilot-chat').returns(undefined);
            getExtension.withArgs(id).returns({ id, isActive: false, activate });

            await notification.showIfNeeded(true, globalState);

            expect(activate.called).to.equal(false);
            expect(showInformationMessage.calledOnce).to.equal(true);
            expect(showInformationMessage.firstCall.args).to.deep.equal([
                'Install C++ DevTools extension to give Copilot more accurate code understanding and build workflows',
                'Install',
                "Don't Show Again"
            ]);
        });
    }

    test('does not show the toast when Copilot is not installed', async () => {
        getExtension.withArgs('GitHub.copilot-chat').returns(undefined);

        await notification.showIfNeeded(true, globalState);

        expect(showInformationMessage.called).to.equal(false);
    });

    test('does not show the toast when DevTools is installed', async () => {
        getExtension.withArgs('ms-vscode.cpp-devtools').returns({ id: 'ms-vscode.cpp-devtools' });

        await notification.showIfNeeded(true, globalState);

        expect(readFile.called).to.equal(false);
        expect(showInformationMessage.called).to.equal(false);
    });

    test('does not show the toast if DevTools is installed during eligibility checking', async () => {
        getExtension.withArgs('ms-vscode.cpp-devtools').onSecondCall().returns({ id: 'ms-vscode.cpp-devtools' });

        await notification.showIfNeeded(true, globalState);

        expect(showInformationMessage.called).to.equal(false);
    });

    test('does not show the toast without an open CMake project', async () => {
        await notification.showIfNeeded(false, globalState);
        expect(showInformationMessage.called).to.equal(false);

        await notification.showIfNeeded(true, globalState);
        expect(showInformationMessage.calledOnce).to.equal(true);
    });

    test('does not show the toast again in the same session after X dismissal', async () => {
        await notification.showIfNeeded(true, globalState);
        await notification.showIfNeeded(true, globalState);

        expect(showInformationMessage.calledOnce).to.equal(true);
    });

    test('allows the toast again in a new session after X dismissal', async () => {
        await notification.showIfNeeded(true, globalState);

        const nextSession = new DevToolsNotification();
        await nextSession.showIfNeeded(true, globalState);

        expect(showInformationMessage.calledTwice).to.equal(true);
    });

    test('does not show duplicate toasts when eligibility checks overlap', async () => {
        await Promise.all([
            notification.showIfNeeded(true, globalState),
            notification.showIfNeeded(true, globalState)
        ]);

        expect(showInformationMessage.calledOnce).to.equal(true);
    });

    test('does not consume the session notification before Copilot is installed', async () => {
        getExtension.withArgs('GitHub.copilot-chat').returns(undefined);
        await notification.showIfNeeded(true, globalState);

        getExtension.withArgs('GitHub.copilot-chat').returns({ id: 'GitHub.copilot-chat' });
        await notification.showIfNeeded(true, globalState);

        expect(showInformationMessage.calledOnce).to.equal(true);
    });

    test('Do Not Show Again suppresses the suggestion in subsequent sessions and workspaces', async () => {
        showInformationMessage.resolves("Don't Show Again");
        await notification.showIfNeeded(true, globalState);
        showInformationMessage.resetHistory();

        const nextSession = new DevToolsNotification();
        await nextSession.showIfNeeded(true, globalState);

        expect(showInformationMessage.called).to.equal(false);
    });

    for (const selection of ['Install', undefined]) {
        test(`does not save permanent suppression for ${selection ?? 'X dismissal'}`, async () => {
            const update = sandbox.spy(globalState, 'update');
            showInformationMessage.resolves(selection);
            await notification.showIfNeeded(true, globalState);

            const nextSession = new DevToolsNotification();
            await nextSession.showIfNeeded(true, globalState);

            expect(update.called).to.equal(false);
            expect(showInformationMessage.calledTwice).to.equal(true);
        });
    }

    test('propagates persistence errors to the activation error boundary', async () => {
        const error = new Error('Unable to save notification preference');
        showInformationMessage.resolves("Don't Show Again");
        sandbox.stub(globalState, 'update').rejects(error);

        let actualError: unknown;
        try {
            await notification.showIfNeeded(true, globalState);
        } catch (e) {
            actualError = e;
        }
        expect(actualError).to.equal(error);
    });

    test('Install directly installs the C++ DevTools extension', async () => {
        showInformationMessage.resolves('Install');

        await notification.showIfNeeded(true, globalState);

        expect(executeCommand.calledOnceWithExactly(
            'workbench.extensions.installExtension',
            'ms-vscode.cpp-devtools'
        )).to.equal(true);
    });

    for (const selection of ["Don't Show Again", undefined]) {
        test(`does not install the extension for ${selection ?? 'X dismissal'}`, async () => {
            showInformationMessage.resolves(selection);

            await notification.showIfNeeded(true, globalState);

            expect(executeCommand.called).to.equal(false);
        });
    }

    test('propagates installation errors to the activation error boundary', async () => {
        const error = new Error('Unable to install C++ DevTools');
        showInformationMessage.resolves('Install');
        executeCommand.rejects(error);

        let actualError: unknown;
        try {
            await notification.showIfNeeded(true, globalState);
        } catch (e) {
            actualError = e;
        }
        expect(actualError).to.equal(error);
    });

    test('rechecks when Copilot is installed without repeating after X dismissal', async () => {
        getExtension.withArgs('GitHub.copilot-chat').returns(undefined);
        subscription = notification.start(() => true, globalState);
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(showInformationMessage.called).to.equal(false);

        getExtension.withArgs('GitHub.copilot-chat').returns({ id: 'GitHub.copilot-chat' });
        extensionChanges.fire();
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(showInformationMessage.calledOnce).to.equal(true);

        extensionChanges.fire();
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(showInformationMessage.calledOnce).to.equal(true);
    });

    test('uses the current CMake project state when installed extensions change', async () => {
        let hasCMakeProject = false;
        subscription = notification.start(() => hasCMakeProject, globalState);
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(showInformationMessage.called).to.equal(false);

        hasCMakeProject = true;
        extensionChanges.fire();
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(showInformationMessage.calledOnce).to.equal(true);
    });

    test('stops rechecking installed extensions when disposed', async () => {
        getExtension.withArgs('GitHub.copilot-chat').returns(undefined);
        subscription = notification.start(() => true, globalState);
        await new Promise<void>(resolve => setImmediate(resolve));
        subscription.dispose();

        getExtension.withArgs('GitHub.copilot-chat').returns({ id: 'GitHub.copilot-chat' });
        extensionChanges.fire();
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(showInformationMessage.called).to.equal(false);
    });

    test('recognizes bundled Copilot when it is absent from the extension registry', async () => {
        getExtension.withArgs('GitHub.copilot-chat').returns(undefined);
        const root = path.resolve('vscode-test-application-root');
        appRoot.value(root);
        readFile.resolves(Buffer.from(JSON.stringify({ publisher: 'GitHub', name: 'copilot-chat' })));

        await notification.showIfNeeded(true, globalState);

        expect(readFile.firstCall.args[0].fsPath).to.equal(vscode.Uri.file(path.join(root, 'extensions', 'copilot', 'package.json')).fsPath);
        expect(showInformationMessage.calledOnce).to.equal(true);
    });

    test('does not show the toast when the bundled Copilot manifest is absent', async () => {
        getExtension.withArgs('GitHub.copilot-chat').returns(undefined);
        appRoot.value(path.resolve('vscode-test-application-root'));

        await notification.showIfNeeded(true, globalState);

        expect(showInformationMessage.called).to.equal(false);
    });

    test('does not mistake an unrelated bundled extension for Copilot', async () => {
        getExtension.withArgs('GitHub.copilot-chat').returns(undefined);
        appRoot.value(path.resolve('vscode-test-application-root'));
        readFile.resolves(Buffer.from(JSON.stringify({ publisher: 'other', name: 'copilot-chat' })));

        await notification.showIfNeeded(true, globalState);

        expect(showInformationMessage.called).to.equal(false);
    });

    test('propagates unexpected bundled-manifest read errors', async () => {
        getExtension.withArgs('GitHub.copilot-chat').returns(undefined);
        appRoot.value(path.resolve('vscode-test-application-root'));
        const error = vscode.FileSystemError.NoPermissions();
        readFile.rejects(error);

        let actualError: unknown;
        try {
            await notification.showIfNeeded(true, globalState);
        } catch (e) {
            actualError = e;
        }
        expect(actualError).to.equal(error);
    });
});
