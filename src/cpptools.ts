/**
 * Module for vscode-cpptools integration
 */ /** */

import {CMakeCache} from '@cmt/cache';
import * as cms from '@cmt/cms-client';
import * as path from 'path';
import * as vscode from 'vscode';
import * as cpt from 'vscode-cpptools';

import rollbar from './rollbar';

export class CppConfigurationProvider implements cpt.CustomConfigurationProvider {
  readonly name = 'CMake Tools';
  readonly extensionId = 'vector-of-bool.cmake-tools';

  async canProvideConfiguration(uri: vscode.Uri) { return this._fileIndex.has(uri.fsPath); }

  async provideConfigurations(uris: vscode.Uri[]) { return uris.map(u => this._provideOne(u)); }

  private _provideOne(uri: vscode.Uri): cpt.SourceFileConfigurationItem {
    const item = this._fileIndex.get(uri.fsPath);
    if (!item) {
      // DIRTY LIES
      return undefined as any as cpt.SourceFileConfigurationItem;
      rollbar.error('Tried to provide cpptools config for file that we do not have in the index');
      return {
        uri: uri.toString(),
        configuration: {
          defines: [],
          standard: 'c++17',
          includePath: [],
          intelliSenseMode: 'clang-x64',
        },
      };
    }
    return item;
  }

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