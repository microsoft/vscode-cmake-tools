import * as path from 'path';
import * as vscode from 'vscode';

import {CompilationInfo, RawCompilationInfo} from './api';
import {createLogger} from './logging';
import {fs} from './pr';
import * as util from './util';

const log = createLogger('compdb');


export function parseRawCompilationInfo(raw: RawCompilationInfo): CompilationInfo {
  // Here we try to get more interesting information about a compilation
  // than the raw command line.
  // First we should start by splitting the command up into the individual
  // arguments.
  const command = util.splitCommandLine(raw.command);
  const compiler = command[0];
  const inc_dirs = [] as ({
                     path: string;
                     isSystem: boolean
                   }[]);
  const definitions = {} as {[key: string] : string | null};

  const include_flags = [ {flag : '-I', isSystem : false}, {flag : '-isystem', isSystem : true} ];
  const def_flags = [ '-D' ];
  if (compiler.endsWith('cl.exe')) {
    // We are parsing an MSVC-style command line.
    // It has options which may appear with a different argument prefix.
    include_flags.push({flag : '/I', isSystem : false});
    def_flags.push('/D');
  }

  const non_include_args: string[] = [];
  let arg = (n: number) => command[n];
  next_arg: for (let i = 1; i < command.length; ++i) {
    for (const iflag of include_flags) {
      const flagstr = iflag.flag;
      if (arg(i).startsWith(flagstr)) {
        const ipath = arg(i) === flagstr ? arg(++i) : arg(i).substr(flagstr.length);
        const abs_ipath = path.isAbsolute(ipath) ? ipath : path.join(raw.directory, ipath);
        inc_dirs.push({
          path : util.normalizePath(abs_ipath),
          isSystem : iflag.isSystem,
        });
        continue next_arg;
      }
    }
    non_include_args.push(arg(i));
  }

  const unparsed_args: string[] = [];
  arg = n => non_include_args[n];
  next_arg2: for (let i = 0; i < non_include_args.length; ++i) {
    for (const dflag of def_flags) {
      if (arg(i).startsWith(dflag)) {
        const defstr = arg(i) === dflag ? arg(++i) : arg(i).substr(dflag.length);
        const def = parseCompileDefinition(defstr);
        definitions[def[0]] = def[1];
        continue next_arg2;
      }
    }
    unparsed_args.push(arg(i));
  }

  return {
    compiler,
    compile : raw,
    compileDefinitions : definitions,
    file : raw.file,
    includeDirectories : inc_dirs,
    compileFlags : unparsed_args,
  };
}

export function parseCompileDefinition(str: string): [ string, string|null ] {
  if (/^\w+$/.test(str)) {
    return [ str, null ];
  } else {
    const key = str.split('=', 1)[0];
    return [ key, str.substr(key.length + 1) ];
  }
}

export class CompilationDatabase {
  private readonly _info_by_filepath: Map<string, CompilationInfo>;
  constructor(infos: CompilationInfo[]) {
    this._info_by_filepath = infos.reduce((acc, cur) => {
      acc.set(cur.file, cur);
      return acc;
    }, new Map<string, CompilationInfo>());
  }

  private _normalizeFilePath(fspath: string): string {
    const no_detail = util.removeAllPatterns(fspath, [
      'source/',
      'src/',
      'include/',
      'inc/',
      '.cpp',
      '.hpp',
      '.c',
      '.h',
      '.cc',
      '.hh',
      '.cxx',
      '.hxx',
      '.c++',
      '.h++',
      'build/',
      '.m'
    ]);
    return util.normalizePath(no_detail);
  }

  public getCompilationInfoForUri(uri: vscode.Uri): CompilationInfo|null {
    const fspath = uri.fsPath;
    const plain = this._info_by_filepath.get(fspath);
    if (plain) {
      return plain;
    }
    const fsnorm = this._normalizeFilePath(fspath);
    const matching_key = Array.from(this._info_by_filepath.keys()).find(key => this._normalizeFilePath(key) == fsnorm);
    return !matching_key ? null : this._info_by_filepath.get(matching_key)!;
  }

  public static async fromFilePath(dbpath: string): Promise<CompilationDatabase|null> {
    if (!await fs.exists(dbpath)) {
      return null;
    }
    const data = await fs.readFile(dbpath);
    try {
      const content = JSON.parse(data.toString()) as RawCompilationInfo[];
      return new CompilationDatabase(content.map(parseRawCompilationInfo));
    } catch (e) {
      log.warning(`Error parsing compilation database "${dbpath}": ${e}`);
      return null;
    }
  }
}