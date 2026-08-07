import * as proc from '@cmt/proc';
import * as util from '@cmt/util';
import { setContextAndStore } from '@cmt/extension';
import * as logging from '@cmt/logging';
import * as nls from 'vscode-nls';
import { ConfigurationReader } from './config';

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

/**
 * Query a cmake binary for its version and capabilities.
 *
 * @param path Path to the cmake executable.
 * @param config Optional configuration used to provide the child process environment.
 * @param cwd Optional working directory to run the probe in. This matters for users
 * whose `cmake` is provided by a directory-based version manager (mise, asdf, vfox, ...):
 * their shims resolve the tool version by walking up from the current working directory,
 * so the probe must run inside the project. When omitted, the child process inherits the
 * extension host's `process.cwd()`, which is not guaranteed to be the workspace folder.
 */
export async function getCMakeExecutableInformation(path: string, config?: ConfigurationReader, cwd?: string): Promise<CMakeExecutable> {
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
            const execOpt: proc.ExecutionOptions = { showOutputOnError: true, environment: config?.environment, cwd: cwd || undefined };
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
            const capabilities = await proc.execute(path, ['-E', 'capabilities'], null, execOpt).result;
            if (capabilities.retc === 0 && capabilities.stdout) {
                console.assert(capabilities.stdout);
                const stdoutJson = JSON.parse(capabilities.stdout);
                if (cmake.isServerModeSupported && !stdoutJson["serverMode"]) {
                    cmake.isServerModeSupported = false;
                }
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
