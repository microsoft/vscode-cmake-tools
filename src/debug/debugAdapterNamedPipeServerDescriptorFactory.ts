import { extensionManager } from "@cmt/extension";
import * as vscode from "vscode";
import { DebuggerInformation, getDebuggerPipeName } from "./debuggerConfigureDriver";
import { executeScriptWithDebugger } from "./debuggerScriptDriver";

import * as logging from '../logging';
import * as nls from "vscode-nls";
import { fs } from "../pr";
import { logCMakeDebuggerTelemetry, originatedFromLaunchConfiguration } from "./cmakeDebuggerTelemetry";

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const logger = logging.createLogger('debugger');

export class DebugAdapterNamedPipeServerDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    async createDebugAdapterDescriptor(session: vscode.DebugSession, _executable: vscode.DebugAdapterExecutable | undefined): Promise<vscode.ProviderResult<vscode.DebugAdapterDescriptor>> {
        const pipeName =
            session.configuration.pipeName ?? getDebuggerPipeName();

        const debuggerInformation: DebuggerInformation = {
            pipeName,
            dapLog: session.configuration.dapLog,
            debuggerIsReady: () => undefined
        };

        const cmakeDebugType: "configure" | "script" | "external" = session.configuration.cmakeDebugType;
        if (cmakeDebugType === "configure" || cmakeDebugType === "script") {
            const promise = new Promise<void>((resolve) => {
                debuggerInformation.debuggerIsReady = resolve;
            });

            if (cmakeDebugType === "script") {
                const script = session.configuration.scriptPath;
                if (!fs.existsSync(script)) {
                    throw new Error(localize("cmake.debug.scriptPath.does.not.exist", "The script path, \"{0}\", could not be found.", script));
                }
                const args: string[] = session.configuration.scriptArgs ?? [];
                const env = new Map<string, string>(session.configuration.scriptEnv?.map((e: {name: string; value: string}) => [e.name, e.value])) ?? new Map();
                logCMakeDebuggerTelemetry(originatedFromLaunchConfiguration, cmakeDebugType);
                void executeScriptWithDebugger(script, args, env, debuggerInformation);
            } else {
                logCMakeDebuggerTelemetry(originatedFromLaunchConfiguration, cmakeDebugType);

                // TODO: Check the session.configuration.trigger, assuming it's not undefined, against our known Trigger types/values, and if it's not valid, send undefined.

                if (session.configuration.clean) {
                    if (session.configuration.configureAll) {
                        void extensionManager?.cleanConfigureAllWithDebuggerInternal(
                            debuggerInformation,
                            session.configuration.trigger
                        );
                    } else {
                        void extensionManager?.cleanConfigureWithDebuggerInternal(
                            debuggerInformation,
                            session.configuration.folder
                        );
                    }
                } else {
                    if (session.configuration.configureAll) {
                        void extensionManager?.configureAllWithDebuggerInternal(
                            debuggerInformation,
                            session.configuration.trigger
                        );
                    } else {
                        void extensionManager?.configureWithDebuggerInternal(
                            debuggerInformation,
                            session.configuration.folder, session.configuration.sourceDir, session.configuration.trigger
                        );
                    }
                }
            }

            await promise;
        } else if (cmakeDebugType === "external") {
            logCMakeDebuggerTelemetry(originatedFromLaunchConfiguration, cmakeDebugType);
        }

        logger.info(localize('debugger.create.descriptor', 'Connecting debugger on named pipe: \"{0}\"', pipeName));
        return new vscode.DebugAdapterNamedPipeServer(pipeName);
    }
}
