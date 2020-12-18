import * as shlex from '@cmt/shlex';

import {createLogger} from './logging';
import {fs} from './pr';
import * as util from './util';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = createLogger('compdb');

interface BaseCompileCommand {
  directory: string;
  file: string;
  output?: string;
}

interface StringCompileCommand extends BaseCompileCommand {
  command: string;
}

interface ArgsCompileCommand extends BaseCompileCommand {
  arguments: string[];
}

export type CompileCommand = StringCompileCommand|ArgsCompileCommand;

export class CompilationDatabase {
  private readonly _infoByFilePath: Map<string, ArgsCompileCommand>;
  constructor(infos: CompileCommand[]) {
    this._infoByFilePath = infos.reduce(
        (acc, cur) => acc.set(util.platformNormalizePath(cur.file), {
          directory: cur.directory,
          file: cur.file,
          output: cur.output,
          arguments: 'arguments' in cur ? cur.arguments : [...shlex.split(cur.command)],
        }),
        new Map<string, ArgsCompileCommand>(),
    );
  }

  get(fspath: string) { return this._infoByFilePath.get(util.platformNormalizePath(fspath)); }

  public static async fromFilePath(dbpath: string): Promise<CompilationDatabase|null> {
    if (!await fs.exists(dbpath)) {
      return null;
    }
    const data = await fs.readFile(dbpath);
    try {
      const content = JSON.parse(data.toString()) as CompileCommand[];
      return new CompilationDatabase(content);
    } catch (e) {
      log.warning(localize('error.parsing.compilation.database', 'Error parsing compilation database "{0}": {1}', dbpath, util.errorToString(e)));
      return null;
    }
  }
}
