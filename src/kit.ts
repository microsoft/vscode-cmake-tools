/**
 * Module for controlling and working with Kits.
 */ /** */

import rollbar from '@cmt/rollbar';
import * as util from '@cmt/util';
import * as json5 from 'json5';
import * as path from 'path';
import * as vscode from 'vscode';

import * as logging from './logging';
import paths from './paths';
import {fs} from './pr';
import * as proc from './proc';
import {loadSchema} from './schema';
import {compare, dropNulls, objectPairs, Ordering, thisExtensionPath} from './util';

const log = logging.createLogger('kit');

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

export interface Kit {
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
   * The visual studio name. This corresponds to a name returned by `vswhere`,
   * and is used to look up the path to the VS installation when the user
   * selects this kit
   */
  visualStudio?: string;

  /**
   * The architecture for the kit. This is used when asking for the architecture
   * from the dev environment batch file.
   */
  visualStudioArchitecture?: string;

  /**
   * Path to a CMake toolchain file.
   */
  toolchainFile?: string;

  /**
   * If `true`, keep this kit around even if it seems out-of-date
   */
  keep?: boolean;
}

interface ClangVersion {
  fullVersion: string;
  version: string;
  target?: string;
  threadModel?: string;
  installedDir?: string;
}

async function getClangVersion(binPath: string): Promise<ClangVersion|null> {
  log.debug('Testing Clang-ish binary:', binPath);
  const exec = await proc.execute(binPath, ['-v']).result;
  if (exec.retc != 0) {
    log.debug('Bad Clang binary ("-v" returns non-zero)', binPath);
    return null;
  }
  const first_line = exec.stderr.split('\n')[0];
  const version_re = /^(?:Apple LLVM|clang) version (.*?)[ -]/;
  const version_match = version_re.exec(first_line);
  if (version_match === null) {
    log.debug('Bad Clang binary', binPath, '-v output:', exec.stderr);
    return null;
  }
  const version = version_match[1];
  const target_mat = /Target:\s+(.*)/.exec(exec.stderr);
  let target: string|undefined;
  if (target_mat) {
    target = target_mat[1];
  }
  const thread_model_mat = /Thread model:\s+(.*)/.exec(exec.stderr);
  let threadModel: string|undefined;
  if (thread_model_mat) {
    threadModel = thread_model_mat[1];
  }
  const install_dir_mat = /InstalledDir:\s+(.*)/.exec(exec.stderr);
  let installedDir: string|undefined;
  if (install_dir_mat) {
    installedDir = install_dir_mat[1];
  }
  return {
    fullVersion: first_line,
    version,
    target,
    threadModel,
    installedDir,
  };
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
    log.debug('Testing GCC-ish binary:', bin);
    if (pr)
      pr.report({message: `Getting GCC version for ${bin}`});
    const exec = await proc.execute(bin, ['-v']).result;
    if (exec.retc != 0) {
      log.debug('Bad GCC binary ("-v" returns non-zero)', bin);
      return null;
    }
    const last_line = exec.stderr.trim().split('\n').reverse()[0];
    const version_re = /^gcc version (.*?) .*/;
    const version_match = version_re.exec(last_line);
    if (version_match === null) {
      log.debug('Bad GCC binary', bin, '-v output:', exec.stderr);
      return null;
    }
    const version = version_match[1];
    const gxx_fname = fname.replace(/gcc/, 'g++');
    const gxx_bin = path.join(path.dirname(bin), gxx_fname);
    const target_triple_re = /((\w+-)+)gcc.*/;
    const target_triple_match = target_triple_re.exec(fname);
    let description = '';
    if (target_triple_match !== null) {
      description += `for ${target_triple_match[1].slice(0, -1)} `;
    }
    const name = `GCC ${description}${version}`;
    log.debug('Detected GCC compiler:', bin);
    if (await fs.exists(gxx_bin)) {
      return {
        name,
        compilers: {
          CXX: gxx_bin,
          C: bin,
        }
      };
    } else {
      return {
        name,
        compilers: {
          C: bin,
        }
      };
    }
  } else if (clang_res) {
    log.debug('Testing Clang-ish binary:', bin);
    if (pr)
      pr.report({message: `Getting Clang version for ${bin}`});
    const version = await getClangVersion(bin);
    if (version === null) {
      return null;
    }
    if (version.target && version.target.includes('msvc')) {
      // DO NOT include Clang's that target MSVC but don't present the MSVC
      // command-line interface. CMake does not support them properly.
      return null;
    }
    const clangxx_fname = fname.replace(/^clang/, 'clang++');
    const clangxx_bin = path.join(path.dirname(bin), clangxx_fname);
    const name = `Clang ${version.version}`;
    log.debug('Detected Clang compiler:', bin);
    if (await fs.exists(clangxx_bin)) {
      return {
        name,
        compilers: {
          C: bin,
          CXX: clangxx_bin,
        },
      };
    } else {
      return {
        name,
        compilers: {
          C: bin,
        },
      };
    }
  } else {
    return null;
  }
}

async function scanDirectory<Ret>(dir: string, mapper: (filePath: string) => Promise<Ret|null>): Promise<Ret[]> {
  if (!await fs.exists(dir)) {
    log.debug('Skipping scan of not existing path', dir);
    return [];
  }

  log.debug('Scanning directory', dir, 'for compilers');
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      console.log('Skipping scan of non-directory', dir);
      return [];
    }
  } catch (e) {
    log.warning('Failed to scan', dir, 'by exception:', e);
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
    log.trace('Checking file for compiler-ness:', bin);
    try {
      return await kitIfCompiler(bin, pr);
    } catch (e) {
      log.warning('Failed to check binary', bin, 'by exception:', e);
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
      rollbar.exception('Failed to scan a kit file', e, {bin, exception: e.code, stat});
      return null;
    }
  });
  log.debug('Found', kits.length, 'kits in directory', dir);
  return kits;
}

/**
 * Description of a Visual Studio installation returned by vswhere.exe
 *
 * This isn't _all_ the properties, just the ones we need so far.
 */
export interface VSInstallation {
  instanceId: string;
  displayName?: string;
  installationPath: string;
  installationVersion: string;
  description: string;
  isPrerelease: boolean;
}

/**
 * Get a list of all Visual Studio installations available from vswhere.exe
 *
 * Will not include older versions. vswhere doesn't seem to list them?
 */
export async function vsInstallations(): Promise<VSInstallation[]> {
  const installs = [] as VSInstallation[];
  const inst_ids = [] as string[];
  const vswhere_exe = path.join(thisExtensionPath(), 'res', 'vswhere.exe');
  const sys32_path = path.join(process.env.WINDIR as string, 'System32');

  const vswhere_args =
      ['/c', `${sys32_path}\\chcp 65001>nul && "${vswhere_exe}" -all -format json -products * -legacy -prerelease`];
  const vswhere_res
      = await proc.execute(`${sys32_path}\\cmd.exe`, vswhere_args, null, {silent: true, encoding: 'utf8', shell: true})
            .result;

  if (vswhere_res.retc !== 0) {
    log.error('Failed to execute vswhere.exe:', vswhere_res.stderr);
    return [];
  }

  const vs_installs = JSON.parse(vswhere_res.stdout) as VSInstallation[];
  for (const inst of vs_installs) {
    const majorVersion = parseInt(inst.installationVersion);
      if (majorVersion >= 15) {
      inst.instanceId = `VisualStudio.${majorVersion}.0`;
    }
    if (inst_ids.indexOf(inst.instanceId) < 0) {
      installs.push(inst);
      inst_ids.push(inst.instanceId);
    }
  }
  return installs;
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
async function collectDevBatVars(devbat: string, args: string[]): Promise<Map<string, string>|undefined> {
  const bat = [
    `@echo off`,
    `call "${devbat}" ${args.join(' ')} || exit`,
  ];
  for (const envvar of MSVC_ENVIRONMENT_VARIABLES) {
    bat.push(`echo ${envvar} := %${envvar}%`);
  }
  const fname = Math.random().toString() + '.bat';
  const batpath = path.join(paths.tmpDir, `vs-cmt-${fname}`);
  await fs.writeFile(batpath, bat.join('\r\n'));
  const res = await proc.execute(batpath, [], null, {shell: true, silent: true}).result;
  await fs.unlink(batpath);
  const output = (res.stdout) ? res.stdout : res.stderr;

  if (res.retc !== 0) {
    if (output.includes('Invalid host architecture') || output.includes('Error in script usage'))
      return;

    console.log(`Error running ${devbat}`, output);
    return;
  }

  if (!output) {
    console.log(`Environment detection for using ${devbat} failed`);
    return;
  }

  const vars
      = output.split('\n').map(l => l.trim()).filter(l => l.length !== 0).reduce<Map<string, string>>((acc, line) => {
          const mat = /(\w+) := ?(.*)/.exec(line);
          if (mat) {
            acc.set(mat[1], mat[2]);
          } else {
            log.error(`Error parsing environment variable: ${line}`);
          }
          return acc;
        }, new Map());

  return vars;
}

/**
 * Platform arguments for VS Generators
 */
const VsArchitectures: {[key: string]: string} = {
  amd64: 'x64',
  arm: 'ARM',
  amd64_arm: 'ARM',
};

/**
 * Preferred CMake VS generators by VS version
 */
const VsGenerators: {[key: string]: string} = {
  11: 'Visual Studio 11 2012',
  VS120COMNTOOLS: 'Visual Studio 12 2013',
  12: 'Visual Studio 12 2013',
  VS140COMNTOOLS: 'Visual Studio 14 2015',
  14: 'Visual Studio 14 2015',
  15: 'Visual Studio 15 2017'
};

async function varsForVSInstallation(inst: VSInstallation, arch: string): Promise<Map<string, string>|null> {
  const common_dir = path.join(inst.installationPath, 'Common7', 'Tools');
  const devbat = path.join(common_dir, 'VsDevCmd.bat');
  const variables = await collectDevBatVars(devbat, ['-no_logo', `-arch=${arch}`]);
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
    return variables;
  }
}

/**
 * Try to get a VSKit from a VS installation and architecture
 * @param inst A VS installation from vswhere
 * @param arch The architecture to try
 */
async function tryCreateNewVCEnvironment(inst: VSInstallation, arch: string, pr?: ProgressReporter): Promise<Kit|null> {
  const realDisplayName: string|undefined
      = inst.displayName ? inst.isPrerelease ? `${inst.displayName} Preview` : inst.displayName : undefined;
  const installName = realDisplayName || inst.instanceId;
  const name = `${installName} - ${arch}`;
  log.debug('Checking for kit: ' + name);
  if (pr) {
    pr.report({message: `Checking ${installName} with ${arch}`});
  }
  const variables = await varsForVSInstallation(inst, arch);
  if (!variables)
    return null;

  const kit: Kit = {
    name,
    visualStudio: inst.instanceId,
    visualStudioArchitecture: arch,
  };

  const version = /^(\d+)+./.exec(inst.installationVersion);
  log.debug('Detected VsKit for version');
  log.debug(` DisplayName: ${realDisplayName}`);
  log.debug(` InstanceId: ${inst.instanceId}`);
  log.debug(` InstallVersion: ${inst.installationVersion}`);
  if (version) {
    const generatorName: string|undefined = VsGenerators[version[1]];
    if (generatorName) {
      log.debug(` Generator Present: ${generatorName}`);
      kit.preferredGenerator = {
        name: generatorName,
        platform: VsArchitectures[arch] as string || undefined,
      };
    }
    log.debug(` Selected Preferred Generator Name: ${generatorName}`);
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
    const arches = ['x86', 'amd64', 'x86_amd64', 'x86_arm', 'amd64_arm', 'amd64_x86'];
    const sub_prs = arches.map(arch => tryCreateNewVCEnvironment(inst, arch, pr));
    const maybe_kits = await Promise.all(sub_prs);
    maybe_kits.map(k => k ? ret.push(k) : null);
    return ret;
  });
  const vs_kits = await Promise.all(prs);
  return ([] as Kit[]).concat(...vs_kits);
}

async function scanDirForClangCLKits(dir: string, vsInstalls: VSInstallation[]): Promise<Kit[]> {
  const kits = await scanDirectory(dir, async(binPath): Promise<Kit[]|null> => {
    if (!path.basename(binPath).startsWith('clang-cl')) {
      return null;
    }
    const version = await getClangVersion(binPath);
    if (version === null) {
      return null;
    }
    return vsInstalls.map((vs): Kit => {
      const realDisplayName: string|undefined
          = vs.displayName ? vs.isPrerelease ? `${vs.displayName} Preview` : vs.displayName : undefined;
      const installName = realDisplayName || vs.instanceId;
      const vs_arch = (version.target && version.target.includes('i686-pc')) ? 'x86' : 'amd64';
      return {
        name: `Clang ${version.version} for MSVC with ${installName} (${vs_arch})`,
        visualStudio: vs.instanceId,
        visualStudioArchitecture: vs_arch,
        compilers: {
          C: binPath,
          CXX: binPath,
        },
      };
    });
  });
  return ([] as Kit[]).concat(...kits);
}

export async function scanForClangCLKits(searchPaths: string[]): Promise<Promise<Kit[]>[]> {
  const vs_installs = await vsInstallations();
  const results = searchPaths.map(p => scanDirForClangCLKits(p, vs_installs));
  return results;
}

export async function getVSKitEnvironment(kit: Kit): Promise<Map<string, string>|null> {
  console.assert(kit.visualStudio);
  console.assert(kit.visualStudioArchitecture);
  const installs = await vsInstallations();
  const requested = installs.find(inst => inst.instanceId == kit.visualStudio);
  if (!requested) {
    return null;
  }
  return varsForVSInstallation(requested, kit.visualStudioArchitecture!);
}

export async function effectiveKitEnvironment(kit: Kit): Promise<Map<string, string>> {
  const host_env = objectPairs(process.env) as [string, string][];
  const kit_env = objectPairs(kit.environmentVariables || {}) as [string, string][];
  if (kit.visualStudio && kit.visualStudioArchitecture) {
    const vs_vars = await getVSKitEnvironment(kit);
    if (vs_vars) {
      return new Map(util.map(util.chain(host_env, kit_env, vs_vars), ([k, v]): [string, string] => [k.toLocaleUpperCase(), v]));
    }
  }
  return new Map(util.chain(host_env, kit_env));
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
export async function scanForKits(opt?: KitScanOptions) {
  if (opt === undefined) {
    opt = {};
  }
  const in_scan_dirs = opt.scanDirs;
  let scan_dirs: string[];
  if (in_scan_dirs !== undefined) {
    scan_dirs = in_scan_dirs;
  } else {
    const env_path = process.env['PATH'] || '';
    const isWin32 = process.platform === 'win32';
    const sep = isWin32 ? ';' : ':';
    let env_elems = env_path.split(sep);
    if (env_elems.length === 1 && env_elems[0] === '') {
      env_elems = [];
    }
    scan_dirs = env_elems;
  }
  if (opt.minGWSearchDirs) {
    scan_dirs = scan_dirs.concat(convertMingwDirsToSearchPaths(opt.minGWSearchDirs));
  }
  log.debug('Scanning for Kits on system');
  const prog = {
    location: vscode.ProgressLocation.Notification,
    title: 'Scanning for kits',
  };
  return vscode.window.withProgress(prog, async pr => {
    const isWin32 = process.platform === 'win32';
    pr.report({message: 'Scanning for CMake kits...'});
    let scanPaths: string[] = [];
    // Search directories on `PATH` for compiler binaries
    const pathvar = process.env['PATH']!;
    if (pathvar) {
      const sep = isWin32 ? ';' : ':';
      scanPaths = scanPaths.concat(pathvar.split(sep));
    }

    if (scanPaths) {
      // Search them all in parallel
      let prs = [] as Promise<Kit[]>[];
      const compiler_kits = scanPaths.map(path_el => scanDirForCompilerKits(path_el, pr));
      prs = prs.concat(compiler_kits);
      if (isWin32) {
        const vs_kits = scanForVSKits(pr);
        const clang_cl_path = ['C:\\Program Files (x86)\\LLVM\\bin', 'C:\\Program Files\\LLVM\\bin', ...scanPaths];
        const clang_cl_kits = await scanForClangCLKits(clang_cl_path);
        prs.push(vs_kits);
        prs = prs.concat(clang_cl_kits);
      }
      const arrays = await Promise.all(prs);
      const kits = ([] as Kit[]).concat(...arrays);
      kits.map(k => log.info(`Found Kit: ${k.name}`));
      return kits;
    } else {
      log.info(`Path variable empty`);
      return [];
    }
  });
}

/**
 * Generates a string description of a kit. This is shown to the user.
 * @param kit The kit to generate a description for
 */
export function descriptionForKit(kit: Kit) {
  if (kit.toolchainFile) {
    return `Kit for toolchain file ${kit.toolchainFile}`;
  }
  if (kit.visualStudio) {
    return `Using compilers for ${kit.visualStudio} (${kit.visualStudioArchitecture} architecture)`;
  }
  if (kit.compilers) {
    const compilers = Object.keys(kit.compilers).map(k => `${k} = ${kit.compilers![k]}`);
    return `Using compilers: ${compilers.join(', ')}`;
  }
  return 'Unspecified (Let CMake guess what compilers and environment to use)';
}

export async function readKitsFile(filepath: string): Promise<Kit[]> {
  if (!await fs.exists(filepath)) {
    log.debug(`Not reading non-existent kits file: ${filepath}`);
    return [];
  }
  log.debug('Reading kits file', filepath);
  const content_str = await fs.readFile(filepath);
  let kits_raw: object[] = [];
  try {
    kits_raw = json5.parse(content_str.toLocaleString());
  } catch (e) {
    log.error('Failed to parse cmake-kits.json:', e);
    return [];
  }
  const validator = await loadSchema('schemas/kits-schema.json');
  const is_valid = validator(kits_raw);
  if (!is_valid) {
    const errors = validator.errors!;
    log.error(`Invalid cmake-kits.json (${filepath}):`);
    for (const err of errors) {
      log.error(` >> ${err.dataPath}: ${err.message}`);
    }
    return [];
  }
  const kits = kits_raw as Kit[];
  log.info(`Successfully loaded ${kits.length} kits from ${filepath}`);
  return dropNulls(kits);
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
 * Get the kits available for a given workspace directory. Differs from
 * `kitsForWorkspaceDirectory` in that it also returns kits declared in the
 * user-local kits file.
 * @param dirPath The path to a VSCode workspace directory
 */
export async function kitsAvailableInWorkspaceDirectory(dirPath: string): Promise<Kit[]> {
  const user_kits_pr = readKitsFile(USER_KITS_FILEPATH);
  const ws_kits_pr = kitsForWorkspaceDirectory(dirPath);
  return Promise.all([user_kits_pr, ws_kits_pr]).then(([user_kits, ws_kits]) => user_kits.concat(ws_kits));
}

export function kitChangeNeedsClean(newKit: Kit, oldKit: Kit|null): boolean {
  if (!oldKit) {
    // First kit? We never clean
    log.debug('Clean not needed: No prior Kit selected');
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
    log.debug('Need clean: Kit changed');
    return true;
  } else {
    return false;
  }
}
