import { v4 as uuidv4 } from "uuid";

export interface DebuggerInformation {
    debuggerPipeName: string;
    debuggerIsReady?(): void;
}

export function getDebuggerPipeName(): string {
    if (process.platform === 'win32') {
        return `\\\\.\\\\pipe\\\\cmake-debugger-pipe\\\\${uuidv4()}`;
    } else {
        return `cmake_debugger_${uuidv4()}`;
    }
}
