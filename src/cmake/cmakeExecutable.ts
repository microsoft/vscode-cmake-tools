import * as proc from '../proc';
import * as util from '../util';
import {setContextAndStore} from '../extension';
import * as logging from '@cmt/logging';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('cmakeExecutable');

export interface CMakeExecutable {
    path: string;
    isPresent: boolean;
    isServerModeSupported?: boolean;
    isFileApiModeSupported?: boolean;
    isDebuggerSupported?: boolean;
    isDefaultGeneratorSupported?: boolean;
    version?: util.Version;
    minimalServerModeVersion: util.Version;
    minimalFileApiModeVersion: util.Version;
    minimalDefaultGeneratorVersion: util.Version;
}

const cmakeInfo = new Map<string, CMakeExecutable>();

export async function getCMakeExecutableInformation(path: string): Promise<CMakeExecutable> {
    const cmake: CMakeExecutable = {
        path,
        isPresent: false,
        minimalServerModeVersion: util.parseVersion('3.7.1'),
        minimalFileApiModeVersion: util.parseVersion('3.14.0'),
        minimalDefaultGeneratorVersion: util.parseVersion('3.15.0')
    };

    // The check for 'path' seems unnecessary, but crash logs tell us otherwise. It is not clear
    // what causes 'path' to be undefined here.
    if (path && path.length !== 0) {
        const normalizedPath = util.platformNormalizePath(path);
        if (cmakeInfo.has(normalizedPath)) {
            const cmakeExe: CMakeExecutable = cmakeInfo.get(normalizedPath)!;
            if (cmakeExe.isPresent) {
                await setCMakeDebuggerAvailableContext(
                    cmakeExe.isDebuggerSupported?.valueOf() ?? false
                );
                return cmakeExe;
            } else {
                log.error(localize('cmake.exe.not.found.in.cache', 'CMake executable not found in cache. Checking again.'));
            }
        }

        try {
            const execOpt: proc.ExecutionOptions = { showOutputOnError: true };
            const execVersion = await proc.execute(path, ['--version'], null, execOpt).result;
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

                // Support for CMake using an internal default generator when one isn't provided
                cmake.isDefaultGeneratorSupported = util.versionGreaterOrEquals(cmake.version, cmake.minimalDefaultGeneratorVersion);
            }
            const debuggerPresent = await proc.execute(path, ['-E', 'capabilities'], null, execOpt).result;
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
