import {CMakeCache} from '@cmt/cache';

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

const possible_debuggers: {
  [debugger_name: string]: {
    mi_mode: string,
    config_factory: (debugger_path: string, target_name: string, target_path: string) => Configuration
  }
}
= {
    gdb: {mi_mode: 'gdb', config_factory: createGDBDebugConfiguration},
    lldb: {mi_mode: 'lldb', config_factory: createLLDBDebugConfiguration}
  };

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

export function getDebugConfigurationFromCache(cache: CMakeCache,
                                               targetName: string,
                                               targetPath: string,
                                               platform: string): Configuration {
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

  const clang_compiler_regex = /(clang[\+]{0,2})+(?!-cl)/gi;
  const clang_debugger_path = compiler_path.replace(clang_compiler_regex, 'lldb');

  if (clang_debugger_path.search(/lldb/) != -1) {
    return createLLDBDebugConfiguration(clang_debugger_path, targetName, targetPath);
  }

  const debugger_name = platform == 'darwin' ? 'lldb' : 'gdb';
  const description = possible_debuggers[debugger_name];
  const gcc_compiler_regex = /(g\+\+|gcc)+/gi;
  const gdb_debugger_path = compiler_path.replace(gcc_compiler_regex, description.mi_mode);
  if (gdb_debugger_path.search(new RegExp(description.mi_mode)) != -1) {
    return description.config_factory(gdb_debugger_path, targetName, targetPath);
  }

  const is_msvc_compiler = compiler_path.endsWith('cl.exe');
  if (is_msvc_compiler) {
    return createMSVCDebugConfiguration(targetName, targetPath);
  }

  return {type: '', name: '', request: ''} as Configuration;
}