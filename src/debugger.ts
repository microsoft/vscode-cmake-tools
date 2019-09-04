import {ExecutableTarget} from '@cmt/api';
import {CMakeCache} from '@cmt/cache';
import * as proc from '@cmt/proc';
import {createLogger} from './logging';

const log = createLogger('debugger');


export enum DebuggerType {
  VisualStudio = 'Visual Studio',
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
    cwd: '${workspaceFolder}',
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
  if (!await checkDebugger(debuggerPath)) {
    throw new Error(`Unable to find GDB in default search path and ${debuggerPath}.`);
  }

  return {
    type: 'cppdbg',
    name: `Debug ${target.name}`,
    request: 'launch',
    cwd: '${workspaceFolder}',
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
    cwd: '${workspaceFolder}',
    args: [],
    program: target.path
  };
}

type DebuggerMIMode = 'gdb'|'lldb';

type DebuggerGenerators = {
  [MIMode in DebuggerMIMode]: {
    miMode: MIMode,
    createConfig(debuggerPath: string, target: ExecutableTarget): Promise<Configuration>,
  };
};

const DEBUG_GEN: DebuggerGenerators = {
  gdb: {
    miMode: 'gdb',
    createConfig: createGDBDebugConfiguration,
  },
  lldb: {
    miMode: 'lldb',
    createConfig: createLLDBDebugConfiguration,
  },
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
    Promise<Configuration|null> {
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
  // Look for lldb-mi
  let clang_debugger_path = compiler_path.replace(clang_compiler_regex, 'lldb-mi');
  if ((clang_debugger_path.search(new RegExp('lldb-mi')) != -1) && await checkDebugger(clang_debugger_path)) {
    return createLLDBDebugConfiguration(clang_debugger_path, target);
  } else {
    // Look for gdb
    clang_debugger_path = compiler_path.replace(clang_compiler_regex, 'gdb');
    if ((clang_debugger_path.search(new RegExp('gdb')) != -1) && await checkDebugger(clang_debugger_path)) {
      return createGDBDebugConfiguration(clang_debugger_path, target);
    } else {
      // Look for lldb
      clang_debugger_path = compiler_path.replace(clang_compiler_regex, 'lldb');
      if ((clang_debugger_path.search(new RegExp('lldb')) != -1) && await checkDebugger(clang_debugger_path)) {
        return createLLDBDebugConfiguration(clang_debugger_path, target);
      }
    }
  }

  const debugger_name = platform == 'darwin' ? 'lldb' : 'gdb';
  const description = DEBUG_GEN[debugger_name];
  const gcc_compiler_regex = /([cg]\+\+|g?cc)+/gi;
  const gdb_debugger_path = compiler_path.replace(gcc_compiler_regex, description.miMode);
  if (gdb_debugger_path.search(new RegExp(description.miMode)) != -1) {
    return description.createConfig(gdb_debugger_path, target);
  }

  const is_msvc_compiler = compiler_path.endsWith('cl.exe');
  if (is_msvc_compiler) {
    return createMSVCDebugConfiguration(target);
  }

  log.warning(`Unable to automatically determine debugger corresponding to compiler: ${compiler_path}`);
  return null;
}

export async function checkDebugger(debuggerPath: string): Promise<boolean> {
  const res = await proc.execute(debuggerPath, ['--version'], null, {shell: true}).result;
  return res.retc == 0;
}