import paths from '@cmt/paths';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const installCommands: Partial<Record<NodeJS.Platform, [string, string][]>> = {
    win32: [['winget', 'winget install --id Kitware.CMake --exact']],
    darwin: [['brew', 'brew install cmake']],
    linux: [['apt-get', 'apt-get install cmake'], ['dnf', 'dnf install cmake']]
};

export async function getCMakeInstallCommand(platform: NodeJS.Platform, isRoot: boolean): Promise<string | undefined> {
    for (const [manager, command] of installCommands[platform] ?? []) {
        if (await paths.which(manager)) {
            return platform === 'linux' && !isRoot ? `sudo ${command}` : command;
        }
    }
}

export async function showCMakeInstallationMessage(folder: vscode.WorkspaceFolder): Promise<void> {
    const command = await getCMakeInstallCommand(process.platform, process.getuid?.() === 0);
    const action = command ? localize('install.cmake', 'Install CMake') : localize('download.cmake', 'Download CMake');
    const selection = await vscode.window.showErrorMessage(
        localize('cmake.not.found', 'CMake was not found in this environment. Install it or set {0} to the CMake executable.', '"cmake.cmakePath"'),
        action
    );
    if (selection !== action) {
        return;
    }

    if (command) {
        const terminal = vscode.window.createTerminal({
            name: localize('install.cmake', 'Install CMake'),
            cwd: folder.uri,
            message: localize('review.install.command', 'Review the command below and press Enter to install CMake.') + '\r\n'
        });
        terminal.show();
        terminal.sendText(command, false);
    } else {
        const downloadUrl = 'https://cmake.org/download/';
        if (!await vscode.env.openExternal(vscode.Uri.parse(downloadUrl))) {
            await vscode.window.showErrorMessage(localize('cmake.download.failed', 'Unable to open the CMake download page: {0}', downloadUrl));
        }
    }
}
