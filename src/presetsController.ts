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
import rollbar from './rollbar';

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
  private _presetsWatcher: chokidar.FSWatcher | undefined;
  private _userPresetsWatcher: chokidar.FSWatcher | undefined;
  private _presetsFile: PresetsFile | undefined;
  private _userPresetsFile: PresetsFile | undefined;

  private readonly _presetsPath: string;
  private readonly _userPresetsPath: string;
  private readonly _presetsChangedEmitter = new vscode.EventEmitter<PresetsFile>();
  private readonly _userPresetsChangedEmitter = new vscode.EventEmitter<PresetsFile>();
  private readonly _subscriptions: vscode.Disposable[] = [
    this._presetsChangedEmitter,
    this._userPresetsChangedEmitter
  ]

  static async init(cmakeTools: CMakeTools): Promise<PresetsController> {
    const presetsController = new PresetsController(cmakeTools);

    presetsController._presetsWatcher = chokidar.watch(presetsController._presetsPath)
                                  .on('add', async () => {
                                    presetsController._presetsFile = await presetsController.readPresetsFile(presetsController._presetsPath);
                                    presetsController._presetsChangedEmitter.fire();
                                  })
                                  .on('change', async () => {
                                    presetsController._presetsFile = await presetsController.readPresetsFile(presetsController._presetsPath);
                                    presetsController._presetsChangedEmitter.fire();
                                  })
                                  .on('unlink', async () => {
                                    presetsController._presetsFile = await presetsController.readPresetsFile(presetsController._presetsPath);
                                    presetsController._presetsChangedEmitter.fire();
                                  });
    presetsController._userPresetsWatcher = chokidar.watch(presetsController._userPresetsPath)
                                      .on('add', async () => {
                                        presetsController._userPresetsFile = await presetsController.readPresetsFile(presetsController._userPresetsPath);
                                        presetsController._userPresetsChangedEmitter.fire();
                                      })
                                      .on('change', async () => {
                                        presetsController._userPresetsFile = await presetsController.readPresetsFile(presetsController._userPresetsPath);
                                        presetsController._userPresetsChangedEmitter.fire();
                                      })
                                      .on('unlink', async () => {
                                        presetsController._userPresetsFile = await presetsController.readPresetsFile(presetsController._userPresetsPath);
                                        presetsController._userPresetsChangedEmitter.fire();
                                      });

    return presetsController;
  }

  private constructor(private readonly cmakeTools: CMakeTools) {
    this._presetsPath = path.join(cmakeTools.folder.uri.fsPath, 'CMakePresets.json');
    this._userPresetsPath = path.join(cmakeTools.folder.uri.fsPath, 'CMakeUserPresets.json');
  }

  get cmakePresetsExist() { return !!this._presetsFile; }

  get cmakeUserPresetsExist() { return !!this._userPresetsFile; }

  get configurePresets() { return this._presetsFile?.configurePresets || []; }

  get userConfigurePresets() { return this._userPresetsFile?.configurePresets || []; }

  get allConfigurePresets() { return this.configurePresets.concat(this.userConfigurePresets); }

  get buildPresets() { return this._presetsFile?.buildPresets || []; }

  get userBuildPresets() { return this._userPresetsFile?.buildPresets || []; }

  get allBuildPresets() { return this.buildPresets.concat(this.userBuildPresets); }

  get testPresets() { return this._presetsFile?.testPresets || []; }

  get userTestPresets() { return this._userPresetsFile?.testPresets || []; }

  get allTestPresets() { return this.testPresets.concat(this.userTestPresets); }

  get folder() { return this.cmakeTools.folder; }

  /**
   * Call configurePresets, buildPresets, or testPresets to get the latest presets when thie event is fired.
   */
  onPresetsChanged(listener: () => any) { return this._presetsChangedEmitter.event(listener); }

  /**
   * Call configurePresets, buildPresets, or testPresets to get the latest presets when thie event is fired.
   */
  onUserPresetsChanged(listener: () => any) { return this._userPresetsChangedEmitter.event(listener); }

  async addConfigurePreset(): Promise<boolean> {
    interface AddPresetQuickPickItem extends vscode.QuickPickItem {
      name: string;
    }

    enum SpecialOptions {
      ScanForCompilers = '__scanForCompilers__',
      InheritConfigurationPreset = '__inheritConfigurationPreset__',
      ToolchainFile = '__toolchainFile__',
      Custom = '__custom__'
    }

    const items: AddPresetQuickPickItem[] = [];
    if (this.configurePresets.length > 0) {
      items.push({
        name: SpecialOptions.InheritConfigurationPreset,
        label: localize('inherit.config.preset', 'Inherit from Configure Preset'),
        description: localize('description.inherit.config.preset', 'Inherit from an existing configure preset')
      });
    }
    items.push({
      name: SpecialOptions.ToolchainFile,
      label: localize('toolchain.file', 'Toolchain File'),
      description: localize('description.toolchain.file', 'Configure with a CMake toolchain file')
    }, {
      name: SpecialOptions.Custom,
      label: localize('custom.config.preset', 'Custom'),
      description: localize('description.custom.config.preset', 'Add an custom configure preset')
    }, {
      name: SpecialOptions.ScanForCompilers,
      label: localize('scan.for.compilers', '[Scan for Compilers]'),
      description: localize('description.scan.for.compilers', 'Search for compilers on this computer')
    });

    const chosenItem = await vscode.window.showQuickPick(items,
      { placeHolder: localize('add.a.config.preset.placeholder', 'Add a configure preset for {0}', this.folder.name) });
    if (!chosenItem) {
      log.debug(localize('user.cancelled.add.config.preset', 'User cancelled adding configure preset'));
      return false;
    } else {
      switch(chosenItem.name) {
        case SpecialOptions.ScanForCompilers:
          break;
        case SpecialOptions.InheritConfigurationPreset:
          break;
        case SpecialOptions.ToolchainFile:
          break;
        case SpecialOptions.Custom:
          break;
        default:
          break;
      }
      return true;
    }
  }

  private async handleNoConfigurePresets(): Promise<boolean> {
    const yes = localize('yes', 'Yes');
    const no = localize('no', 'No');
    const result = await vscode.window.showWarningMessage(
      localize('no.config.preset', "No Configure Presets exist. Would you like to add a Configure Preset?"), yes, no);
    if (result === yes) {
      return this.addConfigurePreset();
    } else {
      log.error(localize('error.no.config.preset', 'No configure presets exist.'));
      return false;
    }

  }

  async addBuildPreset(): Promise<boolean> {
    if (this.configurePresets.length === 0) {
      return this.handleNoConfigurePresets();
    }

    interface AddPresetQuickPickItem extends vscode.QuickPickItem {
      name: string;
    }

    enum SpecialOptions {
      CreateFromConfigurationPreset = '__createFromConfigurationPreset__',
      InheritBuildPreset = '__inheritBuildPreset__',
      Custom = '__custom__'
    }

    const items: AddPresetQuickPickItem[] = [{
        name: SpecialOptions.CreateFromConfigurationPreset,
        label: localize('create.build.from.config.preset', 'Create from Configure Preset'),
        description: localize('description.create.build.from.config.preset', 'Create a new build preset')
    }];
    if (this.buildPresets.length > 0) {
      items.push({
        name: SpecialOptions.InheritBuildPreset,
        label: localize('inherit.build.preset', 'Inherit from Build Preset'),
        description: localize('description.inherit.build.preset', 'Inherit from an existing build preset')
      });
    }
    items.push({
      name: SpecialOptions.Custom,
      label: localize('custom.build.preset', 'Custom'),
      description: localize('description.custom.build.preset', 'Add an custom build preset')
    });

    const chosenItem = await vscode.window.showQuickPick(items,
      { placeHolder: localize('add.a.build.preset.placeholder', 'Add a build preset for {0}', this.folder.name) });
    if (!chosenItem) {
      log.debug(localize('user.cancelled.add.build.preset', 'User cancelled adding build preset'));
      return false;
    } else {
      switch(chosenItem.name) {
        case SpecialOptions.CreateFromConfigurationPreset:
          break;
        case SpecialOptions.InheritBuildPreset:
          break;
        case SpecialOptions.Custom:
          break;
        default:
          break;
      }
      return true;
    }
  }

  async addTestPreset(): Promise<boolean> {
    if (this.configurePresets.length === 0) {
      return this.handleNoConfigurePresets();
    }

    interface AddPresetQuickPickItem extends vscode.QuickPickItem {
      name: string;
    }

    enum SpecialOptions {
      CreateFromConfigurationPreset = '__createFromConfigurationPreset__',
      InheritTestPreset = '__inheritTestPreset__',
      Custom = '__custom__'
    }

    const items: AddPresetQuickPickItem[] = [{
      name: SpecialOptions.CreateFromConfigurationPreset,
      label: localize('create.test.from.config.preset', 'Create from Configure Preset'),
      description: localize('description.create.test.from.config.preset', 'Create a new test preset')
    }];
    if (this.testPresets.length > 0) {
      items.push({
        name: SpecialOptions.InheritTestPreset,
        label: localize('inherit.test.preset', 'Inherit from Test Preset'),
        description: localize('description.inherit.test.preset', 'Inherit from an existing test preset')
      });
    }
    items.push({
      name: SpecialOptions.Custom,
      label: localize('custom.test.preset', 'Custom'),
      description: localize('description.custom.test.preset', 'Add an custom test preset')
    });

    const chosenItem = await vscode.window.showQuickPick(items,
      { placeHolder: localize('add.a.test.preset.placeholder', 'Add a test preset for {0}', this.folder.name) });
    if (!chosenItem) {
      log.debug(localize('user.cancelled.add.test.preset', 'User cancelled adding test preset'));
      return false;
    } else {
      switch(chosenItem.name) {
        case SpecialOptions.CreateFromConfigurationPreset:
          break;
        case SpecialOptions.InheritTestPreset:
          break;
        case SpecialOptions.Custom:
          break;
        default:
          break;
      }
      return true;
    }
  }

  async selectConfigurePreset(): Promise<boolean> {
    const presets = this.allConfigurePresets;
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
    items.push({
      label: localize('add.config.preset', 'Add Configure Preset...'),
      description: localize('description.add.config.preset', 'Add a new configure preset'),
      preset: { name: '__addPreset__' }
    });
    const chosenPreset = await vscode.window.showQuickPick(items,
                                                            { placeHolder: localize('select.a.config.preset.placeholder', 'Select a configure preset for {0}', this.folder.name) });
    if (!chosenPreset) {
      log.debug(localize('user.cancelled.config.preset.selection', 'User cancelled configure preset selection'));
      return false;
    } else if (chosenPreset.preset.name === '__addPreset__') {
      return this.addConfigurePreset();
    } else {
      log.debug(localize('user.selected.config.preset', 'User selected configure preset {0}', JSON.stringify(chosenPreset)));
      this.cmakeTools.configurePreset = chosenPreset.preset;
      // await this.setFolderConfigurePreset(chosenPreset.preset);
      return true;
    }
  }

  async selectBuildPreset(): Promise<boolean> {
    const presets = this.allBuildPresets;

    log.debug(localize('start.selection.of.build.presets', 'Start selection of build presets. Found {0} presets.', presets.length));

    interface PresetItem extends vscode.QuickPickItem {
      preset: BuildPreset;
    }
    log.debug(localize('opening.build.preset.selection', 'Opening build preset selection QuickPick'));
    const items: PresetItem[] = presets.map(
        preset => ({
          label: preset.displayName || preset.name,
          description: preset.description,
          preset,
        }),
    );
    items.push({
      label: localize('add.build.preset', 'Add Build Preset...'),
      description: localize('description.add.build.preset', 'Add a new build preset'),
      preset: { name: '__addPreset__' }
    });
    const chosenPreset = await vscode.window.showQuickPick(items,
                                                            { placeHolder: localize('select.a.build.preset.placeholder', 'Select a configure preset for {0}', this.folder.name) });
    if (!chosenPreset) {
      log.debug(localize('user.cancelled.build.preset.selection', 'User cancelled build preset selection'));
      return false;
    } else if (chosenPreset.preset.name === '__addPreset__') {
      return this.addBuildPreset();
    } else {
      log.debug(localize('user.selected.build.preset', 'User selected build preset {0}', JSON.stringify(chosenPreset)));
      this.cmakeTools.buildPreset = chosenPreset.preset;
      // await this.setFolderBuildPreset(chosenPreset.preset);
      return true;
    }
  }

  async selectTestPreset(): Promise<boolean> {
    const presets = this.allTestPresets;

    log.debug(localize('start.selection.of.test.presets', 'Start selection of test presets. Found {0} presets.', presets.length));

    interface PresetItem extends vscode.QuickPickItem {
      preset: TestPreset;
    }
    log.debug(localize('opening.test.preset.selection', 'Opening test preset selection QuickPick'));
    const items: PresetItem[] = presets.map(
        preset => ({
          label: preset.displayName || preset.name,
          description: preset.description,
          preset,
        }),
    );
    items.push({
      label: localize('add.test.preset', 'Add Test Preset...'),
      description: localize('description.add.test.preset', 'Add a new test preset'),
      preset: { name: '__addPreset__' }
    });
    const chosenPreset = await vscode.window.showQuickPick(items,
                                                            {placeHolder: localize('select.a.test.preset.placeholder', 'Select a configure preset for {0}', this.folder.name)});
    if (!chosenPreset) {
      log.debug(localize('user.cancelled.test.preset.selection', 'User cancelled test preset selection'));
      return false;
    } else if (chosenPreset.preset.name === '__addPreset__') {
      return this.addTestPreset();
    } else {
      log.debug(localize('user.selected.test.preset', 'User selected test preset {0}', JSON.stringify(chosenPreset)));
      this.cmakeTools.testPreset = chosenPreset.preset;
      // await this.setFolderTestPreset(chosenPreset.preset);
      return true;
    }
  }

  openCMakePresets(): Thenable<vscode.TextDocument> {
    return vscode.workspace.openTextDocument(this._presetsPath);
  }

  openCMakeUserPresets(): Thenable<vscode.TextDocument> {
    return vscode.workspace.openTextDocument(this._userPresetsPath);
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

  private async updatePresetsFile(presetsFile: PresetsFile, isUserPresets = false): Promise<boolean> {
    const presetsFilePath = isUserPresets? this._userPresetsPath : this._presetsPath;
    try {
        await fs.writeFile(presetsFilePath, JSON.stringify(presetsFile));
    } catch (e) {
      rollbar.exception(localize('failed.writing.to.file', 'Failed writing to file {0}', presetsFilePath), e);
      return false;
    }

    return true;
  }

  dispose() {
    if (this._presetsWatcher) {
      this._presetsWatcher.close();
    }
    if (this._userPresetsWatcher) {
      this._userPresetsWatcher.close();
    }
    util.disposeAll(this._subscriptions);
  }
}
