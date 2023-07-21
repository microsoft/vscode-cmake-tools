import { extensionManager } from "@cmt/extension";
import * as vscode from "vscode";
import { DebuggerInformation, getDebuggerPipeName } from "./debuggerConfigureDriver";
export class DebugAdapterNamedPipeServerDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    async createDebugAdapterDescriptor(session: vscode.DebugSession, _executable: vscode.DebugAdapterExecutable | undefined): Promise<vscode.ProviderResult<vscode.DebugAdapterDescriptor>> {
        // first invoke cmake
        // invoke internal methods that call into and maybe have a handler once we've got the debugger is ready
        const pipeName = session.configuration.pipeName ?? getDebuggerPipeName();
        const debuggerInformation: DebuggerInformation = {
            pipeName,
            dapLog: session.configuration.dapLog,
            debuggerIsReady: () => undefined
        };

        // undocumented configuration field that lets us know if the session is being invoked from a command
        // This should only be used from inside the extension from a command that invokes the debugger.
        if (!session.configuration.fromCommand) {
            if (session.configuration.request === "launch") {
                const promise = new Promise<void>((resolve) => {
                    debuggerInformation.debuggerIsReady = resolve;
                });

                if (session.configuration.clean) {
                    if (session.configuration.configureAll) {
                        void extensionManager?.cleanConfigureAllWithDebuggerInternal(
                            debuggerInformation
                        );
                    } else {
                        void extensionManager?.cleanConfigureWithDebuggerInternal(
                            debuggerInformation
                        );
                    }
                } else {
                    if (session.configuration.configureAll) {
                        void extensionManager?.configureAllWithDebuggerInternal(
                            debuggerInformation
                        );
                    } else {
                        void extensionManager?.configureWithDebuggerInternal(
                            debuggerInformation
                        );
                    }
                }
                await promise;
            }
        }

        return new vscode.DebugAdapterNamedPipeServer(pipeName);
    }
}
