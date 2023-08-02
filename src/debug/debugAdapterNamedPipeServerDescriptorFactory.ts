import { extensionManager } from "@cmt/extension";
import * as vscode from "vscode";
import { DebuggerInformation, getDebuggerPipeName } from "./debuggerConfigureDriver";
import { executeScriptWithDebugger } from "./debuggerScriptDriver";

import * as logging from '../logging';
import * as nls from "vscode-nls";

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const logger = logging.createLogger('debugger');

export class DebugAdapterNamedPipeServerDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    async createDebugAdapterDescriptor(session: vscode.DebugSession, _executable: vscode.DebugAdapterExecutable | undefined): Promise<vscode.ProviderResult<vscode.DebugAdapterDescriptor>> {
        // first invoke cmake
        // invoke internal methods that call into and maybe have a handler once we've got the debugger is ready
        const pipeName = session.configuration.pipeName ?? getDebuggerPipeName();

        // we can only set up the dapLog from this end if it's not launched external
        const debuggerInformation: DebuggerInformation = {
            pipeName,
            dapLog: session.configuration.externalLaunch ? undefined : session.configuration.dapLog,
            debuggerIsReady: () => undefined
        };

        // undocumented configuration field that lets us know if the session is being invoked from a command
        // This should only be used from inside the extension from a command that invokes the debugger.
        if (!session.configuration.fromCommand) {
            if (session.configuration.request === "launch" && !session.configuration.externalLaunch) {
                const promise = new Promise<void>((resolve) => {
                    debuggerInformation.debuggerIsReady = resolve;
                });

                if (session.configuration.scriptPath) {
                    const script = session.configuration.scriptPath;
                    const args: string[] = session.configuration.scriptArgs ?? [];
                    const env = new Map<string, string>(session.configuration.scriptEnv.map((e: {name: string; value: string}) => [e.name, e.value])) ?? new Map();
                    void executeScriptWithDebugger(script, args, env, debuggerInformation);
                } else {
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
                }

                await promise;
            }
        }

        logger.info(localize('debugger.create.descriptor', 'Connecting debugger on named pipe: \"{0}\"', pipeName));
        return new vscode.DebugAdapterNamedPipeServer(pipeName);
    }
}
