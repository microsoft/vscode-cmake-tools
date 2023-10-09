/**
 * Module for vscode-cpptools integration.
 *
 * This module uses the [vscode-cpptools API](https://www.npmjs.com/package/vscode-cpptools)
 * to provide that extension with per-file configuration information.
 */ /** */

import { CodeModelFileGroup, CodeModelParams, CodeModelToolchain } from '@cmt/drivers/codeModel';
import { createLogger } from '@cmt/logging';
import rollbar from '@cmt/rollbar';
import * as shlex from '@cmt/shlex';
import * as util from '@cmt/util';
import * as path from 'path';
import * as vscode from 'vscode';
import * as cpptools from 'vscode-cpptools';
import * as nls from 'vscode-nls';
import { TargetTypeString } from './drivers/drivers';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = createLogger('cpptools');

type Architecture = 'x86' | 'x64' | 'arm' | 'arm64' | undefined;
type StandardVersion = "c89" | "c99" | "c11" | "c17" | "c++98" | "c++03" | "c++11" | "c++14" | "c++17" | "c++20" | "c++23" | "gnu89" | "gnu99" | "gnu11" | "gnu17" | "gnu++98" | "gnu++03" | "gnu++11" | "gnu++14" | "gnu++17" | "gnu++20" | "gnu++23" | undefined;
type IntelliSenseMode = "linux-clang-x86" | "linux-clang-x64" | "linux-clang-arm" | "linux-clang-arm64" | "linux-gcc-x86" | "linux-gcc-x64" | "linux-gcc-arm" | "linux-gcc-arm64" | "macos-clang-x86" | "macos-clang-x64" | "macos-clang-arm" | "macos-clang-arm64" | "macos-gcc-x86" | "macos-gcc-x64" | "macos-gcc-arm" | "macos-gcc-arm64" | "windows-clang-x86" | "windows-clang-x64" | "windows-clang-arm" | "windows-clang-arm64" | "windows-gcc-x86" | "windows-gcc-x64" | "windows-gcc-arm" | "windows-gcc-arm64" | "windows-msvc-x86" | "windows-msvc-x64" | "windows-msvc-arm" | "windows-msvc-arm64" | "msvc-x86" | "msvc-x64" | "msvc-arm" | "msvc-arm64" | "gcc-x86" | "gcc-x64" | "gcc-arm" | "gcc-arm64" | "clang-x86" | "clang-x64" | "clang-arm" | "clang-arm64" | undefined;

export interface DiagnosticsCpptools {
    isReady: boolean;
    hasCodeModel: boolean;
    activeBuildType: string;
    buildTypesSeen: string[];
    targetCount: number;
    executablesCount: number;
    librariesCount: number;
    targets: DiagnosticsTarget[];
    requests: string[];
    responses: cpptools.SourceFileConfigurationItem[];
    partialMatches: DiagnosticsPartialMatch[];
}

export interface DiagnosticsTarget {
    name: string;
    type: TargetTypeString;
}

export interface DiagnosticsPartialMatch {
    request: string;
    matches: string | string[];
}

export interface CompileFlagInformation {
    extraDefinitions: string[];
    standard?: StandardVersion;
    targetArch: Architecture;
}

class MissingCompilerException extends Error {}

interface TargetDefaults {
    name: string;
    includePath?: string[];
    compileCommandFragments: string[];
    defines?: string[];
}

function parseCppStandard(std: string, canUseGnu: boolean, canUseCxx23: boolean): StandardVersion {
    const isGnu = canUseGnu && std.startsWith('gnu');
    if (std.endsWith('++23') || std.endsWith('++2b') || std.endsWith('++latest')) {
        if (canUseCxx23) {
            return isGnu ? 'gnu++23' : 'c++23';
        } else {
            return isGnu ? 'gnu++20' : 'c++20';
        }
    } else if (std.endsWith('++20') || std.endsWith('++2a')) {
        return isGnu ? 'gnu++20' : 'c++20';
    } else if (std.endsWith('++17') || std.endsWith('++1z')) {
        return isGnu ? 'gnu++17' : 'c++17';
    } else if (std.endsWith('++14') || std.endsWith('++1y')) {
        return isGnu ? 'gnu++14' : 'c++14';
    } else if (std.endsWith('++11') || std.endsWith('++0x')) {
        return isGnu ? 'gnu++11' : 'c++11';
    } else if (std.endsWith('++03')) {
        return isGnu ? 'gnu++03' : 'c++03';
    } else if (std.endsWith('++98')) {
        return isGnu ? 'gnu++98' : 'c++98';
    } else {
        return undefined;
    }
}

function parseCStandard(std: string, canUseGnu: boolean): StandardVersion {
    // GNU options from: https://gcc.gnu.org/onlinedocs/gcc/C-Dialect-Options.html#C-Dialect-Options
    const isGnu = canUseGnu && std.startsWith('gnu');
    if (/(c|gnu)(90|89|iso9899:(1990|199409))/.test(std)) {
        return isGnu ? 'gnu89' : 'c89';
    } else if (/(c|gnu)(99|9x|iso9899:(1999|199x))/.test(std)) {
        return isGnu ? 'gnu99' : 'c99';
    } else if (/(c|gnu)(11|1x|iso9899:2011)/.test(std)) {
        return isGnu ? 'gnu11' : 'c11';
    } else if (/(c|gnu)(17|18|2x|iso9899:(2017|2018))/.test(std)) {
        if (canUseGnu) {
            // cpptools supports 'c17' in same version it supports GNU std.
            return isGnu ? 'gnu17' : 'c17';
        } else {
            return 'c11';
        }
    } else {
        return undefined;
    }
}

function parseTargetArch(target: string): Architecture {
    // Value of target param is lowercased.
    const isArm32: (value: string) => boolean = value => {
        // ARM verions from https://en.wikipedia.org/wiki/ARM_architecture#Cores
        if (value.indexOf('armv8-r') >= 0 || value.indexOf('armv8-m') >= 0) {
            return true;
        } else {
            // Check if ARM version is 7 or earlier.
            const verStr = value.substr(5, 1);
            const verNum = +verStr;
            return verNum <= 7;
        }
    };
    switch (target) {
        case '-m32':
        case 'i686':
            return 'x86';
        case '-m64':
        case 'amd64':
        case 'x86_64':
            return 'x64';
        case 'aarch64':
        case 'arm64':
            return 'arm64';
        case 'arm':
            return 'arm';
    }
    // Check triple target value
    if (target.indexOf('aarch64') >= 0 || target.indexOf('arm64') >= 0
        || target.indexOf('armv8-a') >= 0 || target.indexOf('armv8.') >= 0) {
        return 'arm64';
    } else if (target.indexOf('arm') >= 0 || isArm32(target)) {
        return 'arm';
    } else if (target.indexOf('i686') >= 0) {
        return 'x86';
    } else if (target.indexOf('amd64') >= 0 || target.indexOf('x86_64') >= 0) {
        return 'x64';
    }
    // TODO: add an allow list of architecture values and add telemetry
    return undefined;
}

export function parseCompileFlags(cptVersion: cpptools.Version, args: string[], lang?: string): CompileFlagInformation {
    const requireStandardTarget = (cptVersion < cpptools.Version.v5);
    const canUseGnuStd = (cptVersion >= cpptools.Version.v4);
    const canUseCxx23 = (cptVersion >= cpptools.Version.v6);
    // No need to parse language standard for CppTools API v6 and above
    const extractStdFlag = (cptVersion < cpptools.Version.v6);
    const iter = args[Symbol.iterator]();
    const extraDefinitions: string[] = [];
    let standard: StandardVersion;
    let targetArch: Architecture;
    while (1) {
        const { done, value } = iter.next();
        if (done) {
            break;
        }
        const lower = value.toLowerCase();
        if (requireStandardTarget && (lower === '-m32' || lower === '-m64')) {
            targetArch = parseTargetArch(lower);
        } else if (requireStandardTarget && (lower.startsWith('-arch=') || lower.startsWith('/arch:'))) {
            const target = lower.substring(6);
            targetArch = parseTargetArch(target);
        } else if (requireStandardTarget && lower === '-arch') {
            const { done, value } = iter.next();
            if (done) {
                // TODO: add an allow list of architecture values and add telemetry
                continue;
            }
            targetArch = parseTargetArch(value.toLowerCase());
        } else if (requireStandardTarget && lower.startsWith('-march=')) {
            const target = lower.substring(7);
            targetArch = parseTargetArch(target);
        } else if (requireStandardTarget && lower.startsWith('--target=')) {
            const target = lower.substring(9);
            targetArch = parseTargetArch(target);
        } else if (requireStandardTarget && lower === '-target') {
            const { done, value } = iter.next();
            if (done) {
                // TODO: add an allow list of architecture values and add telemetry
                continue;
            }
            targetArch = parseTargetArch(value.toLowerCase());
        } else if (value === '-D' || value === '/D') {
            const { done, value } = iter.next();
            if (done) {
                rollbar.error(localize('unexpected.end.of.arguments', 'Unexpected end of parsing command line arguments'));
                continue;
            }
            extraDefinitions.push(value);
        } else if (value.startsWith('-D') || value.startsWith('/D')) {
            const def = value.substring(2);
            extraDefinitions.push(def);
        } else if (extractStdFlag && (value.startsWith('-std=') || lower.startsWith('-std:') || lower.startsWith('/std:'))) {
            const std = value.substring(5);
            if (lang === 'CXX' || lang === 'OBJCXX' || lang === 'CUDA') {
                const s = parseCppStandard(std, canUseGnuStd, canUseCxx23);
                if (!s) {
                    log.warning(localize('unknown.control.gflag.cpp', 'Unknown C++ standard control flag: {0}', value));
                } else {
                    standard = s;
                }
            } else if (lang === 'C' || lang === 'OBJC') {
                const s = parseCStandard(std, canUseGnuStd);
                if (!s) {
                    log.warning(localize('unknown.control.gflag.c', 'Unknown C standard control flag: {0}', value));
                } else {
                    standard = s;
                }
            } else if (lang === undefined) {
                let s = parseCppStandard(std, canUseGnuStd, canUseCxx23);
                if (!s) {
                    s = parseCStandard(std, canUseGnuStd);
                }
                if (!s) {
                    log.warning(localize('unknown.control.gflag', 'Unknown standard control flag: {0}', value));
                } else {
                    standard = s;
                }
            } else {
                log.warning(localize('unknown language', 'Unknown language: {0}', lang));
            }
        }
    }
    if (!standard && requireStandardTarget && extractStdFlag) {
        standard = (lang === 'C') ? 'c11' : 'c++17';
    }
    return { extraDefinitions, standard, targetArch };
}

/**
 * Determine the IntelliSenseMode based on hints from compiler path
 * and target architecture parsed from compiler flags.
 */
export function getIntelliSenseMode(cptVersion: cpptools.Version, compilerPath: string, targetArch: Architecture) {
    if (cptVersion >= cpptools.Version.v5 && targetArch === undefined) {
        // IntelliSenseMode is optional for CppTools v5+ and is determined by CppTools.
        return undefined;
    }
    const canUseArm = (cptVersion >= cpptools.Version.v4);
    const compilerName = path.basename(compilerPath || "").toLocaleLowerCase();
    if (compilerName === 'cl.exe') {
        const clArch = path.basename(path.dirname(compilerPath)).toLocaleLowerCase();
        switch (clArch) {
            case 'arm64':
                return canUseArm ? 'msvc-arm64' : 'msvc-x64';
            case 'arm':
                return canUseArm ? 'msvc-arm' : 'msvc-x86';
            case 'x86':
                return 'msvc-x86';
            case 'x64':
            default:
                return 'msvc-x64';
        }
    } else if (compilerName.indexOf('armclang') >= 0) {
        switch (targetArch) {
            case 'arm64':
                return canUseArm ? 'clang-arm64' : 'clang-x64';
            case 'arm':
            default:
                return canUseArm ? 'clang-arm' : 'clang-x86';
        }
    } else if (compilerName.indexOf('clang') >= 0) {
        switch (targetArch) {
            case 'arm64':
                return canUseArm ? 'clang-arm64' : 'clang-x64';
            case 'arm':
                return canUseArm ? 'clang-arm' : 'clang-x86';
            case 'x86':
                return 'clang-x86';
            case 'x64':
            default:
                return 'clang-x64';
        }
    } else if (compilerName.indexOf('aarch64') >= 0) {
        // Compiler with 'aarch64' in its name may also have 'arm', so check for
        // aarch64 compilers before checking for ARM specific compilers.
        return canUseArm ? 'gcc-arm64' : 'gcc-x64';
    } else if (compilerName.indexOf('arm') >= 0) {
        return canUseArm ? 'gcc-arm' : 'gcc-x86';
    } else if (compilerName.indexOf('gcc') >= 0 || compilerName.indexOf('g++') >= 0) {
        switch (targetArch) {
            case 'x86':
                return 'gcc-x86';
            case 'x64':
                return 'gcc-x64';
            case 'arm64':
                return canUseArm ? 'gcc-arm64' : 'gcc-x64';
            case 'arm':
                return canUseArm ? 'gcc-arm' : 'gcc-x86';
            default:
                return 'gcc-x64';
        }
    } else {
        // unknown compiler; pick platform defaults.
        if (process.platform === 'win32') {
            return 'msvc-x64';
        } else if (process.platform === 'darwin') {
            return 'clang-x64';
        } else {
            return 'gcc-x64';
        }
    }
}

/**
 * The actual class that provides information to the cpptools extension. See
 * the `CustomConfigurationProvider` interface for information on how this class
 * should be used.
 */
export class CppConfigurationProvider implements cpptools.CustomConfigurationProvider {
    /** Our name visible to cpptools */
    readonly name = 'CMake Tools';
    /** Our extension ID, visible to cpptools */
    readonly extensionId = 'ms-vscode.cmake-tools';
    /**
     * This value determines if we need to show the user an error message about missing compilers. When an update succeeds
     * without missing any compilers, we set this to `true`, otherwise `false`.
     *
     * If an update fails and the value is `true`, we display the message. If an
     * update fails and the value is `false`, we do not display the message.
     *
     * This ensures that we only show the message the first time an update fails
     * within a sequence of failing updates.
     */
    private lastUpdateSucceeded = true;

    private workspaceBrowseConfiguration: cpptools.WorkspaceBrowseConfiguration = { browsePath: [] };
    private readonly workspaceBrowseConfigurations = new Map<string, cpptools.WorkspaceBrowseConfiguration>();

    /**
     * Get the SourceFileConfigurationItem from the index for the given URI
     * @param uri The configuration to get from the index
     */
    private getConfiguration(uri: vscode.Uri): cpptools.SourceFileConfigurationItem | undefined {
        const normalizedPath = util.platformNormalizePath(uri.fsPath);
        const configurations = this.fileIndex.get(normalizedPath);
        if (this.activeTarget && configurations?.has(this.activeTarget)) {
            return configurations!.get(this.activeTarget);
        } else {
            return configurations?.values().next().value; // Any value is fine if the target doesn't match
        }
    }

    /**
     * Test if we are able to provide a configuration for the given URI
     * @param uri The URI to look up
     */
    async canProvideConfiguration(uri: vscode.Uri) {
        this.requests.add(uri.toString());
        return !!this.getConfiguration(uri);
    }

    private requests = new Set<string>();
    private responses = new Map<string, cpptools.SourceFileConfigurationItem>();

    /**
     * Get the configurations for the given URIs. URIs for which we have no
     * configuration are simply ignored.
     * @param uris The file URIs to look up
     */
    async provideConfigurations(uris: vscode.Uri[]) {
        const configs = util.dropNulls(uris.map(u => this.getConfiguration(u)));
        configs.forEach(config => {
            this.responses.set(config.uri.toString(), config);
        });
        return configs;
    }

    /**
     * A request to determine whether this provider can provide a code browsing configuration for the workspace folder.
     * @param token (optional) The cancellation token.
     * @returns 'true' if this provider can provider a code browsing configuration for the workspace folder.
     */
    async canProvideBrowseConfiguration() {
        return true;
    }

    /**
     * A request to get the code browsing configuration for the workspace folder.
     * @returns A [WorkspaceBrowseConfiguration](#WorkspaceBrowseConfiguration) with the information required to
     * construct the equivalent of `browse.path` from `c_cpp_properties.json`.
     */
    async provideBrowseConfiguration() {
        return this.workspaceBrowseConfiguration;
    }

    async canProvideBrowseConfigurationsPerFolder() {
        return true;
    }

    async provideFolderBrowseConfiguration(uri: vscode.Uri): Promise<cpptools.WorkspaceBrowseConfiguration | null> {
        return this.workspaceBrowseConfigurations.get(util.platformNormalizePath(uri.fsPath)) ?? null;
    }

    /** No-op */
    dispose() {}

    /**
     * Index of files to configurations, using the normalized path to the file
     * as the key to the <target,configuration>.
     */
    private readonly fileIndex = new Map<string, Map<string, cpptools.SourceFileConfigurationItem>>();

    /**
     * If a source file configuration exists for the active target, we will prefer that one when asked.
     */
    private activeTarget: string | null = null;

    private activeBuildType: string | null = null;
    private buildTypesSeen = new Set<string>();

    /**
     * Create a source file configuration for the given file group.
     * @param fileGroup The file group from the code model to create config data for
     * @param opts Index update options
     */
    private buildConfigurationData(fileGroup: CodeModelFileGroup, opts: CodeModelParams, target: TargetDefaults, sysroot?: string): cpptools.SourceFileConfiguration {
        // For CppTools V6 and above, build the compilerFragments data, otherwise build compilerArgs data
        const useFragments: boolean = this.cpptoolsVersion >= cpptools.Version.v6;
        // If the file didn't have a language, default to C++
        const lang = fileGroup.language === "RC" ? undefined : fileGroup.language;
        // First try to get toolchain values directly reported by CMake. Check the
        // group's language compiler, then the C++ compiler, then the C compiler.
        let compilerToolchains: CodeModelToolchain | undefined;
        if ("toolchains" in opts.codeModelContent) {
            compilerToolchains = opts.codeModelContent.toolchains?.get(lang ?? "")
            || opts.codeModelContent.toolchains?.get('CXX')
            || opts.codeModelContent.toolchains?.get('C');
        }
        // If none of those work, fall back to the same order, but in the cache.
        const compilerCache = opts.cache.get(`CMAKE_${lang}_COMPILER`)
            || opts.cache.get('CMAKE_CXX_COMPILER')
            || opts.cache.get('CMAKE_C_COMPILER');
        // Try to get the path to the compiler we want to use
        const compilerPath = compilerToolchains ? compilerToolchains.path : (compilerCache ? compilerCache.as<string>() : opts.clCompilerPath);
        if (!compilerPath) {
            throw new MissingCompilerException();
        }

        const targetFromToolchains = compilerToolchains?.target;
        const targetArchFromToolchains = targetFromToolchains ? parseTargetArch(targetFromToolchains) : undefined;

        const normalizedCompilerPath = util.platformNormalizePath(compilerPath);
        let compileCommandFragments = useFragments ? (fileGroup.compileCommandFragments || target.compileCommandFragments) : [];
        const getAsFlags = (fragments?: string[]) => {
            if (!fragments) {
                return [];
            }
            return [...util.flatMap(fragments, fragment => shlex.split(fragment))];
        };
        let flags: string[] = [];
        let extraDefinitions: string[] = [];
        let standard: StandardVersion;
        let targetArch: Architecture;
        let intelliSenseMode: IntelliSenseMode;
        let defines = (fileGroup.defines || target.defines || []);
        if (!useFragments) {
            // Send the intelliSenseMode and standard only for CppTools API v5 and below.
            flags = getAsFlags(fileGroup.compileCommandFragments || target.compileCommandFragments);
            ({ extraDefinitions, standard, targetArch } = parseCompileFlags(this.cpptoolsVersion, flags, lang));
            defines = defines.concat(extraDefinitions);
            intelliSenseMode = getIntelliSenseMode(this.cpptoolsVersion, compilerPath, targetArchFromToolchains ?? targetArch);
        }
        const frameworkPaths = Array.from(new Set<string>((fileGroup.frameworks ?? []).map(f => path.dirname(f.path))));
        const includePath = (fileGroup.includePath ? fileGroup.includePath.map(p => p.path) : target.includePath || []).concat(frameworkPaths);
        const normalizedIncludePath = includePath.map(p => util.platformNormalizePath(p));

        const newBrowsePath = this.workspaceBrowseConfiguration.browsePath;
        for (const includePathItem of normalizedIncludePath) {
            if (newBrowsePath.indexOf(includePathItem) < 0) {
                newBrowsePath.push(includePathItem);
            }
        }

        if (sysroot) {
            if (useFragments) {
                // Pass sysroot (without quote added) as the only compilerArgs for CppTools API V6 and above.
                flags.push(`--sysroot=${sysroot}`);
            } else {
                // Send sysroot with quoting for CppTools API V5 and below.
                flags.push(`--sysroot=${shlex.quote(sysroot)}`);
            }
        }
        if (targetFromToolchains) {
            if (useFragments) {
                compileCommandFragments = compileCommandFragments.slice(0);
                compileCommandFragments.push(`--target=${targetFromToolchains}`);
            } else {
                flags.push(`--target=${targetFromToolchains}`);
            }
        }

        this.workspaceBrowseConfiguration = {
            browsePath: newBrowsePath,
            compilerPath: normalizedCompilerPath || undefined,
            compilerArgs: flags,
            compilerFragments: useFragments ? compileCommandFragments : undefined,
            standard
            // windowsSdkVersion
        };

        this.workspaceBrowseConfigurations.set(util.platformNormalizePath(opts.folder), this.workspaceBrowseConfiguration);

        return {
            includePath: normalizedIncludePath,
            defines,
            intelliSenseMode,
            standard,
            // forcedInclude,
            compilerPath: normalizedCompilerPath || undefined,
            compilerArgs: flags,
            compilerFragments: useFragments ? compileCommandFragments : undefined
            // windowsSdkVersion
        };
    }

    /**
     * Update the configuration index for the files in the given file group
     * @param sourceDir The source directory where the file group was defined. Used to resolve
     * relative paths
     * @param fileGroup The file group
     * @param options Index update options
     */
    private updateFileGroup(sourceDir: string, fileGroup: CodeModelFileGroup, options: CodeModelParams, target: TargetDefaults, sysroot?: string) {
        const configuration = this.buildConfigurationData(fileGroup, options, target, sysroot);
        for (const src of fileGroup.sources) {
            const absolutePath = path.isAbsolute(src) ? src : path.join(sourceDir, src);
            const normalizedAbsolutePath = util.platformNormalizePath(absolutePath);
            if (this.fileIndex.has(normalizedAbsolutePath)) {
                this.fileIndex.get(normalizedAbsolutePath)!.set(target.name, {
                    uri: vscode.Uri.file(absolutePath).toString(),
                    configuration
                });
            } else {
                const data = new Map<string, cpptools.SourceFileConfigurationItem>();
                data.set(target.name, {
                    uri: vscode.Uri.file(absolutePath).toString(),
                    configuration
                });
                this.fileIndex.set(normalizedAbsolutePath, data);
            }
            const dir = path.dirname(normalizedAbsolutePath);
            if (this.workspaceBrowseConfiguration.browsePath.indexOf(dir) < 0) {
                this.workspaceBrowseConfiguration.browsePath.push(dir);
            }
        }
    }

    /**
     * Version of Cpptools API
     */
    public cpptoolsVersion: cpptools.Version = cpptools.Version.latest;

    private targets: DiagnosticsTarget[] = [];

    /**
     * Update the file index and code model
     * @param opts Update parameters
     */
    updateConfigurationData(opts: CodeModelParams) {
        // Reset the counters for diagnostics
        this.requests.clear();
        this.responses.clear();
        this.buildTypesSeen.clear();
        this.targets = [];

        let hadMissingCompilers = false;
        this.workspaceBrowseConfiguration = { browsePath: [] };
        this.activeTarget = opts.activeTarget;
        this.activeBuildType = opts.activeBuildTypeVariant;
        for (const config of opts.codeModelContent.configurations) {
            this.buildTypesSeen.add(config.name);
        }
        if (this.buildTypesSeen.size > 0 && !this.buildTypesSeen.has(opts.activeBuildTypeVariant || "")) {
            const configName = opts.codeModelContent.configurations[0].name;
            log.warning(localize('build.type.out.of.sync',
                "The build configurations generated do not contain the active build configuration. Using {0} for CMAKE_BUILD_TYPE instead of {1} to ensure that IntelliSense configurations can be found",
                `"${configName}"`, `"${opts.activeBuildTypeVariant}"`));
            opts.activeBuildTypeVariant = configName;
        }
        for (const config of opts.codeModelContent.configurations) {
            // Update only the active build type variant.
            if (config.name === opts.activeBuildTypeVariant || (!opts.activeBuildTypeVariant && config.name === "")) {
                for (const project of config.projects) {
                    for (const target of project.targets) {
                        // Now some shenanigans since header files don't have config data:
                        // 1. Accumulate some "defaults" based on the set of all options for each file group
                        // 2. Pass these "defaults" down when rebuilding the config data
                        // 3. Any `fileGroup` that does not have the associated attribute will receive the `default`
                        const grps = target.fileGroups || [];
                        const includePath = [...new Set(util.flatMap(grps, grp => grp.includePath || []))].map(item => item.path);
                        const compileCommandFragments = [...util.first(grps, grp => grp.compileCommandFragments || [])];
                        const defines = [...new Set(util.flatMap(grps, grp => grp.defines || []))];
                        const sysroot = target.sysroot;
                        this.targets.push({ name: target.name, type: target.type });
                        for (const grp of target.fileGroups || []) {
                            try {
                                this.updateFileGroup(
                                    target.sourceDirectory || '',
                                    grp,
                                    opts,
                                    {
                                        name: target.name,
                                        compileCommandFragments,
                                        includePath,
                                        defines
                                    },
                                    sysroot
                                );
                            } catch (e) {
                                if (e instanceof MissingCompilerException) {
                                    hadMissingCompilers = true;
                                } else {
                                    throw e;
                                }
                            }
                        }
                    }
                }
                break;
            }
        }
        if (hadMissingCompilers && this.lastUpdateSucceeded) {
            void vscode.window.showErrorMessage(localize('path.not.found.in.cmake.cache',
                'The path to the compiler for one or more source files was not found in the CMake cache. If you are using a toolchain file, this probably means that you need to specify the CACHE option when you set your C and/or C++ compiler path'));
        }
        this.lastUpdateSucceeded = !hadMissingCompilers;
    }

    private readyFlag: boolean = false;
    get ready(): boolean {
        return this.readyFlag;
    }
    markAsReady() {
        this.readyFlag = true;
    }

    getDiagnostics(): DiagnosticsCpptools {
        const partialMatches: DiagnosticsPartialMatch[] = [];
        for (const request of this.requests) {
            const uri = vscode.Uri.parse(request);
            const configuration = this.getConfiguration(uri);
            if (!configuration) {
                const fileName = path.basename(uri.fsPath);
                const matches = [];
                for (const [key, _] of this.fileIndex) {
                    if (path.basename(key) === fileName) {
                        matches.push(key);
                    }
                }
                if (matches.length === 1) {
                    partialMatches.push({ request, matches: matches.toString() });
                } else if (matches.length > 1) {
                    partialMatches.push({ request, matches });
                }
            }
        }

        return {
            isReady: this.readyFlag,
            hasCodeModel: this.fileIndex.size > 0,
            activeBuildType: this.activeBuildType || "",
            buildTypesSeen: [...this.buildTypesSeen.values()],
            requests: [...this.requests.values()],
            responses: [...this.responses.values()],
            partialMatches,
            targetCount: this.targets.length,
            executablesCount: this.targets.reduce<number>((acc, target) => target.type === 'EXECUTABLE' ? acc + 1 : acc, 0),
            librariesCount: this.targets.reduce<number>((acc, target) => target.type.endsWith('LIBRARY') ? acc + 1 : acc, 0),
            targets: this.targets.length < 20 ? this.targets : []
        };
    }
}
