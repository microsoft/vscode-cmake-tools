import { CMakeOutputConsumer, StateMessage } from '@cmt/diagnostics/cmake';
import * as proc from '@cmt/proc';
import { DebuggerInformation } from './debuggerConfigureDriver';
import { getCMakeExecutableInformation } from '@cmt/cmake/cmakeExecutable';
import { extensionManager } from '@cmt/extension';

export async function executeScriptWithDebugger(scriptPath: string, scriptArgs: string[], _scriptEnv: string[], debuggerInformation: DebuggerInformation): Promise<void> {
    const outputConsumer: CMakeOutputConsumer = new CMakeOutputConsumer("");

    // TODO: Currently this is dependent on there being an active project.
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
        // do some .then stuff to be able to show results?
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
        // TODO: some handling of the result. Maybe output the result?
    }
}
