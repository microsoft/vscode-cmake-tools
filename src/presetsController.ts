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

const log = logging.createLogger('preset');

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
  private _userConfigurePresets: ConfigurePreset[] = [];
  private _buildPresets: BuildPreset[] = [];
  private _userBuildPresets: BuildPreset[] = [];
  private _testPresets: TestPreset[] = [];
  private _userTestPresets:TestPreset[] = [];

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
      presetsController._userConfigurePresets = userPresetsFile?.configurePresets || [];
      presetsController._userBuildPresets = userPresetsFile?.buildPresets || [];
      presetsController._userTestPresets = userPresetsFile?.testPresets || [];
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

  get cmakePresetsExist() { return this._cmakePresetsExist; }

  get cmakeUserPresetsExist() { return this._cmakeUserPresetsExist; }

  get configurePresets() { return this._configurePresets.concat(this._userConfigurePresets); }

  get buildPresets() { return this._buildPresets.concat(this._userBuildPresets); }

  get testPresets() { return this._testPresets.concat(this._userTestPresets); }

  get folder() { return this.cmakeTools.folder; }

  /**
   * Call configurePresets, buildPresets, or testPresets to get the latest presets when thie event is fired.
   */
  onPresetsChanged(listener: () => any) { return this._cmakePresetsChangedEmitter.event(listener); }

  /**
   * Call configurePresets, buildPresets, or testPresets to get the latest presets when thie event is fired.
   */
  onUserPresetsChanged(listener: () => any) { return this._cmakeUserPresetsChangedEmitter.event(listener); }

  async selectConfigurePreset(): Promise<boolean> {
    const presets = this.configurePresets;
    if (presets.length === 0) {
      return false;
    }

    log.debug(localize('start.selection.of.config.presets', 'Start selection of configure presets. Found {0} presets.', presets.length));

    interface PresetItem extends vscode.QuickPickItem {
      preset: ConfigurePreset;
    }
    log.debug(localize('opening.config.preset.selection', 'Opening configure preset selection QuickPick'));
    const items: PresetItem[] = presets.map(
        preset => ({
          label: preset.displayName || preset.name,
          description: preset.description,
          preset,
        }),
    );
    const chosen_preset = await vscode.window.showQuickPick(items,
                                                            {placeHolder: localize('select.a.config.preset.placeholder', 'Select a configure preset for {0}', this.folder.name)});
    if (chosen_preset === undefined) {
      log.debug(localize('user.cancelled.config.preset.selection', 'User cancelled configure preset selection'));
      return false;
    } else {
      log.debug(localize('user.selected.config.preset', 'User selected configure preset {0}', JSON.stringify(chosen_preset)));
      this.cmakeTools.configurePreset = chosen_preset.preset;
      // await this.setFolderConfigurePreset(chosen_preset.preset);
      return true;
    }
  }

  async selectBuildPreset(): Promise<boolean> {
    const presets = this.buildPresets;
    if (presets.length === 0) {
      return false;
    }

    log.debug(localize('start.selection.of.build.presets', 'Start selection of build presets. Found {0} presets.', presets.length));

    interface PresetItem extends vscode.QuickPickItem {
      preset: BuildPreset;
    }
    log.debug(localize('opening.build.preset.selection', 'Opening build preset selection QuickPick'));
    const items: PresetItem[] = presets.map(
        preset => ({
          label: preset.displayName,
          description: preset.description,
          preset,
        }),
    );
    const chosen_preset = await vscode.window.showQuickPick(items,
                                                            {placeHolder: localize('select.a.build.preset.placeholder', 'Select a configure preset for {0}', this.folder.name)});
    if (chosen_preset === undefined) {
      log.debug(localize('user.cancelled.build.preset.selection', 'User cancelled build preset selection'));
      return false;
    } else {
      log.debug(localize('user.selected.build.preset', 'User selected build preset {0}', JSON.stringify(chosen_preset)));
      this.cmakeTools.buildPreset = chosen_preset.preset;
      // await this.setFolderBuildPreset(chosen_preset.preset);
      return true;
    }
  }

  async selectTestPreset(): Promise<boolean> {
    const presets = this.testPresets;
    if (presets.length === 0) {
      return false;
    }

    log.debug(localize('start.selection.of.test.presets', 'Start selection of test presets. Found {0} presets.', presets.length));

    interface PresetItem extends vscode.QuickPickItem {
      preset: TestPreset;
    }
    log.debug(localize('opening.test.preset.selection', 'Opening test preset selection QuickPick'));
    const items: PresetItem[] = presets.map(
        preset => ({
          label: preset.displayName,
          description: preset.description,
          preset,
        }),
    );
    const chosen_preset = await vscode.window.showQuickPick(items,
                                                            {placeHolder: localize('select.a.test.preset.placeholder', 'Select a configure preset for {0}', this.folder.name)});
    if (chosen_preset === undefined) {
      log.debug(localize('user.cancelled.test.preset.selection', 'User cancelled test preset selection'));
      return false;
    } else {
      log.debug(localize('user.selected.test.preset', 'User selected test preset {0}', JSON.stringify(chosen_preset)));
      this.cmakeTools.testPreset = chosen_preset.preset;
      // await this.setFolderTestPreset(chosen_preset.preset);
      return true;
    }
  }

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
      vscode.workspace.getConfiguration('cmake', this.folder.uri).update('useCMakePresets', false);
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
