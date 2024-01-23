import * as proc from '../proc';
import * as util from '../util';
import {setContextAndStore} from '../extension';

export interface CMakeExecutable {
    path: string;
    isPresent: boolean;
    isServerModeSupported?: boolean;
    isFileApiModeSupported?: boolean;
    isDebuggerSupported?: boolean;
    version?: util.Version;
    minimalServerModeVersion: util.Version;
    minimalFileApiModeVersion: util.Version;
}

const cmakeInfo = new Map<string, CMakeExecutable>();

export async function getCMakeExecutableInformation(path: string): Promise<CMakeExecutable> {
    const cmake: CMakeExecutable = {
        path,
        isPresent: false,
        minimalServerModeVersion: util.parseVersion('3.7.1'),
        minimalFileApiModeVersion: util.parseVersion('3.14.0')
    };

    // The check for 'path' seems unnecessary, but crash logs tell us otherwise. It is not clear
    // what causes 'path' to be undefined here.
    if (path && path.length !== 0) {
        const normalizedPath = util.platformNormalizePath(path);
        if (cmakeInfo.has(normalizedPath)) {
            const cmakeExe: CMakeExecutable = cmakeInfo.get(normalizedPath)!;
            await setCMakeDebuggerAvailableContext(
                cmakeExe.isDebuggerSupported?.valueOf() ?? false
            );
            return cmakeExe;
        }

        try {
            const execVersion = await proc.execute(path, ['--version']).result;
            if (execVersion.retc === 0 && execVersion.stdout) {
                console.assert(execVersion.stdout);
                const regexVersion = /cmake.* version (.*?)\r?\n/;
                cmake.version = util.parseVersion(regexVersion.exec(execVersion.stdout)![1]);

                // We purposefully exclude versions <3.7.1, which have some major CMake
                // server bugs
                cmake.isServerModeSupported = util.versionGreater(cmake.version, cmake.minimalServerModeVersion);

                // Support for new file based API, it replace the server mode
                cmake.isFileApiModeSupported = util.versionGreaterOrEquals(cmake.version, cmake.minimalFileApiModeVersion);
                cmake.isPresent = true;
            }
            const debuggerPresent = await proc.execute(path, ['-E', 'capabilities']).result;
            if (debuggerPresent.retc === 0 && debuggerPresent.stdout) {
                console.assert(debuggerPresent.stdout);
                const stdoutJson = JSON.parse(debuggerPresent.stdout);
                cmake.isDebuggerSupported = stdoutJson["debugger"];
                await setCMakeDebuggerAvailableContext(
                    cmake.isDebuggerSupported?.valueOf() ?? false
                );
            }
        } catch {
        }
        cmakeInfo.set(normalizedPath, cmake);
    }
    return cmake;
}

export async function setCMakeDebuggerAvailableContext(value: boolean): Promise<void> {
    await setContextAndStore("cmake:cmakeDebuggerAvailable", value);
}
