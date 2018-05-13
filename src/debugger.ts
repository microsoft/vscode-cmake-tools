import {ExecutableTarget} from '@cmt/api';
import {CMakeCache} from '@cmt/cache';
import * as proc from '@cmt/proc';


export enum DebuggerType {
  VISUALSTUDIO = 'Visual Studio',
  LLDB = 'LLDB',
  GDB = 'GDB',
  // LAUNCH // Future
}

/**
 * Describes configuration options for debugger in kit
 */
export interface DebuggerConfiguration {
  /**
   * Identifier of the type to launch
   */
  type: DebuggerType;

  /**
   * Path to gdb or lldb executable.
   */
  debuggerPath?: string;

  /**
   * Name of a existing launch configuration
   */
  // launchConfiguration?: string;  // Future
}


export interface Configuration {
  type: string;
  name: string;
  request: string;
  [key: string]: any;
}

async function createGDBDebugConfiguration(debuggerPath: string, target: ExecutableTarget): Promise<Configuration> {
  if (!await checkDebugger(debuggerPath)) {
    debuggerPath = 'gdb';
    if (!await checkDebugger(debuggerPath)) {
      throw new Error(`Unable to find GDB in default search path and ${debuggerPath}.`);
    }
  }

  return {
    type: 'cppdbg',
    name: `Debug ${target.name}`,
    request: 'launch',
    cwd: '${workspaceRoot}',
    args: [],
    MIMode: 'gdb',
    miDebuggerPath: debuggerPath,
    setupCommands: [
      {
        description: 'Enable pretty-printing for gdb',
        text: '-enable-pretty-printing',
        ignoreFailures: true,
      },
    ],
    program: target.path
  };
}

async function createLLDBDebugConfiguration(debuggerPath: string, target: ExecutableTarget): Promise<Configuration> {
  return {
    type: 'cppdbg',
    name: `Debug ${target.name}`,
    request: 'launch',
    cwd: '${workspaceRoot}',
    args: [],
    MIMode: 'lldb',
    miDebuggerPath: debuggerPath,
    program: target.path
  };
}

function createMSVCDebugConfiguration(target: ExecutableTarget): Configuration {
  return {
    type: 'cppvsdbg',
    name: `Debug ${target.name}`,
    request: 'launch',
    cwd: '${workspaceRoot}',
    args: [],
    program: target.path
  };
}

const possible_debuggers: {
  [debugger_name: string]:
      {mi_mode: string, config_factory: (debugger_path: string, target: ExecutableTarget) => Promise<Configuration>}
}
= {
    gdb: {mi_mode: 'gdb', config_factory: createGDBDebugConfiguration},
    lldb: {mi_mode: 'lldb', config_factory: createLLDBDebugConfiguration}
  };

function searchForCompilerPathInCache(cache: CMakeCache): string|null {
  const languages = ['CXX', 'C', 'CUDA'];
  for (const lang of languages) {
    const entry = cache.get(`CMAKE_${lang}_COMPILER`);
    if (!entry) {
      continue;
    }
    return entry.value as string;
  }
  return null;
}


export async function getDebugConfigurationFromCache(cache: CMakeCache, target: ExecutableTarget, platform: string):
    Promise<Configuration> {
  const entry = cache.get('CMAKE_LINKER');
  if (entry !== null) {
    const linker = entry.value as string;
    const is_msvc_linker = linker.endsWith('link.exe');
    if (is_msvc_linker) {
      return createMSVCDebugConfiguration(target);
    }
  }

  const compiler_path = searchForCompilerPathInCache(cache);
  if (compiler_path === null) {
    throw Error('No compiler found in cache file.');  // MSVC should be already found by CMAKE_LINKER
  }

  const clang_compiler_regex = /(clang[\+]{0,2})+(?!-cl)/gi;
  let clang_debugger_path = compiler_path.replace(clang_compiler_regex, 'lldb');
  if ((clang_debugger_path.search(new RegExp('lldb')) != -1) && await checkDebugger(clang_debugger_path)) {
    return createLLDBDebugConfiguration(clang_debugger_path, target);
  } else {
    clang_debugger_path = compiler_path.replace(clang_compiler_regex, 'gdb');

    if ((clang_debugger_path.search(new RegExp('gdb')) != -1) && await checkDebugger(clang_debugger_path)) {
      return createGDBDebugConfiguration(clang_debugger_path, target);
    }
  }

  const debugger_name = platform == 'darwin' ? 'lldb' : 'gdb';
  const description = possible_debuggers[debugger_name];
  const gcc_compiler_regex = /(g\+\+|gcc)+/gi;
  const gdb_debugger_path = compiler_path.replace(gcc_compiler_regex, description.mi_mode);
  if (gdb_debugger_path.search(new RegExp(description.mi_mode)) != -1) {
    return description.config_factory(gdb_debugger_path, target);
  }

  const is_msvc_compiler = compiler_path.endsWith('cl.exe');
  if (is_msvc_compiler) {
    return createMSVCDebugConfiguration(target);
  }

  return {type: '', name: '', request: ''} as Configuration;
}

export async function checkDebugger(debugger_path: string): Promise<boolean> {
  const res = await proc.execute(debugger_path, ['--version'], null, {shell: true}).result;
  return res.retc == 0;
}

export async function getDebugConfigurationFromKit(debuggerConfig: DebuggerConfiguration,
                                                   target: ExecutableTarget): Promise<Configuration> {
  const debugger_path = debuggerConfig.debuggerPath;

  switch (debuggerConfig.type) {
  case DebuggerType.VISUALSTUDIO:
    return createMSVCDebugConfiguration(target);

  case DebuggerType.GDB:
    if (debugger_path !== undefined && await checkDebugger(debugger_path)) {
      return createGDBDebugConfiguration(debugger_path, target);
    } else {
      throw new Error(`Unable to find GDB debugger (${debugger_path})`);
    }

  case DebuggerType.LLDB:
    if (debugger_path !== undefined && await checkDebugger(debugger_path)) {
      return createLLDBDebugConfiguration(debugger_path, target);
    } else {
      throw new Error(`Unable to find LLDB debugger (${debugger_path})`);
    }

  default:
    throw new Error(`Invalid debugger type (${debuggerConfig.type}).`);
  }
}