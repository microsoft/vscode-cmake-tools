import { CMakeOutputConsumer } from "@cmt/diagnostics/cmake";
import * as vscode from "vscode";

export const debuggerPipeName = "\\\\.\\\\pipe\\\\cmake-debugger-pipe";

export async function startConfigureDebugger(outputConsumer: CMakeOutputConsumer): Promise<void> {
    if (outputConsumer instanceof CMakeOutputConsumer) {
        await new Promise<void>(function (resolve) {
            (function waitForDebuggerClientMessage() {
                if (
                    outputConsumer.stateMessages.includes(
                        "Waiting for debugger client to connect..."
                    )
                ) {
                    return resolve();
                }
                setTimeout(waitForDebuggerClientMessage, 50);
            })();
        });
    }
    await vscode.debug.startDebugging(undefined, {
        name: "Test CMake Debugger",
        request: "launch",
        type: "cmake"
    });
}
