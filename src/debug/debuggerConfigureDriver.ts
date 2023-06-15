import { CMakeOutputConsumer, StateMessage } from "@cmt/diagnostics/cmake";
import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";

export function getDebuggerPipeName(): string {
    if (process.platform === 'win32') {
        return `\\\\.\\\\pipe\\\\cmake-debugger-pipe\\\\${uuidv4()}`;
    } else {
        return `/cmake/debugger/${uuidv4()}`;
    }
}

export async function startConfigureDebugger(outputConsumer: CMakeOutputConsumer, debuggerPipeName: string): Promise<void> {
    while (!outputConsumer.stateMessages.includes(StateMessage.WaitingForDebuggerClient)) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    await vscode.debug.startDebugging(undefined, {
        name: "CMake Debugger",
        request: "launch",
        type: "cmake",
        debuggerPipeName
    });
}
