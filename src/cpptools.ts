/**
 * Module for vscode-cpptools integration
 */ /** */

import {CMakeCache} from '@cmt/cache';
import * as cms from '@cmt/cms-client';
import {Kit} from '@cmt/kit';
import * as util from '@cmt/util';
import * as path from 'path';
import * as vscode from 'vscode';
import * as cpt from 'vscode-cpptools';
import rollbar from './rollbar';

export interface CodeModelParams {
  codeModel: cms.CodeModelContent;
  kit: Kit;
  cache: CMakeCache;
  clCompilerPath?: string|null;
}

export class CppConfigurationProvider implements cpt.CustomConfigurationProvider {
  readonly name = 'CMake Tools';
  readonly extensionId = 'vector-of-bool.cmake-tools';

  getConfiguration(uri: vscode.Uri): cpt.SourceFileConfigurationItem|undefined {
    const norm_path = util.normalizePath(uri.fsPath);
    return this._fileIndex.get(norm_path);
  }

  async canProvideConfiguration(uri: vscode.Uri) { return !!this.getConfiguration(uri); }

  async provideConfigurations(uris: vscode.Uri[]) { return util.dropNulls(uris.map(u => this.getConfiguration(u))); }

  dispose() {}

  private readonly _fileIndex = new Map<string, cpt.SourceFileConfigurationItem>();

  private _buildConfigurationData(grp: cms.CodeModelFileGroup, opts: CodeModelParams): cpt.SourceFileConfiguration {
    const lang = grp.language || 'CXX';
    // Try the group's language's compiler, then the C++ compiler, then the C compiler.
    const compiler = opts.cache.get(`CMAKE_${lang}_COMPILER`) || opts.cache.get('CMAKE_CXX_COMPILER') || opts.cache.get('CMAKE_C_COMPILER');
    const compilerPath = compiler ? compiler.as<string>() : opts.clCompilerPath;
    let is_msvc = false;
    if (compilerPath) {
      is_msvc = path.basename(compilerPath).toLocaleLowerCase() === 'cl.exe';
    }
    if (!compilerPath) {
      rollbar.error('Unable to automatically determine compiler', {lang, fileGroup: grp, kit: opts.kit});
    }
    return {
      defines: grp.defines || [],
      includePath: (grp.includePath || []).map(p => p.path),
      intelliSenseMode: is_msvc ? 'msvc-x64' : 'clang-x64',
      standard: 'c++17',  // TODO: Switch on correct standard
      compilerPath: compilerPath || undefined,
    };
  }

  private _updateFileGroup(sourceDir: string, grp: cms.CodeModelFileGroup, opts: CodeModelParams) {
    const config = this._buildConfigurationData(grp, opts);
    for (const src of grp.sources) {
      const abs = path.isAbsolute(src) ? src : path.join(sourceDir, src);
      const abs_norm = util.normalizePath(abs);
      this._fileIndex.set(abs_norm, {
        uri: vscode.Uri.file(abs).toString(),
        configuration: config,
      });
    }
  }

  pushCodeModel(opts: CodeModelParams) {
    for (const config of opts.codeModel.configurations) {
      for (const project of config.projects) {
        for (const target of project.targets) {
          for (const grp of target.fileGroups || []) {
            this._updateFileGroup(target.sourceDirectory || '', grp, opts);
          }
        }
      }
    }
  }
}