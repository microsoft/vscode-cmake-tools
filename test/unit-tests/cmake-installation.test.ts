import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import paths from '@cmt/paths';
import { getCMakeInstallCommand, showCMakeInstallationMessage } from '@cmt/cmakeInstallation';

suite('CMake installation guidance', () => {
    const sandbox = sinon.createSandbox();
    const folder: vscode.WorkspaceFolder = { uri: vscode.Uri.file(process.cwd()), name: 'project', index: 0 };
    let which: sinon.SinonStub;
    let showErrorMessage: sinon.SinonStub;
    let createTerminal: sinon.SinonStub;
    let openExternal: sinon.SinonStub;
    let sendText: sinon.SinonStub;
    let showTerminal: sinon.SinonStub;

    setup(() => {
        which = sandbox.stub(paths, 'which').resolves(null);
        showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
        openExternal = sandbox.stub(vscode.env, 'openExternal').resolves(true);
        sendText = sandbox.stub();
        showTerminal = sandbox.stub();
        const terminal: vscode.Terminal = {
            name: 'Install CMake',
            processId: Promise.resolve(undefined),
            creationOptions: {},
            exitStatus: undefined,
            state: { isInteractedWith: false },
            sendText,
            show: showTerminal,
            hide: sandbox.stub(),
            dispose: sandbox.stub()
        };
        createTerminal = sandbox.stub(vscode.window, 'createTerminal').returns(terminal);
    });

    teardown(() => sandbox.restore());

    const cases: [NodeJS.Platform, boolean, string, string][] = [
        ['win32', false, 'winget', 'winget install --id Kitware.CMake --exact'],
        ['darwin', false, 'brew', 'brew install cmake'],
        ['linux', false, 'apt-get', 'sudo apt-get install cmake'],
        ['linux', true, 'apt-get', 'apt-get install cmake'],
        ['linux', false, 'dnf', 'sudo dnf install cmake']
    ];
    for (const [platform, isRoot, manager, command] of cases) {
        test(`uses ${manager} on ${platform}${isRoot ? ' as root' : ''}`, async () => {
            which.callsFake(async (name: string) => name === manager ? manager : null);
            expect(await getCMakeInstallCommand(platform, isRoot)).to.equal(command);
        });
    }

    test('prefers apt-get when multiple Linux package managers are available', async () => {
        which.resolves('/package-manager');
        expect(await getCMakeInstallCommand('linux', false)).to.equal('sudo apt-get install cmake');
        sinon.assert.calledOnceWithExactly(which, 'apt-get');
    });

    test('does not use a package manager from a different platform', async () => {
        which.callsFake(async (name: string) => name === 'brew' ? '/brew' : null);
        expect(await getCMakeInstallCommand('win32', false)).to.equal(undefined);
    });

    test('falls back when no supported package manager is available', async () => {
        expect(await getCMakeInstallCommand('linux', false)).to.equal(undefined);
        expect(await getCMakeInstallCommand('freebsd', false)).to.equal(undefined);
    });

    test('stages the installation command in the workspace terminal without executing it', async () => {
        which.resolves('/package-manager');
        showErrorMessage.resolves('Install CMake');

        await showCMakeInstallationMessage(folder);

        const command = process.platform === 'win32' ? 'winget install --id Kitware.CMake --exact'
            : process.platform === 'darwin' ? 'brew install cmake'
                : `${process.getuid?.() === 0 ? '' : 'sudo '}apt-get install cmake`;
        sinon.assert.calledOnceWithMatch(createTerminal, { cwd: folder.uri });
        sinon.assert.calledOnce(showTerminal);
        sinon.assert.calledOnceWithExactly(sendText, command, false);
        sinon.assert.notCalled(openExternal);
    });

    test('does nothing when the notification is dismissed', async () => {
        which.resolves('/package-manager');

        await showCMakeInstallationMessage(folder);

        sinon.assert.notCalled(createTerminal);
        sinon.assert.notCalled(openExternal);
    });

    test('opens the official download page when no supported package manager is found', async () => {
        showErrorMessage.resolves('Download CMake');

        await showCMakeInstallationMessage(folder);

        sinon.assert.calledOnceWithExactly(showErrorMessage,
            sinon.match.string, 'Download CMake');
        sinon.assert.calledOnceWithMatch(openExternal, sinon.match((uri: vscode.Uri) => uri.toString() === 'https://cmake.org/download/'));
        sinon.assert.notCalled(createTerminal);
    });

    test('reports a failure to open the download page', async () => {
        showErrorMessage.onFirstCall().resolves('Download CMake');
        openExternal.resolves(false);

        await showCMakeInstallationMessage(folder);

        sinon.assert.calledWithExactly(showErrorMessage, 'Unable to open the CMake download page: https://cmake.org/download/');
        sinon.assert.notCalled(createTerminal);
    });
});
