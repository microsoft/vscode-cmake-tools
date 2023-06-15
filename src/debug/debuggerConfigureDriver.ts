import { CMakeOutputConsumer, StateMessage } from "@cmt/diagnostics/cmake";
import * as vscode from "vscode";
import { localize } from "vscode-nls";

export const debuggerPipeName = "\\\\.\\\\pipe\\\\cmake-debugger-pipe";

export async function startConfigureDebugger(outputConsumer: CMakeOutputConsumer): Promise<void> {
    while (!outputConsumer.stateMessages.includes(StateMessage.WaitingForDebuggerClient)) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    await vscode.debug.startDebugging(undefined, {
        name: "CMake Debugger",
        request: "launch",
        type: "cmake"
    });
}
