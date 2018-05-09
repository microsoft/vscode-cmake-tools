import {CMakeCache} from '@cmt/cache';


export namespace Debugger {

export interface Configuration {
  type: string;
  name: string;
  request: string;
  [key: string]: any;
}

function createGDBDebugConfiguration(debuggerPath: string, targetName: string, targetPath: string): Configuration {
  return {
    type: 'cppdbg',
    name: `Debug ${targetName}`,
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
    program: targetPath
  };
}

function createLLDBDebugConfiguration(debuggerPath: string, targetName: string, targetPath: string): Configuration {
  return {
    type: 'cppdbg',
    name: `Debug ${targetName}`,
    request: 'launch',
    cwd: '${workspaceRoot}',
    args: [],
    MIMode: 'lldb',
    miDebuggerPath: debuggerPath,
    program: targetPath
  };
}

function createMSVCDebugConfiguration(targetName: string, targetPath: string): Configuration {
  return {
    type: 'cppvsdbg',
    name: `Debug ${targetName}`,
    request: 'launch',
    cwd: '${workspaceRoot}',
    args: [],
    program: targetPath
  };
}

function testGDBDebuggerPath(binPath: string): boolean { return binPath.search(/gdb/i) != -1; }
function testLLDBDebuggerPath(binPath: string): boolean { return binPath.search(/lldb/i) != -1; }

function searchForCompilerPath(cache: CMakeCache): string|null {
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

export function getDebugConfigurationFromCache(cache: CMakeCache, targetName: string, targetPath: string):
    Configuration {
  const entry = cache.get('CMAKE_LINKER');
  if (entry !== null) {
    const linker = entry.value as string;
    const is_msvc_linker = linker.endsWith('link.exe');
    if (is_msvc_linker) {
      return createMSVCDebugConfiguration(targetName, targetPath);
    }
  }

  const compiler_path = searchForCompilerPath(cache);
  if (compiler_path === null) {
    throw Error('No compiler found in cache file.');  // MSVC should be already found by CMAKE_LINKER
  }

  const clang_debugger_path = compiler_path.replace('clang++', 'lldb').replace('clang', 'lldb');
  if (testLLDBDebuggerPath(clang_debugger_path)) {
    return createLLDBDebugConfiguration(clang_debugger_path, targetName, targetPath);
  }

  const gdb_debugger_path
      = compiler_path.replace('g++', 'gdb').replace('gcc', 'gdb').replace('clang++', 'gdb').replace('clang', 'gdb');
  if (testGDBDebuggerPath(gdb_debugger_path)) {
    return createGDBDebugConfiguration(gdb_debugger_path, targetName, targetPath);
  }

  const is_msvc_compiler = compiler_path.endsWith('cl.exe');
  if (is_msvc_compiler) {
    return createMSVCDebugConfiguration(targetName, targetPath);
  }

  return {type: '', name: '', request: ''} as Configuration;
}
}