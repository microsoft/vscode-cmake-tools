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

        if (session.configuration.request !== "launch") {
            throw new Error("TODO: Only launch request is supported");
        }

        if (session.configuration.cmakeDebugType === undefined) {
            throw new Error("TODO: Must define the cmake debug type");
        }

        // undocumented configuration field that lets us know if the session is being invoked from a command
        // This should only be used from inside the extension from a command that invokes the debugger.
        if (!session.configuration.fromCommand) {

            // TODO: Check for conflicting types of requests from launch.json

            const cmakeDebugType: "configure" | "script" | "external" = session.configuration.cmakeDebugType;
            if (cmakeDebugType === "configure" || cmakeDebugType === "script") {
                const promise = new Promise<void>((resolve) => {
                    debuggerInformation.debuggerIsReady = resolve;
                });

                if (cmakeDebugType === "script") {
                    if (session.configuration.scriptPath === undefined) {
                        throw new Error("TODO: In cmake debug type script, script path must be defined");
                    }

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
            } else if (cmakeDebugType === "external") {
                if (session.configuration.pipeName === undefined) {
                    throw new Error("TODO: In CMake Debug type external, pipeName must be defined");
                }
            }
        }

        logger.info(localize('debugger.create.descriptor', 'Connecting debugger on named pipe: \"{0}\"', pipeName));
        return new vscode.DebugAdapterNamedPipeServer(pipeName);
    }
}
