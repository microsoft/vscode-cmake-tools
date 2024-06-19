/**
 * Module for querying MS Visual Studio
 */ /** */

import * as util from '@cmt/util';
import * as path from 'path';
import { fs } from '@cmt/pr';
import paths from '@cmt/paths';
import { Environment, EnvironmentUtils } from '@cmt/environmentVariables';
import * as iconv from 'iconv-lite';
import * as codepages from '@cmt/codePageTable';

import * as logging from '../logging';
import * as proc from '../proc';
import { thisExtensionPath } from '../util';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('visual-studio');

export interface VSCatalog {
    productDisplayVersion: string;
}

/**
* Description of a Visual Studio installation returned by vswhere.exe
*
* This isn't _all_ the properties, just the ones we need so far.
*/
export interface VSInstallation {
    catalog?: VSCatalog;
    channelId?: string;
    instanceId: string;
    displayName?: string;
    installationPath: string;
    installationVersion: string;
    description: string;
    isPrerelease: boolean;
}

/**
 * Cache the results of invoking 'vswhere'
 */
interface VSInstallationCache {
    installations: VSInstallation[];
    queryTime: number;
}

let cachedVSInstallations: VSInstallationCache | null = null;

/**
 * Get a list of all Visual Studio installations available from vswhere.exe.
 * Results are cached for 15 minutes.
 * Will not include older versions. vswhere doesn't seem to list them?
 */
export async function vsInstallations(): Promise<VSInstallation[]> {
    const now = Date.now();
    if (cachedVSInstallations && cachedVSInstallations.queryTime && (now - cachedVSInstallations.queryTime) < 900000) {
        // If less than 15 minutes old, cache is considered ok.
        return cachedVSInstallations.installations;
    }

    const installs = [] as VSInstallation[];
    const instanceIds = [] as string[];
    const vswhereExe = path.join(thisExtensionPath(), 'res', 'vswhere.exe');
    const sys32Path = path.join(process.env.WINDIR as string, 'System32');

    const vswhereArgs = ['/c', `${sys32Path}\\chcp 65001>nul && "${vswhereExe}" -all -format json -utf8 -products * -legacy -prerelease`];
    const vswhereResult = await proc.execute(`${sys32Path}\\cmd.exe`, vswhereArgs, null, { silent: true, encoding: 'utf8', shell: true }).result;

    if (vswhereResult.retc !== 0) {
        log.error(localize('failed.to.execute', 'Failed to execute {0}: {1}', "vswhere.exe", vswhereResult.stderr));
        return [];
    }

    const vsInstalls = JSON.parse(vswhereResult.stdout) as VSInstallation[];
    for (const inst of vsInstalls) {
        if (instanceIds.indexOf(inst.instanceId) < 0) {
            installs.push(inst);
            instanceIds.push(inst.instanceId);
        }
    }
    cachedVSInstallations = {
        installations: installs,
        queryTime: now
    };
    return installs;
}

export function compareVersions(lhs: string, rhs: string): number {
    const lhsParts = lhs.split('.');
    const rhsParts = rhs.split('.');

    let index = 0;
    for (; ; index++) {
        const lhsp = lhsParts[index];
        const rhsp = rhsParts[index];

        if (lhsp && rhsp) {
            if (lhsp === rhsp) {
                continue;
            } else {
                return parseInt(lhsp) - parseInt(rhsp);
            }
        } else if (lhsp) {
            return 1; // lhsp > rhsp
        } else if (rhsp) {
            return -1; // lhsp < rhsp
        } else {
            return 0; // lhsp === rhsp
        }
    }
}

/**
 * Platform arguments for VS Generators
 * Currently, there is a mismatch only between x86 and win32.
 * For example, VS kits x86 and amd64_x86 will generate -A win32
 */
export const generatorPlatformFromVSArch: { [key: string]: string } = {
    x86: 'win32'
};

// The reverse of generatorPlatformFromVSArch
export const vsArchFromGeneratorPlatform: { [key: string]: string } = {
    win32: 'x86'
};

/**
 * Turns 'win32' into 'x86' for target architecture.
 */
export function targetArchFromGeneratorPlatform(generatorPlatform?: string) {
    if (!generatorPlatform) {
        return undefined;
    }
    return vsArchFromGeneratorPlatform[generatorPlatform] || generatorPlatform;
}

/**
 * Create the host-target arch specification of a VS install,
 * from the VS kit architecture (host) and generator platform (target).
 * @param hostArch The architecture of the host toolset
 * @param targetArch The architecture of the target
 * @param amd64Alias Whether amd64 is preferred over x64.
 * @param includeVersion Whether to include the version. Since we use this method to get the name of the vcvars script in certain
 *                     cases, we can't include the version in the name, only in the execution of the script when we're getting arguments.
 */
export function getHostTargetArchString(hostArch: string, targetArch?: string, amd64Alias: boolean = false, includeVersion: boolean = false): string {
    // There are cases when we don't want to use the 'x64' alias of the 'amd64' architecture,
    // like for older VS installs, for the VS kit names (for compatibility reasons)
    // or for arm/arm64 specific vcvars scripts.
    if (amd64Alias) {
        if (hostArch === "x64") {
            hostArch = "amd64";
        }

        if (targetArch === "x64") {
            targetArch = "amd64";
        }
    }

    // For arm64, cmake expects 'ARM64' for host toolset parameter, but
    // then we fail the hostArch === targetArch below. This enables us to find
    // all the Host ARM64 toolsets as well as still meet the `host=ARM64` requirement for cmake
    if (hostArch === 'ARM64') {
        hostArch = 'arm64';
    }

    if (!targetArch) {
        targetArch = hostArch;
    }

    const parsedTargetArch = targetArch.split(",");
    const version = parsedTargetArch.filter(a => a.includes("version=")).map(a => a.split("=")[1]).join(" ").trimEnd();
    // The platform can only be first in the list: https://cmake.org/cmake/help/latest/variable/CMAKE_GENERATOR_PLATFORM.html#variable:CMAKE_GENERATOR_PLATFORM
    // If the first entry in the list includes an "=", it is the version, so we need to use the host arch.
    targetArch = parsedTargetArch[0].includes("=") ? hostArch : parsedTargetArch[0];

    // CMake preferred generator platform requires 'win32', while vcvars are still using 'x86'.
    // This function is called only for VS generators, so it is safe to overwrite
    // targetArch with the vcvars naming.
    // In case of any future new mismatches, use the vsArchFromGeneratorPlatform table
    // instead of hard coding for win32 and x86.
    // Currently, there is no need of a similar overwrite operation on hostArch,
    // because CMake host target does not have the same name mismatch with VS.
    targetArch = targetArchFromGeneratorPlatform(targetArch);

    const archValue = (hostArch === targetArch) ? hostArch : `${hostArch}_${targetArch}`;
    return  includeVersion ? `${archValue} ${version}` : archValue;
}

// Gets the MSVC toolsets installed for a given VS install.
export async function enumerateMsvcToolsets(vsInstallRoot: string, vsVersion: string): Promise<string[] | undefined> {
    const version = parseInt(vsVersion);
    if (version < 15) {
        return [`${version}.0`];
    } else {
        const toolsetDir = path.join(vsInstallRoot, 'VC\\Tools\\MSVC');
        if (await fs.exists(toolsetDir)) {
            const dirContents = await fs.readdir(toolsetDir, { 'withFileTypes': true });
            // Only the toolsets should be this directory (each in their own directories), but filter out anything else just in case.
            // Sort in descending order, so if searching with a 1- or 2-component version (e.g. 14.27) we'll choose the latest version first
            return dirContents.filter(item => item.isDirectory()).map(dir => dir.name)
                .sort((a, b) => util.compareVersions(a, b)).reverse();
        }
    }

    return undefined;
}

// Filters the given vsInstalls to those which have the given toolset.
export function filterVSInstallationsByMsvcToolset(vsInstalls: VSInstallation[], toolsetVersion: string): VSInstallation[] {
    return vsInstalls.filter(async vs => {
        const availableToolsets = await enumerateMsvcToolsets(vs.installationPath, vs.installationVersion);
        return availableToolsets?.find(t => t.startsWith(toolsetVersion));
    });
}

/*
 * List of environment variables required for Visual C++ to run as expected for
 * a VS installation.
 * The diff of vcvarsall.bat output env and system env:
    DevEnvDir=C:\Program Files (x86)\Microsoft Visual Studio 14.0\Common7\IDE\
    Framework40Version=v4.0
    FrameworkDir=C:\Windows\Microsoft.NET\Framework\
    FrameworkDIR32=C:\Windows\Microsoft.NET\Framework\
    FrameworkVersion=v4.0.30319
    FrameworkVersion32=v4.0.30319
    INCLUDE=C:\Program Files (x86)\Microsoft Visual Studio 14.0\VC\INCLUDE;C:\Program Files (x86)\Microsoft Visual Studio 14.0\VC\ATLMFC\INCLUDE;C:\Program Files (x86)\Windows Kits\10\include\10.0.14393.0\ucrt;C:\Program Files (x86)\Windows Kits\NETFXSDK\4.6.1\include\um;C:\Program Files (x86)\Windows Kits\10\include\10.0.14393.0\shared;C:\Program Files (x86)\Windows Kits\10\include\10.0.14393.0\um;C:\Program Files (x86)\Windows Kits\10\include\10.0.14393.0\winrt;
    LIB=C:\Program Files (x86)\Microsoft Visual Studio 14.0\VC\LIB\ARM;C:\Program Files (x86)\Microsoft Visual Studio 14.0\VC\ATLMFC\LIB\ARM;C:\Program Files (x86)\Windows Kits\10\lib\10.0.14393.0\ucrt\ARM;C:\Program Files (x86)\Windows Kits\NETFXSDK\4.6.1\lib\um\ARM;C:\Program Files (x86)\Windows Kits\10\lib\10.0.14393.0\um\ARM;
    LIBPATH=C:\Windows\Microsoft.NET\Framework\v4.0.30319;C:\Program Files (x86)\Microsoft Visual Studio 14.0\VC\LIB\ARM;C:\Program Files (x86)\Microsoft Visual Studio 14.0\VC\ATLMFC\LIB\ARM;C:\Program Files (x86)\Windows Kits\10\UnionMetadata;C:\Program Files (x86)\Windows Kits\10\References;\Microsoft.VCLibs\14.0\References\CommonConfiguration\neutral;
    NETFXSDKDir=C:\Program Files (x86)\Windows Kits\NETFXSDK\4.6.1\
    Path=C:\Program Files (x86)\Microsoft Visual Studio 14.0\Common7\IDE\CommonExtensions\Microsoft\TestWindow;C:\Program Files (x86)\MSBuild\14.0\bin;C:\Program Files (x86)\Microsoft Visual Studio 14.0\Common7\IDE\;C:\Program Files (x86)\Microsoft Visual Studio 14.0\VC\BIN\x86_ARM;C:\Program Files (x86)\Microsoft Visual Studio 14.0\VC\BIN;C:\Program Files (x86)\Microsoft Visual Studio 14.0\Common7\Tools;C:\Windows\Microsoft.NET\Framework\v4.0.30319;C:\Program Files (x86)\Microsoft Visual Studio 14.0\VC\VCPackages;C:\Program Files (x86)\HTML Help Workshop;C:\Program Files (x86)\Microsoft Visual Studio 14.0\Team Tools\Performance Tools;C:\Program Files (x86)\Windows Kits\10\bin\x86;C:\Program Files (x86)\Microsoft SDKs\Windows\v10.0A\bin\NETFX 4.6.1 Tools\;C:\Windows\system32;C:\Windows;C:\Windows\System32\Wbem;C:\Windows\System32\WindowsPowerShell\v1.0\;C:\Program Files\Microsoft SQL Server\120\Tools\Binn\;C:\Program Files\Microsoft VS Code\bin;C:\Program Files\CMake\bin;C:\Program Files\Git\cmd;C:\Program Files\TortoiseGit\bin;C:\Program Files (x86)\Windows Kits\10\Windows Performance Toolkit\
    Platform=ARM
    UCRTVersion=10.0.14393.0
    UniversalCRTSdkDir=C:\Program Files (x86)\Windows Kits\10\
    user_inputversion=10.0.14393.0
    VCINSTALLDIR=C:\Program Files (x86)\Microsoft Visual Studio 14.0\VC\
    VisualStudioVersion=14.0
    VSINSTALLDIR=C:\Program Files (x86)\Microsoft Visual Studio 14.0\
    WindowsLibPath=C:\Program Files (x86)\Windows Kits\10\UnionMetadata;C:\Program Files (x86)\Windows Kits\10\References
    WindowsSdkDir=C:\Program Files (x86)\Windows Kits\10\
    WindowsSDKLibVersion=10.0.14393.0\
    WindowsSDKVersion=10.0.14393.0\
    WindowsSDK_ExecutablePath_x64=C:\Program Files (x86)\Microsoft SDKs\Windows\v10.0A\bin\NETFX 4.6.1 Tools\x64\
    WindowsSDK_ExecutablePath_x86=C:\Program Files (x86)\Microsoft SDKs\Windows\v10.0A\bin\NETFX 4.6.1 Tools\
 *
 */
const msvcEnvVars = [
    /* These is the diff of vcvarsall.bat generated env and original system env */
    'DevEnvDir',
    'Framework40Version',
    'FrameworkDir',
    'FrameworkDIR32',
    'FrameworkDIR64',
    'FrameworkVersion',
    'FrameworkVersion32',
    'FrameworkVersion64',
    'INCLUDE',
    'LIB',
    'LIBPATH',
    'NETFXSDKDir',
    'Path',
    //'Platform', - disabled as it's currently unnecessary and causes some projects to fail to build
    'UCRTVersion',
    'UniversalCRTSdkDir',
    'user_inputversion',
    'VCIDEInstallDir',
    'VCINSTALLDIR',
    //'VCToolsInstallDir', - disabled temporarily as it breaks downlevel toolset selection
    'VCToolsRedistDir',
    //'VCToolsVersion', - disabled temporarily as it breaks downlevel toolset selection
    'VisualStudioVersion',
    'VSINSTALLDIR',
    'WindowsLibPath',
    'WindowsSdkBinPath',
    'WindowsSdkDir',
    'WindowsSDKLibVersion',
    'WindowsSDKVersion',
    'WindowsSDK_ExecutablePath_x64',
    'WindowsSDK_ExecutablePath_x86',

    /* These are special also need to be cached */
    'CL',
    '_CL_',
    'LINK',
    '_LINK_',
    'TMP',
    'UCRTCONTEXTROOT',
    'VCTARGETSPATH'
];

/**
 * Get the environment variables corresponding to a VS dev batch file.
 * For reference this is vcvarsall.bat -? (from 16.11.8)
 * Syntax:
 *     vcvarsall.bat [arch] [platform_type] [winsdk_version] [-vcvars_ver=vc_version] [-vcvars_spectre_libs=spectre_mode]
 * where :
 *     [arch]: x86 | amd64 | x86_amd64 | x86_arm | x86_arm64 | amd64_x86 | amd64_arm | amd64_arm64
 *     [platform_type]: {empty} | store | uwp
 *     [winsdk_version] : full Windows 10 SDK number (e.g. 10.0.10240.0) or "8.1" to use the Windows 8.1 SDK.
 *     [vc_version] : {none} for latest installed VC++ compiler toolset |
 *                    "14.0" for VC++ 2015 Compiler Toolset |
 *                    "14.xx" for the latest 14.xx.yyyyy toolset installed (e.g. "14.11") |
 *                    "14.xx.yyyyy" for a specific full version number (e.g. "14.11.25503")
 *     [spectre_mode] : {none} for libraries without spectre mitigations |
 *                      "spectre" for libraries with spectre mitigations
 * @param hostArch Host arch used to find the proper Windows SDK path
 * @param devBat Path to a VS environment batch file
 * @param args List of arguments to pass to the batch file
 */
async function collectDevBatVars(hostArch: string, devBat: string, args: string[], majorVersion: number, commonDir: string): Promise<Environment | undefined> {
    const fname = Math.random().toString() + '.bat';
    const batFileName = `vs-cmt-${fname}`;
    const envFileName = batFileName + '.env';
    const bat = [
        `@echo off`,
        `cd /d "%~dp0"`,
        `set "VS${majorVersion}0COMNTOOLS=${commonDir}"`,
        `set "INCLUDE="`,
        `call "${devBat}" ${args.join(' ')}`,
        `setlocal enableextensions enabledelayedexpansion`,
        `cd /d "%~dp0"` /* Switch back to original drive */
    ];
    for (const envVar of msvcEnvVars) {
        bat.push(`if DEFINED ${envVar} echo ${envVar} := %${envVar}% >> ${envFileName}`);
    }

    // writeFile and unlink don't need quotes (they work just fine with an unquoted path with space)
    // but they might fail sometimes if quotes are present, so remove for now any surrounding quotes
    // that may have been defined by the user (the command prompt experience makes it very likely
    // for the user to use quotes when defining an environment variable with a space containing path).
    let tmpDir: string = paths.tmpDir;
    if (!tmpDir) {
        console.log(`TEMP dir is not set. ${devBat} will not run.`);
        return;
    }

    tmpDir = tmpDir.trim();
    if (tmpDir.startsWith('"') && tmpDir.endsWith('"')) {
        tmpDir = tmpDir.substring(1, tmpDir.length - 1);
    }

    const batPath = path.join(tmpDir, batFileName);
    const envPath = path.join(tmpDir, envFileName);

    try {
        await fs.unlink(envPath);
    } catch (error) {}

    const batContent = bat.join('\r\n');
    await fs.writeFile(batPath, batContent);

    const outputEncoding = await codepages.getWindowsCodepage();
    const execOption: proc.ExecutionOptions = {
        shell: false,
        silent: true,
        overrideLocale: false,
        outputEncoding: outputEncoding
    };
    // Script file path will be quoted when passed as args
    const result = await proc.execute('cmd.exe', ['/c', batPath], null, execOption).result;
    await fs.unlink(batPath);
    const output = (result.stdout) ? result.stdout + (result.stderr || '') : result.stderr;

    let env = '';
    try {
        /* When the bat running failed, envPath would not exist */
        const binEnv = await fs.readFile(envPath);
        env = iconv.decode(binEnv, outputEncoding);
        await fs.unlink(envPath);
    } catch (error) {
        log.error(error as Error);
    }

    if (!env) {
        env = '';
    }

    const vars = env.split('\n').map(l => l.trim()).filter(l => l.length !== 0).reduce<Environment>((acc, line) => {
        const mat = /(\w+) := ?(.*)/.exec(line);
        if (mat) {
            acc[mat[1]] = mat[2];
        } else {
            log.error(localize('error.parsing.environment', 'Error parsing environment variable: {0}', line));
        }
        return acc;
    }, EnvironmentUtils.create());
    const includeEnv = vars['INCLUDE'] ?? '';
    if (includeEnv === '') {
        log.error(localize('script.run.error.check',
            'Error running:{0} with args:{1}\nCannot find INCLUDE within:\n{2}\nBat content are:\n{3}\nExecute output are:\n{4}\n',
            devBat, args.join(' '), env, batContent, output));
        return;
    }

    let WindowsSDKVersionParsed: util.Version = {
        major: 0,
        minor: 0,
        patch: 0
    };
    const WindowsSDKVersion = vars['WindowsSDKVersion'] ?? '0.0.0';
    try {
        WindowsSDKVersionParsed = util.parseVersion(WindowsSDKVersion);
    } catch (err) {
        log.error(`Parse '${WindowsSDKVersion}' failed`);
    }
    if (majorVersion === 14 && util.compareVersion(WindowsSDKVersionParsed, { major: 10, minor: 0, patch: 14393 }) >= 0) {
        const WindowsSdkDir = vars['WindowsSdkDir'] ?? '';
        const existPath = vars['PATH'] ?? '';
        const oldWinSdkBinPath = path.join(WindowsSdkDir, 'bin', hostArch);
        const newWinSdkBinPath = path.join(WindowsSdkDir, 'bin', WindowsSDKVersion, hostArch);
        const newWinSdkBinPathExist = await fs.exists(newWinSdkBinPath);
        if (newWinSdkBinPathExist &&
            existPath !== '' &&
            existPath.toLowerCase().indexOf(newWinSdkBinPath.toLowerCase()) < 0) {
            log.info(localize('windows.sdk.path.patch', 'Patch Windows SDK path from {0} to {1} for {2}',
                oldWinSdkBinPath, newWinSdkBinPath, devBat));
            vars['PATH'] = `${newWinSdkBinPath};${existPath}`;
        }
    }
    log.debug(localize('ok.running', 'OK running {0} {1}, env vars: {2}', devBat, args.join(' '), JSON.stringify(vars)));
    return vars;
}

/**
 * Gets the full path to the vcvars*.bat script for the given VS installation and host/target architecture.
 * If not found it means the toolset architecture is not supported for this installation.
 * @param vsInstall The VS installation.
 * @param hostArch The desired toolset host architecture.
 * @param targetArch The desired toolset target architecture.
 * @returns Path to vcvars*.bat script or null if not found.
 */
export async function getVcVarsBatScript(vsInstall: VSInstallation, hostArch: string, targetArch?: string): Promise<string | null> {
    const majorVersion = parseInt(vsInstall.installationVersion);

    let vcVarsScript: string = 'vcvarsall.bat';
    if (targetArch === "arm" || targetArch === "arm64") {
        // The arm(64) vcvars filename for x64 hosted toolset is using the 'amd64' alias.
        vcVarsScript = `vcvars${getHostTargetArchString(hostArch, targetArch, true)}.bat`;
    }
    let devBatFolder = path.join(vsInstall.installationPath, 'VC', 'Auxiliary', 'Build');
    if (majorVersion < 15) {
        devBatFolder = path.join(vsInstall.installationPath, 'VC');
    }

    const devBat = path.join(devBatFolder, vcVarsScript);
    // The presence of vcvars[hostArch][targetArch].bat indicates whether targetArch is included
    // in the given VS installation.
    if (!await fs.exists(devBat)) {
        return null;
    } else {
        return devBat;
    }
}

/**
 * Extracts environment variables from vcvarsall.bat.
 * @param inst The installation to extract variables from
 * @param hostArch The toolset host architecture
 * @param targetArch The toolset target architecture. If unspecified this defaults to `hostArch`
 * @param toolsetVersion The toolset version. If specified `inst` is assumed to have this toolset installed.
 */
export async function varsForVSInstallation(inst: VSInstallation, hostArch: string, targetArch?: string, toolsetVersion?: string): Promise<Environment | null> {
    log.trace(`varsForVSInstallation path:'${inst.installationPath}' version:${inst.installationVersion} host arch:${hostArch} - target arch:${targetArch}`);
    const commonDir = path.join(inst.installationPath, 'Common7', 'Tools');
    const majorVersion = parseInt(inst.installationVersion);
    const devbat = await getVcVarsBatScript(inst, hostArch, targetArch);
    if (!devbat) {
        return null;
    }

    const devBatArgs = [getHostTargetArchString(hostArch, targetArch, majorVersion < 15, true)];
    if (toolsetVersion && majorVersion >= 15) {
        devBatArgs.push(`-vcvars_ver=${toolsetVersion}`);
    }
    const variables = await collectDevBatVars(hostArch, devbat, devBatArgs, majorVersion, commonDir);
    if (!variables) {
        return null;
    } else {
        // This is a very *hacky* and sub-optimal solution, but it
        // works for now. This *helps* CMake make the right decision
        // when you have the release and pre-release edition of the same
        // VS version installed. I don't really know why or what causes
        // this issue, but this here seems to work. It basically just sets
        // the VS{vs_version_number}COMNTOOLS environment variable to contain
        // the path to the Common7 directory.
        const vsVersion = variables['VISUALSTUDIOVERSION'];
        if (vsVersion) {
            variables[`VS${vsVersion.replace('.', '')}COMNTOOLS`] = commonDir;
        }

        // For Ninja and Makefile generators, CMake searches for some compilers
        // before it checks for cl.exe. We can force CMake to check cl.exe first by
        // setting the CC and CXX environment variables when we want to do a
        // configure.
        variables['CC'] = 'cl.exe';
        variables['CXX'] = 'cl.exe';

        if (paths.ninjaPath) {
            let envPATH = variables['PATH'];
            if (undefined !== envPATH) {
                const envPaths = envPATH.split(';');
                const ninjaPath = path.dirname(paths.ninjaPath!);
                const ninjaPathBase = envPaths.find(path => path === ninjaPath);
                if (undefined === ninjaPathBase) {
                    envPATH = envPATH.concat(';' + ninjaPath);
                    variables['PATH'] = envPATH;
                }
            }
        }

        return variables;
    }
}
