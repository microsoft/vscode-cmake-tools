import * as vscode from "vscode";
import * as nls from "vscode-nls";

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export class DebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    resolveDebugConfiguration(_folder: vscode.WorkspaceFolder | undefined, debugConfiguration: vscode.DebugConfiguration, _token?: vscode.CancellationToken | undefined): vscode.ProviderResult<vscode.DebugConfiguration> {
        if (!debugConfiguration.type && !debugConfiguration.request && !debugConfiguration.name) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.fileName.endsWith(".cmake")) {
                debugConfiguration.type = "cmake";
                debugConfiguration.name = localize("cmake.debug.without.launch", "Debugging cmake script with default launch");
                debugConfiguration.request = "launch";
                debugConfiguration.cmakeDebugType = "script";
                debugConfiguration.scriptPath = editor.document.fileName;
            }
        }

        return debugConfiguration;
    }
}
