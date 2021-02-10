import * as chokidar from 'chokidar';
import * as json5 from 'json5';
import * as path from 'path';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';

import { CMakeTools } from '@cmt/cmake-tools';
import * as logging from '@cmt/logging';
import { fs } from '@cmt/pr';
import { ConfigurePreset, BuildPreset, TestPreset } from '@cmt/preset';
import * as util from '@cmt/util';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('kit');

interface CmakeMinimumRequired {
  major: number;
  minor: number;
  patch: number;
}

interface PresetsFile {
  version: number;
  cmakeMinimumRequired: CmakeMinimumRequired;
  configurePresets: ConfigurePreset[] | undefined;
  buildPresets: BuildPreset[] | undefined;
  testPresets: TestPreset[] | undefined;
}

export class PresetsController {
  private _cmakePresetsExist = false;
  private _cmakeUserPresetsExist = false;
  private _cmakePresetsWatcher: chokidar.FSWatcher | undefined;
  private _cmakeUserPresetsWatcher: chokidar.FSWatcher | undefined;
  private _configurePresets: ConfigurePreset[] = [];
  private _configureUserPresets: ConfigurePreset[] = [];
  private _buildPresets: BuildPreset[] = [];
  private _buildUserPresets: BuildPreset[] = [];
  private _testPresets: TestPreset[] = [];
  private _testUserPresets:TestPreset[] = [];

  private readonly _cmakePresetsChangedEmitter = new vscode.EventEmitter<PresetsFile>();
  private readonly _cmakeUserPresetsChangedEmitter = new vscode.EventEmitter<PresetsFile>();
  private readonly _subscriptions: vscode.Disposable[] = [
    this._cmakePresetsChangedEmitter,
    this._cmakeUserPresetsChangedEmitter
  ]

  static async init(cmakeTools: CMakeTools): Promise<PresetsController> {
    const presetsController = new PresetsController(cmakeTools);
    const cmakePresetsPath = path.join(cmakeTools.folder.uri.fsPath, 'CMakePresets.json');
    const cmakeUserPresetsPath = path.join(cmakeTools.folder.uri.fsPath, 'CMakeUserPresets.json');

    const updatePresets = async () => {
      const presetsFile = await presetsController.readPresetsFile(cmakePresetsPath);
      presetsController._configurePresets = presetsFile?.configurePresets || [];
      presetsController._buildPresets = presetsFile?.buildPresets || [];
      presetsController._testPresets = presetsFile?.testPresets || [];
    }

    const updateUserPresets = async () => {
      const userPresetsFile = await presetsController.readPresetsFile(cmakePresetsPath);
      presetsController._configureUserPresets = userPresetsFile?.configurePresets || [];
      presetsController._buildUserPresets = userPresetsFile?.buildPresets || [];
      presetsController._testUserPresets = userPresetsFile?.testPresets || [];
    }

    presetsController._cmakePresetsWatcher = chokidar.watch(cmakePresetsPath)
                                  .on('add', async () => {
                                    presetsController._cmakePresetsExist = true;
                                    await updatePresets();
                                    presetsController._cmakePresetsChangedEmitter.fire();
                                  })
                                  .on('change', async () => {
                                    await updatePresets();
                                    presetsController._cmakePresetsChangedEmitter.fire();
                                  })
                                  .on('unlink', async () => {
                                    presetsController._cmakePresetsExist = false;
                                    await updatePresets();
                                    presetsController._cmakePresetsChangedEmitter.fire();
                                  });
    presetsController._cmakeUserPresetsWatcher = chokidar.watch(cmakeUserPresetsPath)
                                      .on('add', async () => {
                                        presetsController._cmakeUserPresetsExist = true;
                                        await updateUserPresets();
                                        presetsController._cmakeUserPresetsChangedEmitter.fire();
                                      })
                                      .on('change', async () => {
                                        await updateUserPresets();
                                        presetsController._cmakeUserPresetsChangedEmitter.fire();
                                      })
                                      .on('unlink', async () => {
                                        presetsController._cmakeUserPresetsExist = false;
                                        await updateUserPresets();
                                        presetsController._cmakeUserPresetsChangedEmitter.fire();
                                      });

    return presetsController;
  }

  private constructor(private readonly cmakeTools: CMakeTools) { }

  get cmakePresetsExist() {
    return this._cmakePresetsExist;
  }

  get cmakeUserPresetsExist() {
    return this._cmakeUserPresetsExist;
  }

  get configurePresets() {
    return this._configurePresets.concat(this._configurePresets);
  }

  get configureUerPresets() {
    return this._configureUserPresets.concat(this._configureUserPresets);
  }

  get buildPresets() {
    return this._buildPresets.concat(this._buildPresets);
  }

  get buildUerPresets() {
    return this._buildUserPresets.concat(this._buildUserPresets);
  }

  get testPresets() {
    return this._testPresets.concat(this._testPresets);
  }

  get testUerPresets() {
    return this._testUserPresets.concat(this._testUserPresets);
  }

  /**
   * Call configurePresets, buildPresets, or testPresets to get the latest presets when thie event is fired.
   */
  onPresetsChanged(listener: () => any) { return this._cmakePresetsChangedEmitter.event(listener); }

  /**
   * Call configurePresets, buildPresets, or testPresets to get the latest presets when thie event is fired.
   */
  onUserPresetsChanged(listener: () => any) { return this._cmakeUserPresetsChangedEmitter.event(listener); }

  private async readPresetsFile(file: string): Promise<PresetsFile | undefined> {
    if (!await fs.exists(file)) {
      return undefined;
    }
    log.debug(localize('reading.presets.file', 'Reading presets file {0}', file));
    const presetsFileStr = await fs.readFile(file);
    let presetsFile: PresetsFile;
    try {
      presetsFile = json5.parse(presetsFileStr.toLocaleString());
    } catch (e) {
      log.error(localize('failed.to.parse', 'Failed to parse {0}: {1}', path.basename(file), util.errorToString(e)));
      return undefined;
    }
    // TODO: Validate presets file
    // const validator = await loadSchema('schemas/kits-schema.json');
    // const is_valid = validator(presetsFile);
    // if (!is_valid) {
    //   const errors = validator.errors!;
    //   log.error(localize('invalid.file.error', 'Invalid kit contents {0} ({1}):', path.basename(file), file));
    //   for (const err of errors) {
    //     log.error(` >> ${err.dataPath}: ${err.message}`);
    //   }
    //   return [];
    // }
    // log.info(localize('successfully.loaded.kits', 'Successfully loaded {0} kits from {1}', kits.length, file));
    // return Promise.all(dropNulls(kits).map(expandKitVariables));
    if (presetsFile.version < 2) {
      await this.showPresetsFileVersionError(file);
    }
    return presetsFile;
  }

  private async showPresetsFileVersionError(file: string): Promise<void> {
    const useKitsVars = localize('use.kits.variants', 'Use kits and variants');
    const changePresets = localize('edit.presets', 'Locate');
    const result = await vscode.window.showErrorMessage(
        localize('presets.version.error', 'CMakePresets version 1 is not supported. How would you like to proceed?'),
        useKitsVars, changePresets);
    if (result === useKitsVars) {
      vscode.workspace.getConfiguration('cmake', this.cmakeTools.folder.uri).update('useCMakePresets', false);
    } else {
      vscode.workspace.openTextDocument(vscode.Uri.file(file));
    }
  }

  dispose() {
    if (this._cmakePresetsWatcher) {
      this._cmakePresetsWatcher.close();
    }
    if (this._cmakeUserPresetsWatcher) {
      this._cmakeUserPresetsWatcher.close();
    }
    util.disposeAll(this._subscriptions);
  }
}
