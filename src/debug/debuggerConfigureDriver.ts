import { v4 as uuidv4 } from "uuid";
import * as vscode from "vscode";

export interface DebuggerInformation {
    debuggerPipeName: string;
    debuggerDapLog?: string;
    debuggerIsReady?(): void;
}

export function getDebuggerPipeName(): string {
    if (process.platform === 'win32') {
        return `\\\\.\\\\pipe\\\\cmake-debugger-pipe\\\\${uuidv4()}`;
    } else {
        return `/tmp/cmake-debugger-pipe-${uuidv4()}`;
    }
}

export class DebugTrackerFactor implements vscode.DebugAdapterTrackerFactory {
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
                // Despite receiving a message from the debug session, it's not
                // guaranteed that vscode.debug.activeDebugSession is actually set yet.
                // Check once per second for up to 10 seconds to see if it shows up.
                // https://github.com/microsoft/vscode/issues/70125
                let tries = 0;
                while (
                    vscode.debug.activeDebugSession === undefined &&
                    tries < 10
                ) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    tries++;
                }

                if (message.command === "disconnect") {
                    await onDisconnected();
                }
            }
        };
    }
}
