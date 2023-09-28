import { CMakeOutputConsumer, StateMessage } from '@cmt/diagnostics/cmake';
import * as proc from '@cmt/proc';
import { DebuggerInformation } from './debuggerConfigureDriver';
import { getCMakeExecutableInformation } from '@cmt/cmake/cmakeExecutable';
import { extensionManager } from '@cmt/extension';
import * as logging from '../logging';
import * as nls from "vscode-nls";
import { EnvironmentUtils } from '@cmt/environmentVariables';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const cmakeLogger = logging.createLogger('cmake');
const scriptLogger = logging.createLogger('cmake-script');

export async function executeScriptWithDebugger(scriptPath: string, scriptArgs: string[], scriptEnv: Map<string, string>, debuggerInformation: DebuggerInformation): Promise<void> {
    const outputConsumer: CMakeOutputConsumer = new CMakeOutputConsumer("", scriptLogger);

    // This is dependent on there being an active project. This feels reasonable since we're expecting them to be in a CMake project.
    // However, it could be safer to simply grab the cmake path directly from the settings.
    const cmakeProject = extensionManager?.getActiveProject();
    const cmakePath = await cmakeProject?.getCMakePathofProject();
    if (cmakeProject && cmakePath) {
        const cmakeExe = await getCMakeExecutableInformation(cmakePath);
        if (cmakeExe.isDebuggerSupported) {
            const concreteArgs = ["-P", scriptPath];
            concreteArgs.push(...scriptArgs);
            concreteArgs.push("--debugger");
            concreteArgs.push("--debugger-pipe");
            concreteArgs.push(`${debuggerInformation.pipeName}`);
            if (debuggerInformation.dapLog) {
                concreteArgs.push("--debugger-dap-log");
                concreteArgs.push(debuggerInformation.dapLog);
            }

            cmakeLogger.info(localize('run.script', "Executing CMake script: \"{0}\"", scriptPath));

            const env = EnvironmentUtils.merge([process.env, EnvironmentUtils.create(scriptEnv)]);
            const child = proc.execute(cmakeExe.path, concreteArgs, outputConsumer, { environment: env});

            while (
                !outputConsumer.stateMessages.includes(
                    StateMessage.WaitingForDebuggerClient
                )
            ) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }

            if (debuggerInformation.debuggerIsReady) {
                debuggerInformation.debuggerIsReady();
            }

            const result = await child.result;
            if (result.retc === 0) {
                cmakeLogger.info(localize('run.script.successful', "CMake script: \"{0}\" completed successfully.", scriptPath));
            } else {
                cmakeLogger.info(localize('run.script.failed', "CMake script: \"{0}\" completed unsuccessfully.", scriptPath));
                throw new Error("HEY");
            }
        } else {
            cmakeLogger.error(localize('run.script.cmakeDebugger.not.supported', "Cannot debug a script with this version of CMake, ensure you have CMake version 3.27 or later."));
        }
    }
}
