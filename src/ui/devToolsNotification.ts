import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as path from 'path';
import * as logging from '@cmt/logging';
import rollbar from '@cmt/rollbar';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
const log = logging.createLogger('devtools');
const devToolsExtensionId = 'ms-vscode.cpp-devtools';
const doNotShowAgainKey = 'ms-vscode.cmake-tools.cpp-devtools.doNotShowAgain';

export class DevToolsNotification {
    private shownThisSession = false;

    public start(hasCMakeProject: () => boolean, globalState: vscode.Memento): vscode.Disposable {
        const checkEligibility = () => rollbar.invokeAsync('Suggest C++ DevTools', () => this.showIfNeeded(hasCMakeProject(), globalState));
        const subscription = vscode.extensions.onDidChange(checkEligibility);
        checkEligibility();
        return subscription;
    }

    public async showIfNeeded(hasCMakeProject: boolean, globalState: vscode.Memento): Promise<void> {
        if (this.shownThisSession || globalState.get(doNotShowAgainKey, false) || !hasCMakeProject || vscode.extensions.getExtension(devToolsExtensionId)) {
            return;
        }

        const copilotInstalled = await this.isCopilotInstalled();
        log.debug(localize('devtools.copilot.installed', 'C++ DevTools suggestion eligibility: Copilot installed: {0}', copilotInstalled));
        if (this.shownThisSession || globalState.get(doNotShowAgainKey, false) || !copilotInstalled || vscode.extensions.getExtension(devToolsExtensionId)) {
            return;
        }

        this.shownThisSession = true;
        const install = localize('devtools.install', 'Install');
        const doNotShowAgain = localize('devtools.dont.show.again', "Don't Show Again");
        const selection = await vscode.window.showInformationMessage(
            localize('devtools.suggestion', 'Install C++ DevTools extension to give Copilot more accurate code understanding and build workflows'),
            install,
            doNotShowAgain
        );
        if (selection === install) {
            await vscode.commands.executeCommand('workbench.extensions.installExtension', devToolsExtensionId);
        } else if (selection === doNotShowAgain) {
            await globalState.update(doNotShowAgainKey, true);
        }
    }

    private async isCopilotInstalled(): Promise<boolean> {
        if (vscode.extensions.getExtension('GitHub.copilot') || vscode.extensions.getExtension('GitHub.copilot-chat')) {
            return true;
        }
        if (!vscode.env.appRoot) {
            return false;
        }

        // Newer VS Code builds bundle Copilot without exposing a separate enabled extension.
        const manifestUri = vscode.Uri.file(path.join(vscode.env.appRoot, 'extensions', 'copilot', 'package.json'));
        let contents: Uint8Array;
        try {
            contents = await vscode.workspace.fs.readFile(manifestUri);
        } catch (error) {
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                return false;
            }
            throw error;
        }

        const manifest: { publisher?: unknown; name?: unknown } | null = JSON.parse(Buffer.from(contents).toString('utf8'));
        return typeof manifest?.publisher === 'string'
            && manifest.publisher.toLowerCase() === 'github'
            && (manifest.name === 'copilot' || manifest.name === 'copilot-chat');
    }
}
