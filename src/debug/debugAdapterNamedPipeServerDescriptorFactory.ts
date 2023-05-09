import * as vscode from "vscode";
import { debuggerPipeName } from "./debuggerConfigureDriver";

export class DebugAdapterNamedPipeServerDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    createDebugAdapterDescriptor(_session: vscode.DebugSession, _executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        return new vscode.DebugAdapterNamedPipeServer(
            `${debuggerPipeName}`
        );
    }
}
