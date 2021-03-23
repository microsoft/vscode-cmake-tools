/**
 * Module for controlling and working with Kits.
 */ /** */

import rollbar from '@cmt/rollbar';
import * as util from '@cmt/util';
import * as json5 from 'json5';
import * as path from 'path';
import * as vscode from 'vscode';
import * as kitsController from '@cmt/kitsController';

import CMakeTools from './cmake-tools';
import * as expand from './expand';
import {VSInstallation, vsInstallations} from './installs/visual-studio';
import * as logging from './logging';
import paths from './paths';
import {fs} from './pr';
import * as proc from './proc';
import {loadSchema} from './schema';
import { TargetTriple, findTargetTriple, parseTargetTriple, computeTargetTriple } from './triple';
import {compare, dropNulls, objectPairs, Ordering, versionLess} from './util';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('kit');

/**
 * Special kit types and names
 */
export enum SpecialKits {
  ScanForKits = '__scanforkits__',
  Unspecified = '__unspec__'
}
export const SpecialKitsCount: number = 2;
export type UnspecifiedKit = SpecialKits.Unspecified;

type ProgressReporter = vscode.Progress<{message?: string}>;

/**
 * The path to the user-local kits file.
 */
export const USER_KITS_FILEPATH = path.join(paths.dataDir, 'cmake-tools-kits.json');

/**
 * The old path where kits were stored. Upgraded in 1.1.3
 */
export const OLD_USER_KITS_FILEPATH
    = path.join(process.platform === 'win32' ? paths.roamingDataDir : paths.dataDir, 'cmake-tools.json');

/**
 * Representation of a CMake generator, along with a toolset and platform
 */
export interface CMakeGenerator {
  name: string;
  toolset?: string;
  platform?: string;
}

type CompilerVendorEnum = 'Clang' | 'GCC' | 'MSVC';

export interface KitDetect {
  /**
   * The vendor name of the kit
   */
  vendor?: CompilerVendorEnum;

  /**
   * The triple the kit
   */
  triple?: string;

  /**
   * The version of the kit
   */
  version?: string;

  /**
   * The version of the C runtime for the kit
   * In most case it's equal to version, but for `Clang for MSVC`
   * The Clang version are version
   * The MSVC version are versionRuntime
   */
  versionRuntime?: string;
}

export interface Kit extends KitDetect {
  /**
   * The name of the kit
   */
  name: string;

  /**
   * The preferred CMake generator for this kit
   */
  preferredGenerator?: CMakeGenerator;

  /**
   * Additional settings to pass to CMake
   */
  cmakeSettings?: {[key: string]: string};

  /**
   * Additional environment variables for the kit
   */
  environmentVariables?: proc.EnvironmentVariables;

  /**
   * The language compilers.
   *
   * The key `lang` is the language, as in `CMAKE_<lang>_COMPILER`.
   * The corresponding value is a path to a compiler for that language.
   */
  compilers?: {[lang: string]: string};

  /**
   * The visual studio name. This corresponds to the major.minor version of
   * the installation returned by `vswhere`.
   */
  visualStudio?: string;

  /**
   * The architecture for the kit. This is used when asking for the architecture
   * from the dev environment batch file.
   */
  visualStudioArchitecture?: string;

  /**
   * Filename of a shell script which sets environment variables for the kit
   */
  environmentSetupScript?: string;

  /**
   * Path to a CMake toolchain file.
   */
  toolchainFile?: string;

  /**
   * If `true`, keep this kit around even if it seems out-of-date
   */
  keep?: boolean;
}

interface CompilerVersion {
  vendor: CompilerVendorEnum;
  detectedName: string;
  fullVersion: string;
  version: string;
  target: TargetTriple;
  threadModel?: string;
  installedDir?: string;
}

export async function getCompilerVersion(vendor: CompilerVendorEnum, binPath: string): Promise<CompilerVersion|null> {
  log.debug(localize('testing.compiler.binary', 'Testing {0} binary: {1}', vendor, binPath));
  const exec = await proc.execute(binPath, ['-v']).result;
  if (exec.retc !== 0) {
    log.debug(localize('bad.compiler.binary', 'Bad {0} binary ("-v" returns non-zero): {1}', vendor, binPath));
    return null;
  }
  let version_re_loc: RegExp;
  let version_re_en: RegExp;
  const versionWord: string = localize("version.word", "version");
  let version_match_index;
  if (vendor === 'Clang') {
    const version_re_str_loc: string = `^(?:Apple LLVM|.*clang) ${versionWord} ([^\\s-]+)(?:[\\s-]|$)`;
    const version_re_str_en: string = `^(?:Apple LLVM|.*clang) version ([^\\s-]+)(?:[\\s-]|$)`;
    version_re_loc = RegExp(version_re_str_loc, "mgi");
    version_re_en = RegExp(version_re_str_en, "mgi");
    version_match_index = 1;
  } else {
    const version_re_str_loc: string = `^gcc(-| )${versionWord} (.*?) .*`;
    const version_re_str_en: string = `^gcc(-| )version (.*?) .*`;
    version_re_loc = RegExp(version_re_str_loc, "mgi");
    version_re_en = RegExp(version_re_str_en, "mgi");
    version_match_index = 2;
  }

  let target: TargetTriple | undefined = undefined;
  let version: string = "";
  let fullVersion: string = "";
  const lines = exec.stderr.trim().split('\n');
  for (const line of lines) {
    const version_match = version_re_en.exec(line) || version_re_loc.exec(line);
    if (version_match !== null && version === '') {
      version = version_match[version_match_index];
      fullVersion = line;
    }
    const target_triple_match = findTargetTriple(line);
    if (target_triple_match !== null) {
      target = parseTargetTriple(target_triple_match);
    }
  }
  if (version === '' || target === undefined) {
    log.debug(localize('bad.compiler.binary.output', 'Bad {0} binary "{1} -v" version:{2} output: {3}', vendor, binPath, version, exec.stderr));
    return null;
  }
  const thread_model_mat = /Thread model:\s+(.*)/.exec(exec.stderr);
  let threadModel: string|undefined;
  if (thread_model_mat) {
    threadModel = thread_model_mat[1];
  }
  const install_dir_mat = /InstalledDir:\s+(.*)/.exec(exec.stderr);
  let installedDir: string|undefined;
  if (install_dir_mat && vendor === 'Clang') {
    installedDir = install_dir_mat[1];
  }
  const detectedName = `${vendor} ${version} ${target.triple}`;
  log.debug(localize('detected.compiler', 'Detected {0} compiler: {1}', vendor, binPath));
  return {
    vendor,
    detectedName,
    fullVersion,
    version,
    target,
    threadModel,
    installedDir,
  };
}

export async function getKitDetect(kit: Kit): Promise<KitDetect> {
  const c_bin = kit?.compilers?.C;
  /* Special handling of visualStudio */
  if (kit.visualStudio) {
    const vs = await getVSInstallForKit(kit);
    if (!vs) {
      return kit;
    }
    let version: CompilerVersion|null = null;
    if (c_bin) {
      version = await getCompilerVersion('Clang', c_bin);
    }
    let targetArch = kit.preferredGenerator?.platform ?? kit.visualStudioArchitecture ?? 'i686';
    if (targetArch === 'win32') {
      targetArch = 'i686';
    }
    const triple = `${targetArch}-pc-windows-msvc`;
    let versionCompiler = vs.installationVersion;
    let vendor: CompilerVendorEnum;
    if (version !== null) {
      vendor = 'Clang';
      versionCompiler = version.version;
    } else {
      vendor = `MSVC`;
    }
    return {
      vendor,
      triple,
      version: versionCompiler,
      versionRuntime: vs.installationVersion
    };
  } else {
    let vendor: CompilerVendorEnum | undefined = undefined;
    if (kit.name.startsWith('GCC ')) {
      vendor = 'GCC';
    } else if (kit.name.startsWith('Clang ')) {
      vendor = 'Clang';
    }
    if (vendor === undefined) {
      return kit;
    }

    let version: CompilerVersion|null = null;
    if (c_bin) {
      version = await getCompilerVersion(vendor, c_bin);
    }
    if (!version) {
      return kit;
    }
    return {
      vendor,
      triple: computeTargetTriple(version.target),
      version: version.version,
      versionRuntime: version.version,
    };
  }
}

/**
 * Convert a binary (by path) to a CompilerKit. This checks if the named binary
 * is a GCC or Clang compiler and gets its version. If it is not a compiler,
 * returns `null`.
 * @param bin Path to a binary
 * @returns A CompilerKit, or null if `bin` is not a known compiler
 */
export async function kitIfCompiler(bin: string, pr?: ProgressReporter): Promise<Kit|null> {
  const fname = path.basename(bin);
  // Check by filename what the compiler might be. This is just heuristic.
  const gcc_regex = /^((\w+-)*)gcc(-\d+(\.\d+(\.\d+)?)?)?(\.exe)?$/;
  const clang_regex = /^clang(-\d+(\.\d+(\.\d+)?)?)?(\.exe)?$/;
  const gcc_res = gcc_regex.exec(fname);
  const clang_res = clang_regex.exec(fname);
  if (gcc_res) {
    log.debug(localize('testing.gcc.binary', 'Testing GCC binary: {0}', bin));
    if (pr)
      pr.report({message: localize('getting.gcc.version', 'Getting GCC version for {0}', bin)});
    const version = await getCompilerVersion('GCC', bin);
    if (version === null) {
      return null;
    }
    const gxx_fname = fname.replace(/gcc/, 'g++');
    const gxx_bin = path.join(path.dirname(bin), gxx_fname);
    const gccCompilers: {[lang: string]: string} = { C: bin };
    if (await fs.exists(gxx_bin)) {
      gccCompilers.CXX = gxx_bin;
    }
    const gccKit: Kit = {
      name: version.detectedName,
      compilers: gccCompilers
    };

    const isWin32 = process.platform === 'win32';
    if (isWin32 && bin.toLowerCase().includes('mingw')) {
      const binParentPath = path.dirname(bin);
      const mingwMakePath = path.join(binParentPath, 'mingw32-make.exe');
      if (await fs.exists(mingwMakePath)) {
        // During a scan, binParentPath must be a directory already in the PATH.
        // Therefore, we will assume that MinGW will remain in the user's PATH
        // and do not need to record the current state of PATH (leave it to the
        // user to rescan later or specify an explicit path to MinGW if this
        // changes).  Additionally, caching the current state of PATH can cause
        // complications on later invocation when using the kit environment
        // because its PATH will take precedence.  If a user makes changes to
        // their PATH later without rescanning for kits, then the kit's cached
        // PATH will clobber the actual current PATH.  We will, however, record
        // the MinGW path in case we want to use it later.
        const ENV_PATH = `${binParentPath}`;
        // Check for working mingw32-make
        const execMake = await proc.execute(mingwMakePath, ['-v'], null, {environment: {PATH: ENV_PATH}}).result;
        if (execMake.retc !== 0) {
          log.debug(localize('bad.mingw32-make.binary', 'Bad mingw32-make binary ("-v" returns non-zero): {0}', bin));
        } else {
          let make_version_output = execMake.stdout;
          if (make_version_output.length === 0)
            make_version_output = execMake.stderr;
          const output_line_sep = make_version_output.trim().split('\n');
          const isMake = output_line_sep[0].includes('Make');
          const isMingwTool = output_line_sep[1].includes('mingw32');

          if (isMake && isMingwTool) {
            gccKit.preferredGenerator = {name: 'MinGW Makefiles'};
            // save the ENV_PATH as a benign name unlikely to already exist in
            // the user's environment, like CMT_MINGW_PATH
            gccKit.environmentVariables = {CMT_MINGW_PATH: ENV_PATH};
          }
        }
      }
    }
    return gccKit;

  } else if (clang_res) {
    log.debug(localize('testing.clang.binary', 'Testing Clang binary: {0}', bin));
    if (pr)
      pr.report({message: localize('getting.clang.version', 'Getting Clang version for {0}', bin)});
    const version = await getCompilerVersion('Clang', bin);
    if (version === null) {
      return null;
    }

    if (version.target && version.target.triple.includes('msvc') &&
      version.installedDir && version.installedDir.includes("Microsoft Visual Studio")) {
      // Skip MSVC ABI compatible Clang installations (bundled within VS), which will be handled in 'scanForClangForMSVCKits()' later.
      // But still process any Clang installations outside VS (right in Program Files for example), even if their version
      // mentions msvc.
      return null;
    }

    const clangxx_fname = fname.replace(/^clang/, 'clang++');
    const clangxx_bin = path.join(path.dirname(bin), clangxx_fname);
    log.debug(localize('detected.clang.compiler', 'Detected Clang compiler: {0}', bin));
    const clangCompilers: {[lang: string]: string} = { C: bin };
    if (await fs.exists(clangxx_bin)) {
      clangCompilers.CXX = clangxx_bin;
    }
    return {
      name: version.detectedName,
      compilers: clangCompilers,
    };
  } else {
    return null;
  }
}

async function scanDirectory<Ret>(dir: string, mapper: (filePath: string) => Promise<Ret|null>): Promise<Ret[]> {
  if (!await fs.exists(dir)) {
    log.debug(localize('skipping.scan.of.not.existing.path', 'Skipping scan of not existing path {0}', dir));
    return [];
  }

  log.debug(localize('scanning.directory.for.compilers', 'Scanning directory {0} for compilers', dir));
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      console.log('Skipping scan of non-directory', dir);
      return [];
    }
  } catch (e) {
    log.warning(localize('failed.to.scan', 'Failed to scan {0} by exception: {1}', dir, util.errorToString(e)));
    if (e.code == 'ENOENT') {
      return [];
    }
    throw e;
  }

  // Get files in the directory
  let bins: string[];
  try {
    bins = (await fs.readdir(dir)).map(f => path.join(dir, f));
  } catch (e) {
    if (e.code == 'EACCESS' || e.code == 'EPERM') {
      return [];
    }
    throw e;
  }

  const prs = await Promise.all(bins.map(b => mapper(b)));
  return dropNulls(prs);
}

/**
 * Scans a directory for compiler binaries.
 * @param dir Directory containing candidate binaries
 * @returns A list of CompilerKits found
 */
export async function scanDirForCompilerKits(dir: string, pr?: ProgressReporter): Promise<Kit[]> {
  const kits = await scanDirectory(dir, async bin => {
    log.trace(localize('checking.file.for.compiler.features', 'Checking file for compiler features: {0}', bin));
    try {
      return await kitIfCompiler(bin, pr);
    } catch (e) {
      log.warning(localize('filed.to.check.binary', 'Failed to check binary {0} by exception: {1}', bin, util.errorToString(e)));
      if (e.code == 'EACCES') {
        // The binary may not be executable by this user...
        return null;
      } else if (e.code == 'ENOENT') {
        // This will happen on Windows if we try to "execute" a directory
        return null;
      } else if (e.code == 'UNKNOWN' && process.platform == 'win32') {
        // This is when file is not executable (in windows)
        return null;
      }
      const stat = await fs.stat(bin);
      log.debug('File infos: ',
                'Mode',
                stat.mode,
                'isFile',
                stat.isFile(),
                'isDirectory',
                stat.isDirectory(),
                'isSymbolicLink',
                stat.isSymbolicLink());
      rollbar.exception(localize('failed.to.scan.kit', 'Failed to scan a kit file'), e, {bin, exception: e.code, stat});
      return null;
    }
  });
  log.debug(localize('founds.kits.in.directory', 'Found {0} kits in directory {1}', kits.length, dir));
  return kits;
}

/**
 * Construct the Kit.visualStudio property (legacy)
 *
 * @param inst The VSInstallation to use
 */
function legacyKitVSName(inst: VSInstallation): string {
  return `VisualStudio.${parseInt(inst.installationVersion)}.0`;
}

/**
 * Construct the Kit.visualStudio property.
 *
 * @param inst The VSInstallation to use
 */
function kitVSName(inst: VSInstallation): string {
  return `${inst.instanceId}`;
}

/**
 * Construct the Visual Studio version string.
 *
 * @param inst The VSInstallation to use
 */
export function vsVersionName(inst: VSInstallation): string {
  if (!inst.catalog) {
    return inst.instanceId;
  }
  const end = inst.catalog.productDisplayVersion.indexOf('[');
  return end < 0 ? inst.catalog.productDisplayVersion : inst.catalog.productDisplayVersion.substring(0, end - 1);
}

/**
 * Construct the display name (this will be paired with an
 * arch later to construct the Kit.name property).
 *
 * @param inst The VSInstallation to use
 */
export function vsDisplayName(inst: VSInstallation): string {
  if (inst.displayName) {
    if (inst.channelId) {
      const index = inst.channelId.lastIndexOf('.');
      if (index > 0) {
        return `${inst.displayName} ${inst.channelId.substr(index + 1)}`;
      }
    }
    return inst.displayName;
  }
  return inst.instanceId;
}

/**
 * Construct the Kit.name property.
 *
 * @param inst The VSInstallation to use
 * @param hostArch The architecture of the toolset host (e.g. x86, x64|amd64)
 * @param targetArch The architecture of the toolset target (e.g. win32|x86, x64|amd64, arm, arm64)
 */
function vsKitName(inst: VSInstallation, hostArch: string, targetArch?: string): string {
  // We still keep the amd64 alias for x64, only in the name of the detected VS kits,
  // for compatibility reasons. Switching to 'x64' means leaving
  // orphaned 'amd64' kits around ("Scan for kits" does not delete them yet)
  // and also it may require a new kit selection.
  // VS toolsets paths on disk, vcvarsall.bat parameters and CMake arguments are all x64 now.
  // We can revise later whether to change to 'x64' in the VS kit name as well and how to mitigate it.
  return `${vsDisplayName(inst)} - ${kitHostTargetArch(hostArch, targetArch, true)}`;
}

/**
 * Create the host-target arch specification of a VS install,
 * from the VS kit architecture (host) and generator platform (target).
 * @param hostArch The architecture of the host toolset
 * @param targetArch The architecture of the target
 * @param amd64Alias Whether amd64 is preferred over x64.
 */
function kitHostTargetArch(hostArch: string, targetArch?: string, amd64Alias: boolean = false): string {
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

  if (!targetArch) {
    targetArch = hostArch;
  }

  // CMake preferred generator platform requires 'win32', while vcvars are still using 'x86'.
  // This function is called only for VS generators, so it is safe to overwrite
  // targetArch with the vcvars naming.
  // In case of any future new mismatches, use the vsArchFromGeneratorPlatform table
  // instead of hard coding for win32 and x86.
  // Currently, there is no need of a similar overwrite operation on hostArch,
  // because CMake host target does not have the same name mismatch with VS.
  targetArch = vsArchFromGeneratorPlatform[targetArch] || targetArch;

  return (hostArch === targetArch) ? hostArch : `${hostArch}_${targetArch}`;
}

/**
 * List of environment variables required for Visual C++ to run as expected for
 * a VS installation.
 */
const MSVC_ENVIRONMENT_VARIABLES = [
  'CL',
  '_CL_',
  'INCLUDE',
  'LIBPATH',
  'LINK',
  '_LINK_',
  'LIB',
  'PATH',
  'TMP',
  'FRAMEWORKDIR',
  'FRAMEWORKDIR64',
  'FRAMEWORKVERSION',
  'FRAMEWORKVERSION64',
  'UCRTCONTEXTROOT',
  'UCRTVERSION',
  'UNIVERSALCRTSDKDIR',
  'VCINSTALLDIR',
  'VCTARGETSPATH',
  'WINDOWSLIBPATH',
  'WINDOWSSDKDIR',
  'WINDOWSSDKLIBVERSION',
  'WINDOWSSDKVERSION',
  'VISUALSTUDIOVERSION'
];

/**
 * Get the environment variables corresponding to a VS dev batch file.
 * @param devbat Path to a VS environment batch file
 * @param args List of arguments to pass to the batch file
 */
async function collectDevBatVars(devbat: string, args: string[], major_version: number, common_dir: string):
    Promise<Map<string, string>|undefined> {
  const fname = Math.random().toString() + '.bat';
  const batfname = `vs-cmt-${fname}`;
  const envfname = batfname + '.env';
  const bat = [
    `@echo off`,
    `cd /d "%~dp0"`,
    `set "VS${major_version}0COMNTOOLS=${common_dir}"`,
    `set "INCLUDE="`,
    `call "${devbat}" ${args.join(' ')}`,
    `cd /d "%~dp0"`, /* Switch back to original drive */
  ];
  for (const envvar of MSVC_ENVIRONMENT_VARIABLES) {
    bat.push(`echo ${envvar} := %${envvar}% >> ${envfname}`);
  }

  // writeFile and unlink don't need quotes (they work just fine with an unquoted path with space)
  // but they might fail sometimes if quotes are present, so remove for now any surrounding quotes
  // that may have been defined by the user (the command prompt experience makes it very likely
  // for the user to use quotes when defining an environment variable with a space containing path).
  let tmpDir: string = paths.tmpDir;
  if (!tmpDir) {
    console.log(`TEMP dir is not set. ${devbat} will not run.`);
    return;
  }

  tmpDir = tmpDir.trim();
  if (tmpDir.startsWith('"') && tmpDir.endsWith('"')) {
    tmpDir = tmpDir.substring(1, tmpDir.length - 1);
  }

  const batpath = path.join(tmpDir, batfname);
  const envpath = path.join(tmpDir, envfname);

  try {
    await fs.unlink(envpath);
  } catch (error) {}

  const batContent = bat.join('\r\n');
  await fs.writeFile(batpath, batContent);

  // Quote the script file path before running it, in case there are spaces.
  const res = await proc.execute(`"${batpath}"`, [], null, { shell: true, silent: true }).result;
  await fs.unlink(batpath);
  const output = (res.stdout) ? res.stdout + (res.stderr || '') : res.stderr;

  let env = '';
  try {
    /* When the bat running failed, envpath would not exist */
    env = await fs.readFile(envpath, {encoding: 'utf8'});
    await fs.unlink(envpath);
  } catch (error) { log.error(error); }

  if (!env || env === '') {
    log.error(localize('script.run.error',
        'Error running:{0} with args:{1}\nOutput are:\n{2}\nBat content are:\n{3}',
        devbat, args.join(' '), output, batContent));
    return;
  }

  const vars
      = env.split('\n').map(l => l.trim()).filter(l => l.length !== 0).reduce<Map<string, string>>((acc, line) => {
          const mat = /(\w+) := ?(.*)/.exec(line);
          if (mat) {
            acc.set(mat[1], mat[2]);
          } else {
            log.error(localize('error.parsing.environment', 'Error parsing environment variable: {0}', line));
          }
          return acc;
        }, new Map());
  if (vars.get('INCLUDE') === '') {
    log.error(localize('script.run.error.check',
        'Error running:{0} with args:{1}\nCannot find INCLUDE within:\n{2}\nBat content are:\n{3}',
        devbat, args.join(' '), env, batContent));
    return;
  }
  log.debug(localize('ok.running', 'OK running {0} {1}, env vars: {2}', devbat, args.join(' '), JSON.stringify([...vars])));
  return vars;
}

/**
 * Gets the environment variables set by a shell script.
 * @param kit The kit to get the environment variables for
 */
export async function getShellScriptEnvironment(kit: Kit, opts?: expand.ExpansionOptions): Promise<Map<string, string>|undefined> {
  console.assert(kit.environmentSetupScript);
  const filename = Math.random().toString() + (process.platform == 'win32' ? '.bat' : '.sh');
  const script_filename = `vs-cmt-${filename}`;
  const environment_filename = script_filename + '.env';

  // writeFile and unlink don't need quotes (they work just fine with an unquoted path with space)
  // but they might fail sometimes if quotes are present, so remove for now any surrounding quotes
  // that may have been defined by the user (the command prompt experience makes it very likely
  // for the user to use quotes when defining an environment variable with a space containing path).
  let tmpDir: string = paths.tmpDir;
  if (!tmpDir) {
    console.log(`TEMP dir is not set. Shell script "${script_filename}" will not run.`);
    return;
  }

  tmpDir = tmpDir.trim();
  if (tmpDir.startsWith('"') && tmpDir.endsWith('"')) {
    tmpDir = tmpDir.substring(1, tmpDir.length - 1);
  }

  const script_path = path.join(tmpDir, script_filename);
  const environment_path = path.join(tmpDir, environment_filename); // path of temp file in which the script writes the env vars to

  let script = '';
  let run_command = '';

  let environmentSetupScript = kit.environmentSetupScript;
  if (opts) {
    environmentSetupScript = await expand.expandString(environmentSetupScript!, opts);
  }

  if (process.platform == 'win32') { // windows
    script += `call "${environmentSetupScript}"\r\n`; // call the user batch script
    script += `set >> "${environment_path}"`; // write env vars to temp file
    // Quote the script file path before running it, in case there are spaces.
    run_command = `call "${script_path}"`;
  } else { // non-windows
    script += `source "${environmentSetupScript}"\n`; // run the user shell script
    script +=`printenv >> ${environment_path}`; // write env vars to temp file
    run_command = `/bin/bash -c "source ${script_path}"`; // run script in bash to enable bash-builtin commands like 'source'
  }
  try {
    await fs.unlink(environment_path); // delete the temp file if it exists
  } catch (error) {}
  await fs.writeFile(script_path, script); // write batch file

  const res = await proc.execute(run_command, [], null, {shell: true, silent: true}).result; // run script
  await fs.unlink(script_path); // delete script file
  const output = (res.stdout) ? res.stdout + (res.stderr || '') : res.stderr;

  let env = '';
  try {
    /* When the script failed, envpath would not exist */
    env = await fs.readFile(environment_path, {encoding: 'utf8'});
    await fs.unlink(environment_path);
  } catch (error) { log.error(error); }
  if (!env || env === '') {
    console.log(`Error running ${kit.environmentSetupScript} with:`, output);
    return;
  }

  // split and trim env vars
  const vars
      = env.split('\n').map(l => l.trim()).filter(l => l.length !== 0).reduce<Map<string, string>>((acc, line) => {
          const match = /(\w+)=?(.*)/.exec(line);
          if (match) {
            acc.set(match[1], match[2]);
          } else {
            log.error(localize('error.parsing.environment', 'Error parsing environment variable: {0}', line));
          }
          return acc;
        }, new Map());
  log.debug(localize('ok.running', 'OK running {0}, env vars: {1}', kit.environmentSetupScript, JSON.stringify([...vars])));
  return vars;
}

/**
 * Platform arguments for VS Generators
 * Currently, there is a mismatch only between x86 and win32.
 * For example, VS kits x86 and amd64_x86 will generate -A win32
 */
const generatorPlatformFromVSArch: {[key: string]: string} = {
  x86: 'win32'
};

// The reverse of generatorPlatformFromVSArch
const vsArchFromGeneratorPlatform: {[key: string]: string} = {
  win32: 'x86'
};

/**
 * Preferred CMake VS generators by VS version
 */
const VsGenerators: {[key: string]: string} = {
  10: 'Visual Studio 10 2010',
  11: 'Visual Studio 11 2012',
  VS120COMNTOOLS: 'Visual Studio 12 2013',
  12: 'Visual Studio 12 2013',
  VS140COMNTOOLS: 'Visual Studio 14 2015',
  14: 'Visual Studio 14 2015',
  15: 'Visual Studio 15 2017',
  16: 'Visual Studio 16 2019'
};

async function varsForVSInstallation(inst: VSInstallation, hostArch: string, targetArch?: string): Promise<Map<string, string>|null> {
  console.log(`varsForVSInstallation path:'${inst.installationPath}' version:${inst.installationVersion} host arch:${hostArch} - target arch:${targetArch}`);
  const common_dir = path.join(inst.installationPath, 'Common7', 'Tools');
  let vcvarsScript: string = 'vcvarsall.bat';
  if (targetArch == "arm" || targetArch == "arm64") {
    // The arm(64) vcvars filename for x64 hosted toolset is using the 'amd64' alias.
    vcvarsScript = `vcvars${kitHostTargetArch(hostArch, targetArch, true)}.bat`;
  }

  let devbat = path.join(inst.installationPath, 'VC', 'Auxiliary', 'Build', vcvarsScript);
  const majorVersion = parseInt(inst.installationVersion);
  if (majorVersion < 15) {
    devbat = path.join(inst.installationPath, 'VC', vcvarsScript);
  }

  // The presence of vcvars[hostArch][targetArch].bat indicates whether targetArch is included
  // in the given VS installation.
  if (!await fs.exists(devbat)) {
    return null;
  }

  const variables = await collectDevBatVars(devbat, [kitHostTargetArch(hostArch, targetArch, majorVersion < 15)], majorVersion, common_dir);
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
    const vs_version = variables.get('VISUALSTUDIOVERSION');
    if (vs_version)
      variables.set(`VS${vs_version.replace('.', '')}COMNTOOLS`, common_dir);

    // For Ninja and Makefile generators, CMake searches for some compilers
    // before it checks for cl.exe. We can force CMake to check cl.exe first by
    // setting the CC and CXX environment variables when we want to do a
    // configure.
    variables.set('CC', 'cl.exe');
    variables.set('CXX', 'cl.exe');

    if (paths.ninjaPath) {
      let envPATH = variables.get('PATH');
      if (undefined !== envPATH) {
        const env_paths = envPATH.split(';');
        const ninja_path = path.dirname(paths.ninjaPath!);
        const ninja_base_path = env_paths.find(path_el => path_el === ninja_path);
        if (undefined === ninja_base_path) {
          envPATH = envPATH.concat(';' + ninja_path);
          variables.set('PATH', envPATH);
        }
      }
    }

    return variables;
  }
}

/**
 * Try to get a VSKit from a VS installation and architecture
 * @param inst A VS installation from vswhere
 * @param hostArch The host architecture
 * @param targetArch The target architecture
 */
async function tryCreateNewVCEnvironment(inst: VSInstallation, hostArch: string, targetArch: string, pr?: ProgressReporter): Promise<Kit|null> {
  const name = vsKitName(inst, hostArch, targetArch);
  log.debug(localize('checking.for.kit', 'Checking for kit: {0}', name));
  if (pr) {
    pr.report({message: localize('checking', 'Checking {0}', name)});
  }
  const variables = await varsForVSInstallation(inst, hostArch, targetArch);
  if (!variables) {
    return null;
  }

  const kit: Kit = {
    name,
    visualStudio: kitVSName(inst),
    visualStudioArchitecture: hostArch
  };

  const version = /^(\d+)+./.exec(inst.installationVersion);
  log.debug(localize('detected.kit.for.version', 'Detected VsKit for version'));
  log.debug(` DisplayName: ${name}`);
  log.debug(` InstanceId: ${inst.instanceId}`);
  log.debug(` InstallVersion: ${inst.installationVersion}`);
  const majorVersion = parseInt(inst.installationVersion);
  if (version) {
    const generatorName: string|undefined = VsGenerators[version[1]];
    const host: string = hostArch.toLowerCase().replace(/ /g, "").startsWith("host=") ? hostArch : "host=" + hostArch;
    if (generatorName) {
      log.debug(` ${localize('generator.present', 'Generator Present: {0}', generatorName)}`);
      kit.preferredGenerator = {
        name: generatorName,
        platform: generatorPlatformFromVSArch[targetArch] as string || targetArch,
        // CMake generator toolsets support also different versions (via -T version=).
        toolset: majorVersion < 15 ? undefined : host
      };
    }
    log.debug(` ${localize('selected.preferred.generator.name', 'Selected Preferred Generator Name: {0} {1}', generatorName, JSON.stringify(kit.preferredGenerator))}`);
  }

  return kit;
}

/**
 * Scans the system for Visual C++ installations using vswhere
 */
export async function scanForVSKits(pr?: ProgressReporter): Promise<Kit[]> {
  const installs = await vsInstallations();
  const prs = installs.map(async(inst): Promise<Kit[]> => {
    const ret = [] as Kit[];
    const hostArches: string[] = ['x86', 'x64'];
    const targetArches: string[] = ['x86', 'x64', 'arm', 'arm64'];

    const sub_prs: Promise<Kit | null>[] = [];
    hostArches.forEach(hostArch => {
      targetArches.forEach(targetArch => {
        const kit: Promise<Kit | null> = tryCreateNewVCEnvironment(inst, hostArch, targetArch, pr);
        if (kit) {
          sub_prs.push(kit);
        }
      });
    });

    const maybe_kits = await Promise.all(sub_prs);
    maybe_kits.map(k => k ? ret.push(k) : null);
    return ret;
});

  const vs_kits = await Promise.all(prs);
  return ([] as Kit[]).concat(...vs_kits);
}

async function scanDirForClangForMSVCKits(dir: string, vsInstalls: VSInstallation[], cmakeTools: CMakeTools | undefined): Promise<Kit[]> {
  const kits = await scanDirectory(dir, async(binPath): Promise<Kit[]|null> => {
    const isClangGNUCLI = (path.basename(binPath, '.exe') === 'clang');
    const isClangCL = (path.basename(binPath, '.exe') === 'clang-cl');
    if (!isClangGNUCLI && !isClangCL) {
      return null;
    }

    const version = await getCompilerVersion('Clang', binPath);
    if (version === null) {
      return null;
    }

    let clang_cli = '(MSVC CLI)';

    // Clang for MSVC ABI with GNU CLI (command line interface) is supported in CMake 3.15.0+
    if (isClangGNUCLI) {
      if (undefined === cmakeTools) {
        log.error("failed.to.scan.for.kits", "Failed to scan for kits:", "cmakeTools is undefined");

        return null;
      } else {
        const cmake_executable = await cmakeTools?.getCMakeExecutable();
        if (undefined === cmake_executable.version) {
          return null;
        } else {
          if (versionLess(cmake_executable.version, '3.15.0')) {
            // Could not find a supported CMake version
            return null;
          }
        }
      }
      // Found a supported CMake version
      clang_cli = '(GNU CLI)';
    }

    const clangKits: Kit[] = [];
    vsInstalls.forEach(vs => {
      const install_name = vsDisplayName(vs);
      const vs_arch = (version.target && version.target.triple.includes('i686-pc')) ? 'x86' : 'amd64';

      const clangArch = (vs_arch === "amd64") ? "x64\\" : "";
      if (binPath.startsWith(`${vs.installationPath}\\VC\\Tools\\Llvm\\${clangArch}bin`) &&
      util.checkFileExists(util.lightNormalizePath(binPath))) {
        clangKits.push({
          name: `Clang ${version.version} ${clang_cli} (${install_name} - ${vs_arch})`,
          visualStudio: kitVSName(vs),
          visualStudioArchitecture: vs_arch,
          compilers: {
            C: binPath,
            CXX: binPath,
          }
        });
      }
    });
    return clangKits;
  });
  return ([] as Kit[]).concat(...kits);
}

export async function scanForClangForMSVCKits(searchPaths: string[], cmakeTools: CMakeTools | undefined): Promise<Promise<Kit[]>[]> {
  const vs_installs = await vsInstallations();
  const results = searchPaths.map(p => scanDirForClangForMSVCKits(p, vs_installs, cmakeTools));
  return results;
}

async function getVSInstallForKit(kit: Kit): Promise<VSInstallation|undefined> {
    if (process.platform !== "win32") {
        return undefined;
    }

    console.assert(kit.visualStudio);
    console.assert(kit.visualStudioArchitecture);

    const installs = await vsInstallations();
    const match = (inst: VSInstallation) =>
        // old Kit format
        (legacyKitVSName(inst) == kit.visualStudio) ||
        // new Kit format
        (kitVSName(inst) === kit.visualStudio) ||
        // Clang for VS kit format
        (!!kit.compilers && kit.name.indexOf("Clang") >= 0 && kit.name.indexOf(vsDisplayName(inst)) >= 0);

    return installs.find(inst => match(inst));
}

export async function getVSKitEnvironment(kit: Kit): Promise<Map<string, string>|null> {
  const requested = await getVSInstallForKit(kit);
  if (!requested) {
    return null;
  }

  return varsForVSInstallation(requested, kit.visualStudioArchitecture!, kit.preferredGenerator?.platform);
}

export async function effectiveKitEnvironment(kit: Kit, opts?: expand.ExpansionOptions): Promise<Map<string, string>> {
  let host_env;
  const kit_env = objectPairs(kit.environmentVariables || {});
  if (opts) {
    for (const env_var of kit_env) {
      env_var[1] = await expand.expandString(env_var[1], opts);
    }
  }
  if (kit.environmentSetupScript) {
    const shell_vars = await getShellScriptEnvironment(kit, opts);
    if (shell_vars) {
      host_env = util.map(shell_vars, ([k, v]): [string, string] => [k.toLocaleUpperCase(), v]) as [string, string][];
    }
  }
  if (host_env === undefined) {
    // get host_env from process if it was not set by shell script before
    host_env = objectPairs(process.env) as [string, string][];
  }
  if (kit.visualStudio && kit.visualStudioArchitecture) {
    const vs_vars = await getVSKitEnvironment(kit);
    if (vs_vars) {
      return new Map(
          util.map(util.chain(host_env, kit_env, vs_vars), ([k, v]): [string, string] => [k.toLocaleUpperCase(), v]));
    }
  }
  const env = new Map(util.chain(host_env, kit_env));
  const isWin32 = process.platform === 'win32';
  if (isWin32)
  {
    const path_list: string[] = [];
    const cCompiler = kit.compilers?.C;
    /* Force add the compiler executable dir to the PATH env */
    if (cCompiler) {
      path_list.push(path.dirname(cCompiler));
    }
    const cmt_mingw_path = env.get("CMT_MINGW_PATH");
    if (cmt_mingw_path) {
      path_list.push(cmt_mingw_path);
    }
    let path_key : string | undefined = undefined;
    if (env.has("PATH")) {
      path_key = "PATH";
    } else if (env.has("Path")) {
      path_key = "Path";
    }
    if (path_key) {
      path_list.unshift(env.get(path_key) ?? '');
      env.set(path_key, path_list.join(';'));
    }
  }
  return env;
}

export async function findCLCompilerPath(env: Map<string, string>): Promise<string|null> {
  const path_var = util.find(env.entries(), ([key, _val]) => key.toLocaleLowerCase() === 'path');
  if (!path_var) {
    return null;
  }
  const path_ext_var = util.find(env.entries(), ([key, _val]) => key.toLocaleLowerCase() === 'pathext');
  if (!path_ext_var) {
    return null;
  }
  const path_val = path_var[1];
  const path_ext = path_ext_var[1];
  for (const dir of path_val.split(';')) {
    for (const ext of path_ext.split(';')) {
      const fname = `cl${ext}`;
      const testpath = path.join(dir, fname);
      const stat = await fs.tryStat(testpath);
      if (stat && !stat.isDirectory()) {
        return testpath;
      }
    }
  }
  return null;
}

export interface KitScanOptions {
  scanDirs?: string[];
  minGWSearchDirs?: string[];
}

/**
 * Search for Kits available on the platform.
 * @returns A list of Kits.
 */
export async function scanForKits(cmakeTools: CMakeTools | undefined, opt?: KitScanOptions) {
  const kit_options = opt || {};

  log.debug(localize('scanning.for.kits.on.system', 'Scanning for Kits on system'));
  const prog = {
    location: vscode.ProgressLocation.Notification,
    title: localize('scanning.for.kits', 'Scanning for kits'),
  };

  return vscode.window.withProgress(prog, async pr => {
    const isWin32 = process.platform === 'win32';

    pr.report({message: localize('scanning.for.cmake.kits', 'Scanning for CMake kits...')});

    const scan_paths = new Set<string>();

    // Search directories on `PATH` for compiler binaries
    if (process.env.hasOwnProperty('PATH')) {
      const sep = isWin32 ? ';' : ':';
      for (const dir of (process.env.PATH as string).split(sep)) {
        scan_paths.add(dir);
      }
    }

    // Search them all in parallel
    let kit_promises = [] as Promise<Kit[]>[];
    if (isWin32 && kit_options.minGWSearchDirs) {
      for (const dir of convertMingwDirsToSearchPaths(kit_options.minGWSearchDirs)) {
        scan_paths.add(dir);
      }
    }

    // Default installation locations
    scan_paths.add(paths.windows.ProgramFilesX86! + '\\LLVM\\bin');
    scan_paths.add(paths.windows.ProgramFiles! + '\\LLVM\\bin');
    const compiler_kits = Array.from(scan_paths).map(path_el => scanDirForCompilerKits(path_el, pr));
    kit_promises = kit_promises.concat(compiler_kits);

    if (isWin32) {
      // Prepare clang-cl search paths
      const clang_paths = new Set<string>();

      // LLVM_ROOT environment variable location
      if (process.env.hasOwnProperty('LLVM_ROOT')) {
        const llvm_root = path.normalize(process.env.LLVM_ROOT as string + "\\bin");
        clang_paths.add(llvm_root);
      }

      // Default installation locations
      clang_paths.add(paths.windows.ProgramFiles! + '\\LLVM\\bin');
      clang_paths.add(paths.windows.ProgramFilesX86! + '\\LLVM\\bin');

      // PATH environment variable locations
      scan_paths.forEach(path_el => clang_paths.add(path_el));
      // LLVM bundled in VS locations
      const vs_installs = await vsInstallations();
      const bundled_clang_paths: string[] = [];
      vs_installs.forEach(vs_install => {
        bundled_clang_paths.push(vs_install.installationPath + "\\VC\\Tools\\Llvm\\bin");
        bundled_clang_paths.push(vs_install.installationPath + "\\VC\\Tools\\Llvm\\x64\\bin");
      });
      bundled_clang_paths.forEach(path_el => {clang_paths.add(path_el);});

      // Scan for kits
      const vs_kits = scanForVSKits(pr);
      kit_promises.push(vs_kits);
      const clang_kits = await scanForClangForMSVCKits(Array.from(clang_paths), cmakeTools);
      kit_promises = kit_promises.concat(clang_kits);
    }

    const arrays = await Promise.all(kit_promises);
    const kits = ([] as Kit[]).concat(...arrays);
    kits.map(k => log.info(localize('found.kit', 'Found Kit: {0}', k.name)));

    return kits;
  });
}

// Rescan if the kits versions (extension context state var versus value defined for this release) don't match.
export async function scanForKitsIfNeeded(cmt: CMakeTools) : Promise<boolean> {
  const kitsVersionSaved = cmt.extensionContext.globalState.get<number>('kitsVersionSaved');
  const kitsVersionCurrent = 2;

  // Scan also when there is no kits version saved in the state.
  if ((!kitsVersionSaved || kitsVersionSaved !== kitsVersionCurrent) &&
       process.env['CMT_TESTING'] !== '1' && !kitsController.KitsController.isScanningForKits()) {
    log.info(localize('silent.kits.rescan', 'Detected kits definition version change from {0} to {1}. Silently scanning for kits.', kitsVersionSaved, kitsVersionCurrent));
    await kitsController.KitsController.scanForKits(cmt);
    cmt.extensionContext.globalState.update('kitsVersionSaved', kitsVersionCurrent);
    return true;
  }

  return false;
}

/**
 * Generates a string description of a kit. This is shown to the user.
 * @param kit The kit to generate a description for
 */
export async function descriptionForKit(kit: Kit): Promise<string> {
  if (kit.toolchainFile) {
    return localize('kit.for.toolchain.file', 'Kit for toolchain file {0}', kit.toolchainFile);
  }
  if (kit.visualStudio) {
    const vs_install = await getVSInstallForKit(kit);
    if (vs_install) {
      if (kit.compilers) {
        // Clang for MSVC
        const compilers = Object.keys(kit.compilers).map(k => `${k} = ${kit.compilers![k]}`);
        return localize('using.compilers', 'Using compilers: {0}', compilers.join(', '));
      } else {
        // MSVC
        const hostTargetArch = kitHostTargetArch(kit.visualStudioArchitecture!, kit.preferredGenerator?.platform);
        return localize('using.compilers.for', 'Using compilers for {0} ({1} architecture)', vsVersionName(vs_install), hostTargetArch);
      }
    }
    return '';
  }
  if (kit.compilers) {
    const compilers = Object.keys(kit.compilers).map(k => `${k} = ${kit.compilers![k]}`);
    return localize('using.compilers', 'Using compilers: {0}', compilers.join(', '));
  }
  if (kit.name === SpecialKits.ScanForKits) {
    return localize('search.for.compilers', 'Search for compilers on this computer');
  }
  return localize('unspecified.let.cmake.guess', 'Unspecified (Let CMake guess what compilers and environment to use)');
}

async function expandKitVariables(kit: Kit): Promise<Kit> {
  if (kit.toolchainFile) {
    kit.toolchainFile = await expand.expandString(kit.toolchainFile, {
      vars: {
        buildKit: kit.name,
        buildType: '${buildType}',  // Unsupported variable substitutions use identity.
        buildKitVendor: '${buildKitVendor}',
        buildKitTriple: '${buildKitTriple}',
        buildKitVersion: '${buildKitVersion}',
        buildKitHostOs: '${buildKitVendor}',
        buildKitTargetOs: '${buildKitTargetOs}',
        buildKitTargetArch: '${buildKitTargetArch}',
        buildKitVersionMajor: '${buildKitVersionMajor}',
        buildKitVersionMinor: '${buildKitVersionMinor}',
        generator: '${generator}',
        userHome: paths.userHome,
        workspaceFolder: '${workspaceFolder}',
        workspaceFolderBasename: '${workspaceFolderBasename}',
        workspaceHash: '${workspaceHash}',
        workspaceRoot: '${workspaceRoot}',
        workspaceRootFolderName: '${workspaceRootFolderName}'
      }
    });
  }
  return kit;
}

export async function readKitsFile(filepath: string): Promise<Kit[]> {
  if (!await fs.exists(filepath)) {
    log.debug(localize('not.reading.nonexistent.kit', 'Not reading non-existent kits file: {0}', filepath));
    return [];
  }
  log.debug(localize('reading.kits.file', 'Reading kits file {0}', filepath));
  const content_str = await fs.readFile(filepath);
  let kits_raw: object[] = [];
  try {
    kits_raw = json5.parse(content_str.toLocaleString());
  } catch (e) {
    log.error(localize('failed.to.parse', 'Failed to parse {0}: {1}', path.basename(filepath), util.errorToString(e)));
    return [];
  }
  const validator = await loadSchema('schemas/kits-schema.json');
  const is_valid = validator(kits_raw);
  if (!is_valid) {
    const errors = validator.errors!;
    log.error(localize('invalid.file.error', 'Invalid kit contents {0} ({1}):', path.basename(filepath), filepath));
    for (const err of errors) {
      log.error(` >> ${err.dataPath}: ${err.message}`);
    }
    return [];
  }
  const kits = kits_raw as Kit[];
  log.info(localize('successfully.loaded.kits', 'Successfully loaded {0} kits from {1}', kits.length, filepath));
  return Promise.all(dropNulls(kits).map(expandKitVariables));
}

function convertMingwDirsToSearchPaths(mingwDirs: string[]): string[] {
  return mingwDirs.map(mingwDir => path.join(mingwDir, 'bin'));
}

/**
 * Get the path to a workspace-specific cmake-kits.json for a given worksapce directory
 * @param dirPath The directory of a workspace
 */
export function kitsPathForWorkspaceDirectoryPath(dirPath: string): string {
  return path.join(dirPath, '.vscode/cmake-kits.json');
}

/**
 * Get the path to the workspace-specific cmake-kits.json for a given WorkspaceFolder object
 * @param ws The workspace folder
 */
export function kitsPathForWorkspaceFolder(ws: vscode.WorkspaceFolder): string {
  return kitsPathForWorkspaceDirectoryPath(ws.uri.fsPath);
}

/**
 * Get the kits declared for the given workspace directory. Looks in `.vscode/cmake-kits.json`.
 * @param dirPath The path to a VSCode workspace directory
 */
export function kitsForWorkspaceDirectory(dirPath: string): Promise<Kit[]> {
  const ws_kits_file = path.join(dirPath, '.vscode/cmake-kits.json');
  return readKitsFile(ws_kits_file);
}

/**
 * Get the kits defined by the user in the files pointed by "cmake.additionalKits".
 */
export async function getAdditionalKits(cmakeTools: CMakeTools): Promise<Kit[]> {
  const additionalKitFiles = await kitsController.KitsController.expandAdditionalKitFiles(cmakeTools);
  let additionalKits: Kit[] = [];
  for (const kitFile of additionalKitFiles) {
    additionalKits = additionalKits.concat(await readKitsFile(kitFile));
  }

  return additionalKits;
}

export function kitChangeNeedsClean(newKit: Kit, oldKit: Kit|null): boolean {
  if (!oldKit) {
    // First kit? We never clean
    log.debug(localize('clean.not.needed', 'Clean not needed: No prior Kit selected'));
    return false;
  }
  const important_params = (k: Kit) => ({
    compilers: k.compilers,
    vs: k.visualStudio,
    vsArch: k.visualStudioArchitecture,
    tc: k.toolchainFile,
    preferredGenerator: k.preferredGenerator ? k.preferredGenerator.name : null
  });
  const new_imp = important_params(newKit);
  const old_imp = important_params(oldKit);
  if (compare(new_imp, old_imp) != Ordering.Equivalent) {
    log.debug(localize('clean.needed', 'Need clean: Kit changed'));
    return true;
  } else {
    return false;
  }
}
