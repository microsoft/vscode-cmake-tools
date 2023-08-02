import { CMakeOutputConsumer, StateMessage } from '@cmt/diagnostics/cmake';
import * as proc from '@cmt/proc';
import { DebuggerInformation } from './debuggerConfigureDriver';
import { getCMakeExecutableInformation } from '@cmt/cmake/cmakeExecutable';
import { extensionManager } from '@cmt/extension';
import * as logging from '../logging';
import * as nls from "vscode-nls";

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const cmakeLogger = logging.createLogger('cmake');
const scriptLogger = logging.createLogger('cmake-script');

export async function executeScriptWithDebugger(scriptPath: string, scriptArgs: string[], _scriptEnv: string[], debuggerInformation: DebuggerInformation): Promise<void> {
    const outputConsumer: CMakeOutputConsumer = new CMakeOutputConsumer("", scriptLogger);

    // TODO: Currently this is dependent on there being an active project. We might need to grab directly from settings, but it might be fine.
    const cmakePath = await extensionManager?.getActiveProject()?.getCMakePathofProject();
    if (cmakePath) {
        const cmakeExe = await getCMakeExecutableInformation(cmakePath);
        const concreteArgs = ["-P", scriptPath];
        concreteArgs.push("--debugger");
        concreteArgs.push("--debugger-pipe");
        concreteArgs.push(`${debuggerInformation.pipeName}`);
        if (debuggerInformation.dapLog) {
            concreteArgs.push("--debugger-dap-log");
            concreteArgs.push(debuggerInformation.dapLog);
        }

        cmakeLogger.info(localize('run.script', "Executing CMake script: \"{0}\"", scriptPath));

        // TODO: Make sure args and environment are handled correctly.
        // TODO: Possibly concatenate env with process.env, similar to how the CMake driver does it.
        const child = proc.execute(cmakeExe.path, concreteArgs.concat(scriptArgs), outputConsumer);

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
        }
    }
}
