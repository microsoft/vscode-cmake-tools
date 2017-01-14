import * as path from 'path';
import * as vscode from 'vscode';

import * as util from './util';

type Maybe<T> = util.Maybe<T>;

export interface RawDiagnostic {
  full: string;
  file: string;
  line: number;
  column: number;
  severity: string;
  message: string;
}


export function parseGCCDiagnostic(line: string): Maybe<RawDiagnostic> {
  const gcc_re =
      /^(.*):(\d+):(\d+):\s+(?:fatal )?(\w*)(?:\sfatale)?\s?:\s+(.*)/;
  const res = gcc_re.exec(line);
  if (!res) return null;
  const [full, file, lineno, column, severity, message] = res;
  if (file && lineno && column && severity && message) {
    return {
      full: full,
      file: file,
      line: parseInt(lineno) - 1,
      column: parseInt(column) - 1,
      severity: severity,
      message: message
    };
  } else {
    return null;
  }
}

export function parseGNULDDiagnostic(line: string): Maybe<RawDiagnostic> {
  if (line.startsWith('make')) {
    // This is a Make error. It may *look* like an LD error, so we abort early
    return null;
  }
  const ld_re = /^(.*):(\d+)\s?:\s+(.*)$/;
  const res = ld_re.exec(line);
  if (!res) {
    return null;
  }
  const [full, file, lineno, message] = res;
  if (file && lineno && message) {
    return {
      full: full,
      file: file,
      line: parseInt(lineno) - 1,
      column: 0,
      severity: 'error',
      message: message,
    };
  } else {
    return null;
  }
}

export function parseGHSDiagnostic(line: string): Maybe<RawDiagnostic> {
  const gcc_re =
      /^\"(.*)\",\s+(?:(?:line\s+(\d+)\s+\(col\.\s+(\d+)\))|(?:At end of source)):\s+(?:fatal )?(remark|warning|error)\s+(.*)/;
  const res = gcc_re.exec(line);
  if (!res) return null;
  const [full, file, lineno = '1', column = '1', severity, message] = res;
  if (file && severity && message) {
    return {
      full: full,
      file: file,
      line: parseInt(lineno) - 1,
      column: parseInt(column) - 1,
      severity: severity,
      message: message
    };
  } else {
    return null;
  }
}

export interface FileDiagnostic {
  filepath: string;
  key: string;
  diag: vscode.Diagnostic;
}

export interface LineParseResult {
  lineMatch: boolean;
  diagnostic: Maybe<FileDiagnostic>;
}

export const PARSER_FAIL: LineParseResult = {
  lineMatch: false,
  diagnostic: null
};
export const PARSER_NEEDS_MORE: LineParseResult = {
  lineMatch: true,
  diagnostic: null
};

export abstract class DiagnosticParser {
  constructor(protected readonly binaryDir: string) {}
  public abstract parseLine(line: string): LineParseResult;
}


export class CMakeDiagnosticParser extends DiagnosticParser {
  private _cmakeDiag: Maybe<FileDiagnostic>;

  constructor(binaryDir: string) {
    super(binaryDir);
    this._cmakeDiag = null;
  }

  public parseLine(line: string): LineParseResult {
    if (!line) {
      const diagnostic = this._cmakeDiag;
      this._cmakeDiag = null;
      return {lineMatch: !!diagnostic, diagnostic};
    }

    const cmake_re = /CMake (.*?) at (.*?):(\d+) \((.*?)\):\s*(.*)/;
    const res = cmake_re.exec(line);
    if (!res) {
      if (this._cmakeDiag) {
        this._cmakeDiag.diag.message = '\n' + line;
        return PARSER_NEEDS_MORE;
      }
      return PARSER_FAIL;
    }

    const [full, level, filename, linestr, command, what] = res;
    if (!filename || !linestr || !level) {
      if (this._cmakeDiag) {
        this._cmakeDiag.diag.message = '\n' + line;
        return PARSER_NEEDS_MORE;
      }
      return PARSER_FAIL;
    }

    this._cmakeDiag = <FileDiagnostic>{};
    this._cmakeDiag.filepath = path.isAbsolute(filename) ?
        filename :
        path.join(vscode.workspace.rootPath, filename);
    this._cmakeDiag.key = full;
    const lineNr = Number.parseInt(linestr) - 1;

    this._cmakeDiag.diag = new vscode.Diagnostic(
        new vscode.Range(lineNr, 0, lineNr, Number.POSITIVE_INFINITY), what, {
          'Warning': vscode.DiagnosticSeverity.Warning,
          'Error': vscode.DiagnosticSeverity.Error,
        }[level]);
    this._cmakeDiag.diag.source = 'CMake (' + command + ')';
    return PARSER_NEEDS_MORE;
  }
}

/**
 * Parses a diagnostic message from GCC
 *
 * @class GCCDiagnosticParser
 * @extends {DiagnosticParser}
 */
export class GCCDiagnosticParser extends DiagnosticParser {
  public parseLine(line: string): LineParseResult {
    const diag = parseGCCDiagnostic(line);
    if (!diag) {
      return PARSER_FAIL;
    }
    const abspath = path.isAbsolute(diag.file) ?
        diag.file :
        path.normalize(path.join(this.binaryDir, diag.file));
    const vsdiag = new vscode.Diagnostic(
        new vscode.Range(diag.line, diag.column, diag.line, diag.column),
        diag.message, {
          error: vscode.DiagnosticSeverity.Error,
          warning: vscode.DiagnosticSeverity.Warning,
          note: vscode.DiagnosticSeverity.Information,
        }[diag.severity]);
    vsdiag.source = 'GCC';
    return {
      lineMatch: true,
      diagnostic: {
        filepath: abspath,
        key: diag.full,
        diag: vsdiag,
      }
    };
  }
}

/**
 * Parses a diagnostic message from GCC
 *
 * @class GNULDDiagnosticParser
 * @extends {DiagnosticParser}
 */
export class GNULDDiagnosticParser extends DiagnosticParser {
  public parseLine(line: string): LineParseResult {
    const diag = parseGNULDDiagnostic(line);
    if (!diag) {
      return PARSER_FAIL;
    }
    const abspath = path.isAbsolute(diag.file) ?
        diag.file :
        path.normalize(path.join(this.binaryDir, diag.file));
    const vsdiag = new vscode.Diagnostic(
        new vscode.Range(diag.line, 0, diag.line, Number.POSITIVE_INFINITY),
        diag.message, {
          error: vscode.DiagnosticSeverity.Error,
          warning: vscode.DiagnosticSeverity.Warning,
          note: vscode.DiagnosticSeverity.Information,
        }[diag.severity]);
    vsdiag.source = 'Link';
    return {
      lineMatch: true,
      diagnostic: {
        filepath: abspath,
        key: diag.full,
        diag: vsdiag,
      }
    };
  }
}

/**
 * Parses an MSVC diagnostic.
 *
 * @class MSVCDiagnosticParser
 * @extends {DiagnosticParser}
 */
export class MSVCDiagnosticParser extends DiagnosticParser {
  /**
   * @brief Obtains a reference to a TextDocument given the name of the file
   */
  private getTextDocumentByFileName(file: string): Maybe<vscode.TextDocument> {
    const documents = vscode.workspace.textDocuments;
    let document: Maybe<vscode.TextDocument> = null;
    if (documents.length !== 0) {
      const filtered = documents.filter((doc: vscode.TextDocument) => {
        return doc.fileName.toUpperCase() === file.toUpperCase();
      });
      if (filtered.length !== 0) {
        document = filtered[0];
      }
    }
    return document;
  }

  /**
   * @brief Gets the range of the text of a specific line in the given file.
   */
  private getTrimmedLineRange(file: string, line: number): vscode.Range {
    const document = this.getTextDocumentByFileName(file);
    if (document && (line < document.lineCount)) {
      const text = document.lineAt(line).text + '\n';
      let start = 0;
      let end = text.length - 1;
      let is_space = (i) => {
        return /\s/.test(text[i]);
      };
      while ((start < text.length) && is_space(start)) ++start;
      while ((end >= start) && is_space(end)) --end;

      return new vscode.Range(line, start, line, end);
    } else
      return new vscode.Range(line, 0, line, 0);
  }

  public parseLine(line: string): LineParseResult {
    const msvc_re =
        /^\s*(?!\d+>)\s*([^\s>].*)\((\d+|\d+,\d+|\d+,\d+,\d+,\d+)\):\s+((?:fatal )?error|warning|info)\s+(\w{1,2}\d+)\s*:\s*(.*)$/;
    const res = msvc_re.exec(line);
    if (!res) return PARSER_FAIL;
    const full = res[0];
    const file = res[1];
    const location = res[2];
    const severity = res[3];
    const code = res[4];
    const message = res[5];
    const abspath = path.isAbsolute(file) ?
        file :
        path.normalize(path.join(this.binaryDir, file));
    const loc = (() => {
      const parts = location.split(',');
      if (parts.length === 1)
        return this.getTrimmedLineRange(file, Number.parseInt(parts[0]) - 1);
      if (parts.length === 2)
        return new vscode.Range(
            Number.parseInt(parts[0]) - 1, Number.parseInt(parts[1]) - 1,
            Number.parseInt(parts[0]) - 1, Number.parseInt(parts[1]) - 1);
      if (parts.length === 4)
        return new vscode.Range(
            Number.parseInt(parts[0]) - 1, Number.parseInt(parts[1]) - 1,
            Number.parseInt(parts[2]) - 1, Number.parseInt(parts[3]) - 1);
      throw new Error('Unable to determine location of MSVC error');
    })();
    const diag = new vscode.Diagnostic(loc, message, {
      error: vscode.DiagnosticSeverity.Error,
      warning: vscode.DiagnosticSeverity.Warning,
      info: vscode.DiagnosticSeverity.Information,
    }[severity]);
    diag.code = code;
    diag.source = 'MSVC';
    return {
      lineMatch: true,
      diagnostic: {
        filepath: abspath,
        key: full,
        diag: diag,
      }
    };
  }
}

/**
 * Parses a diagnostic message from Green Hills Compiler.
 * Use single line error reporting when invoking GHS compiler
 * (--no_wrap_diagnostics --brief_diagnostics).
 *
 * @class GHSDiagnosticParser
 * @extends {DiagnosticParser}
 */
export class GHSDiagnosticParser extends DiagnosticParser {
  public parseLine(line: string): LineParseResult {
    const diag = parseGHSDiagnostic(line);
    if (!diag) return PARSER_FAIL;
    const abspath = path.isAbsolute(diag.file) ?
        diag.file :
        path.normalize(path.join(this.binaryDir, diag.file));
    const vsdiag = new vscode.Diagnostic(
        new vscode.Range(diag.line, diag.column, diag.line, diag.column),
        diag.message, {
          error: vscode.DiagnosticSeverity.Error,
          warning: vscode.DiagnosticSeverity.Warning,
          remark: vscode.DiagnosticSeverity.Information,
        }[diag.severity]);
    vsdiag.source = 'GHS';
    return {
      lineMatch: true,
      diagnostic: {
        filepath: abspath,
        key: diag.full,
        diag: vsdiag,
      }
    };
  }
}

export const diagnosticParsers = {
  cmake: CMakeDiagnosticParser,
  gcc: GCCDiagnosticParser,
  gnuld: GNULDDiagnosticParser,
  msvc: MSVCDiagnosticParser,
  ghs: GHSDiagnosticParser,
};


export class BuildParser extends util.OutputParser {
  private _accumulatedDiags: Map<string, Map<string, vscode.Diagnostic>>;
  private _lastFile: Maybe<string>;

  private _progressParser(line): Maybe<number> {
    return null;
  };
  private _activeParser: Maybe<DiagnosticParser>;
  private _parserCollection: Set<DiagnosticParser>;

  constructor(
      binaryDir: string, parsers: Maybe<string[]>, generator: Maybe<string>) {
    super();
    this._accumulatedDiags = new Map();
    this._lastFile = null;
    this._activeParser = null;
    this._parserCollection = new Set();
    if (parsers) {
      for (let parser of parsers) {
        if (parser in diagnosticParsers) {
          this._parserCollection.add(new diagnosticParsers[parser](binaryDir));
        }
      }
    } else {
      /* No parser specified. Use all implemented. */
      for (let parser in diagnosticParsers) {
        this._parserCollection.add(new diagnosticParsers[parser](binaryDir));
      }
    }
  }

  private parseBuildProgress(line): Maybe<number> {
    // Parses out a percentage enclosed in square brackets Ignores other
    // contents of the brackets
    const percent_re = /\[.*?(\d+)\%.*?\]/;
    const res = percent_re.exec(line);
    if (res) {
      const [total] = res.splice(1);
      return Math.floor(parseInt(total));
    }
    return null;
  }

  private parseDiagnosticLine(line: string): Maybe<FileDiagnostic> {
    if (this._activeParser) {
      var {lineMatch, diagnostic} = this._activeParser.parseLine(line);
      if (lineMatch) {
        return diagnostic;
      }
    }

    for (let parser of this._parserCollection.values()) {
      if (parser !== this._activeParser) {
        var {lineMatch, diagnostic} = parser.parseLine(line);
        if (lineMatch) {
          this._activeParser = parser;
          return diagnostic;
        }
      }
    }
    /* Most likely new generator progress message or new compiler command. */
    return null;
  }

  public fillDiagnosticCollection(diagset: vscode.DiagnosticCollection) {
    diagset.clear();
    for (const [filepath, diags] of this._accumulatedDiags) {
      diagset.set(vscode.Uri.file(filepath), [...diags.values()]);
    }
  }

  public parseLine(line: string): Maybe<number> {
    const progress = this.parseBuildProgress(line);
    if (null === progress) {
      const diag = this.parseDiagnosticLine(line);
      if (diag) {
        if (!this._accumulatedDiags.has(diag.filepath)) {
          // First diagnostic of this file. Add a new map to hold our diags
          this._accumulatedDiags.set(diag.filepath, new Map());
        }
        const diags = this._accumulatedDiags.get(diag.filepath)!;
        diags.set(diag.key, diag.diag);
      }
    }
    return progress;
  }
}
