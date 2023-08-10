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
            } else {
                throw new Error (localize("cmake.debugging.not.supported", "CMake does not support automatic debugging for this file"));
            }
        }

        if (debugConfiguration.request !== "launch") {
            throw new Error(
                localize(
                    "cmake.debug.only.launch.supported",
                    'The "cmake" debug type only supports the "launch" request.'
                )
            );
        }

        if (debugConfiguration.cmakeDebugType === undefined) {
            throw new Error(
                localize(
                    "cmake.debug.must.define.debugType",
                    'The "cmake" debug type requires you to define the "cmakeDebugType". Available options are "configure", "external", and "script".'
                )
            );
        } else {
            if (debugConfiguration.cmakeDebugType === "external" && debugConfiguration.pipeName === undefined) {
                throw new Error(
                    localize(
                        "cmake.debug.external.requires.pipeName",
                        'The "cmake" debug type with "cmakeDebugType" set to "external" requires you to define "pipeName".'
                    )
                );
            } else if (debugConfiguration.cmakeDebugType === "script" && debugConfiguration.scriptPath === undefined) {
                throw new Error(
                    localize(
                        "cmake.debug.script.requires.scriptPath",
                        'The "cmake" debug type with "cmakeDebugType" set to "script" requires you to define "scriptPath".'
                    )
                );
            }
        }

        return debugConfiguration;
    }
}
