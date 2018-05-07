import {CMakeCache} from '@cmt/cache';


export namespace Debugger {

export interface Configuration {
  type: string;
  name: string;
  [key: string]: any;
}

function createGdbDebugConfiguration(debuggerPath: string, targetName: string, targetPath: string): Configuration {
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

function createLldbDebugConfiguration(debuggerPath: string, targetName: string, targetPath: string): Configuration {
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

function createMsvcDebugConfiguration(targetName: string, targetPath: string): Configuration {
  return {
    type: 'cppvsdbg',
    name: `Debug ${targetName}`,
    request: 'launch',
    cwd: '${workspaceRoot}',
    args: [],
    program: targetPath
  };
}

function testGdbDebuggerPath(debugger_path: string): boolean { return debugger_path.search(/gdb/i) != -1; }
function testLldbDebuggerPath(debugger_path: string): boolean { return debugger_path.search(/lldb/i) != -1; }

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
      return createMsvcDebugConfiguration(targetName, targetPath);
    }
  }

  const compiler_path = searchForCompilerPath(cache);
  if (compiler_path === null) {
    throw Error('No compiler found in cache file.');  // MSVC should be already found by CMAKE_LINKER
  }

  const clang_debugger_path = compiler_path.replace('clang++', 'lldb').replace('clang', 'lldb');
  if (testLldbDebuggerPath(clang_debugger_path)) {
    return createLldbDebugConfiguration(clang_debugger_path, targetName, targetPath);
  }

  const gdb_debugger_path
      = compiler_path.replace('g++', 'gdb').replace('gcc', 'gdb').replace('clang++', 'gdb').replace('clang', 'gdb');
  if (testGdbDebuggerPath(gdb_debugger_path)) {
    return createGdbDebugConfiguration(gdb_debugger_path, targetName, targetPath);
  }

  const is_msvc_compiler = compiler_path.endsWith('cl.exe');
  if (is_msvc_compiler) {
    return createMsvcDebugConfiguration(targetName, targetPath);
  }

  return {type: '', name: '', request: ''} as Configuration;
}
}