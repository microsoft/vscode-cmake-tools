/**
 * Module for vscode-cpptools integration
 */ /** */

import {CMakeCache} from '@cmt/cache';
import * as cms from '@cmt/cms-client';
import * as util from '@cmt/util';
import * as path from 'path';
import * as vscode from 'vscode';
import * as cpt from 'vscode-cpptools';

import rollbar from './rollbar';

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

  private _fileIndex = new Map<string, cpt.SourceFileConfigurationItem>();

  private _buildConfigurationData(grp: cms.CodeModelFileGroup, cache: CMakeCache): cpt.SourceFileConfiguration {
    const compiler = cache.get(`CMAKE_${grp.language}_COMPILER`);
    const compilerPath = compiler ? compiler.value : undefined;
    return {
      defines: grp.defines || [],
      includePath: (grp.includePath || []).map(p => p.path),
      intelliSenseMode: 'clang-x64',  // TODO: Switch on correct mode
      standard: 'c++17',              // TODO: Switch on correct standard
      compilerPath,
    };
  }

  private _updateFileGroup(sourceDir: string, grp: cms.CodeModelFileGroup, cache: CMakeCache) {
    const config = this._buildConfigurationData(grp, cache);
    for (const src of grp.sources) {
      const abs = path.isAbsolute(src) ? src : path.join(sourceDir, src);
      this._fileIndex.set(abs, {
        uri: vscode.Uri.file(abs).toString(),
        configuration: config,
      });
    }
  }

  pushCodeModel(cm: cms.CodeModelContent, cache: CMakeCache) {
    for (const config of cm.configurations) {
      for (const project of config.projects) {
        for (const target of project.targets) {
          for (const grp of target.fileGroups || []) {
            this._updateFileGroup(target.sourceDirectory || '', grp, cache);
          }
        }
      }
    }
  }
}