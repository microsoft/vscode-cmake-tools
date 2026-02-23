import { v4 as uuidv4 } from "uuid";
import * as vscode from "vscode";

export interface DebuggerInformation {
    pipeName: string;
    dapLog?: string;
    debuggerIsReady(): void;
    debuggerStoppedDueToPreconditions(message: string): void;
}

/**
 * Generates a unique pipe name for the CMake debugger.
 *
 * On Windows, the pipe name is in the format:
 * `\\.\pipe\cmake-debugger-pipe\{UUID}`
 *
 * On other platforms, the pipe name is in the format:
 * `/tmp/cmake-debugger-pipe-{UUID}`
 *
 * @returns The unique pipe name for the CMake debugger.
 */
export function getDebuggerPipeName(): string {
    if (process.platform === 'win32') {
        return `\\\\.\\\\pipe\\\\cmake-debugger-pipe\\\\${uuidv4()}`;
    } else {
        return `/tmp/cmake-debugger-pipe-${uuidv4()}`;
    }
}

export class DebugTrackerFactory implements vscode.DebugAdapterTrackerFactory {
    public constructor(
        // eslint-disable-next-line arrow-body-style
        private onDisconnected: () => Promise<void> = async () => {
            return;
        }
    ) {
    }

    createDebugAdapterTracker(_session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterTracker> {
        const onDisconnected = this.onDisconnected;
        return {
            async onDidSendMessage(message: { event?: string; command?: string}) {
                if (message.command === "disconnect") {
                    await onDisconnected();
                }
            },
            onWillReceiveMessage(message: any) {
                // Fix for issue #4551: CMake's debugger sets evaluateName to the variable name,
                // which causes "Copy Value" to copy the name instead of the value.
                // We remove evaluateName from variables so VSCode falls back to copying the value.
                if (message.type === 'response' && message.command === 'variables' && message.body?.variables) {
                    for (const variable of message.body.variables) {
                        if (variable.evaluateName) {
                            delete variable.evaluateName;
                        }
                    }
                }
            }
        };
    }
}
