import * as chokidar from 'chokidar';
import * as json5 from 'json5';
import * as path from 'path';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';

import { CMakeTools } from '@cmt/cmake-tools';
import * as logging from '@cmt/logging';
import { fs } from '@cmt/pr';
import * as preset from '@cmt/preset';
import * as util from '@cmt/util';
import rollbar from '@cmt/rollbar';
import { expandString, ExpansionOptions } from '@cmt/expand';
import paths from '@cmt/paths';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('presetController');

export class PresetsController {
  private _presetsWatcher: chokidar.FSWatcher | undefined;
  private _userPresetsWatcher: chokidar.FSWatcher | undefined;
  private _sourceDir: string = '';
  private _sourceDirChangedSub: vscode.Disposable | undefined;

  static async init(cmakeTools: CMakeTools): Promise<PresetsController> {
    const presetsController = new PresetsController(cmakeTools);

    const expandSourceDir = async (dir: string) => {
      const workspaceFolder = cmakeTools.folder.uri.fsPath;
      const expansionOpts: ExpansionOptions = {
        vars: {
          workspaceFolder,
          workspaceFolderBasename: path.basename(workspaceFolder),
          workspaceHash: util.makeHashString(workspaceFolder),
          workspaceRoot: workspaceFolder,
          workspaceRootFolderName: path.dirname(workspaceFolder),
          userHome: paths.userHome,
          // Following fields are not supported for sourceDir expansion
          generator: '${generator}',
          sourceDir: '${sourceDir}',
          sourceParentDir: '${sourceParentDir}',
          sourceDirName: '${sourceDirName}',
          presetName: '${presetName}'
        }
      };
      return util.normalizeAndVerifySourceDir(await expandString(dir, expansionOpts));
    };

    presetsController._sourceDir = await expandSourceDir(cmakeTools.workspaceContext.config.sourceDirectory);

    // Need to reapply presets every time presets changed since the binary dir or cmake path could change
    // (need to clean or reload driver)
    const reapplyPresets = async () => {
      // Reset all changes due to expansion since parents could change
      preset.setPresetsFile(await presetsController.readPresetsFile(presetsController.presetsPath));
      preset.setUserPresetsFile(await presetsController.readPresetsFile(presetsController.userPresetsPath));

      if (cmakeTools.configurePreset) {
        await presetsController.setConfigurePreset(cmakeTools.configurePreset);
      }
      if (cmakeTools.buildPreset) {
        await presetsController.setBuildPreset(cmakeTools.buildPreset);
      }
    };

    const watchPresetsChange = async () => {
      // We explicitly read presets file here, instead of on the initialization of the file watcher. Otherwise
      // there might be timing issues, since listeners are invoked async.
      preset.setPresetsFile(await presetsController.readPresetsFile(presetsController.presetsPath));
      preset.setUserPresetsFile(await presetsController.readPresetsFile(presetsController.userPresetsPath));

      if (presetsController._presetsWatcher) {
        presetsController._presetsWatcher.close().then(() => {}, () => {});
      }
      if (presetsController._userPresetsWatcher) {
        presetsController._userPresetsWatcher.close().then(() => {}, () => {});
      }

      presetsController._presetsWatcher = chokidar.watch(presetsController.presetsPath, { ignoreInitial: true })
                                    .on('add', async () => {
                                      preset.setPresetsFile(await presetsController.readPresetsFile(presetsController.presetsPath));
                                    })
                                    .on('change', async () => {
                                      await reapplyPresets();
                                    })
                                    .on('unlink', async () => {
                                      preset.setPresetsFile(await presetsController.readPresetsFile(presetsController.presetsPath));
                                    });
      presetsController._userPresetsWatcher = chokidar.watch(presetsController.userPresetsPath, { ignoreInitial: true })
                                        .on('add', async () => {
                                          preset.setUserPresetsFile(await presetsController.readPresetsFile(presetsController.userPresetsPath));
                                        })
                                        .on('change', async () => {
                                          await reapplyPresets();
                                        })
                                        .on('unlink', async () => {
                                          preset.setUserPresetsFile(await presetsController.readPresetsFile(presetsController.userPresetsPath));
                                        });
    };

    await watchPresetsChange();

    presetsController._sourceDirChangedSub = cmakeTools.workspaceContext.config.onChange('sourceDirectory', async value => {
      const oldSourceDir = presetsController._sourceDir;
      presetsController._sourceDir = await expandSourceDir(value);

      if (presetsController._sourceDir !== oldSourceDir) {
        await watchPresetsChange();
      }
    });

    return presetsController;
  }

  private constructor(private readonly _cmakeTools: CMakeTools) { }

  get presetsPath() { return path.join(this._sourceDir, 'CMakePresets.json'); }

  get userPresetsPath() { return path.join(this._sourceDir, 'CMakeUserPresets.json'); }

  get folder() { return this._cmakeTools.folder; }

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
    if (preset.configurePresets().length > 0) {
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
    if (preset.configurePresets().length === 0) {
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
    if (preset.buildPresets().length > 0) {
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
    if (preset.configurePresets().length === 0) {
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
    if (preset.testPresets().length > 0) {
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
    const presets = preset.configurePresets();
    const userPresets = preset.userConfigurePresets();
    if (presets.length === 0 && userPresets.length === 0) {
      return false;
    }

    log.debug(localize('start.selection.of.config.presets', 'Start selection of configure presets. Found {0} presets.', presets.length + userPresets.length));

    interface PresetItem extends vscode.QuickPickItem {
      preset: string;
      isUserPreset: boolean;
    }
    log.debug(localize('opening.config.preset.selection', 'Opening configure preset selection QuickPick'));
    let items: PresetItem[] = presets.map(
        _preset => ({
          label: _preset.displayName || _preset.name,
          description: _preset.description,
          preset: _preset.name,
          isUserPreset: false
        }),
    );
    items = items.concat(userPresets.map(
      _preset => ({
        label: _preset.displayName || _preset.name,
        description: _preset.description,
        preset: _preset.name,
        isUserPreset: true
      }),
    ));
    items.push({
      label: localize('add.config.preset', 'Add Configure Preset...'),
      description: localize('description.add.config.preset', 'Add a new configure preset'),
      preset: '__addPreset__',
      isUserPreset: false
    });
    const chosenPreset = await vscode.window.showQuickPick(items,
                                                            { placeHolder: localize('select.a.config.preset.placeholder', 'Select a configure preset for {0}', this.folder.name) });
    if (!chosenPreset) {
      log.debug(localize('user.cancelled.config.preset.selection', 'User cancelled configure preset selection'));
      return false;
    } else if (chosenPreset.preset === '__addPreset__') {
      return this.addConfigurePreset();
    } else {
      log.debug(localize('user.selected.config.preset', 'User selected configure preset {0}', JSON.stringify(chosenPreset)));
      await this.setConfigurePreset(chosenPreset.preset);
      return true;
    }
  }

  async setConfigurePreset(presetName: string): Promise<void> {
    // Load the configure preset into the backend
    await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: localize('loading.config.preset', 'Loading configure preset {0}', presetName),
        },
        () => this._cmakeTools.setConfigurePreset(presetName),
    );
  }

  private async checkConfigurePreset(): Promise<string | null> {
    const selectedConfigurePreset = this._cmakeTools.configurePreset;
    if (!selectedConfigurePreset) {
      const message_noConfigurePreset = localize('config.preset.required', 'A configure preset needs to be selected. How would you like to proceed?');
      const option_selectConfigurePreset = localize('select.config.preset', 'Select configure preset');
      const option_later = localize('later', 'later');
      const result = await vscode.window.showErrorMessage(message_noConfigurePreset, option_selectConfigurePreset, option_later);
      if (result === option_selectConfigurePreset && await vscode.commands.executeCommand('cmake.selectConfigurePreset')) {
        return this._cmakeTools.configurePreset;
      }
    }
    return selectedConfigurePreset;
  }

  async selectBuildPreset(): Promise<boolean> {
    preset.expandConfigurePresetForPresets('build');
    const presets = preset.buildPresets();
    const userPresets = preset.userBuildPresets();

    log.debug(localize('start.selection.of.build.presets', 'Start selection of build presets. Found {0} presets.', presets.length + userPresets.length));

    // configure preset required
    const selectedConfigurePreset = await this.checkConfigurePreset();
    if (!selectedConfigurePreset) {
      return false;
    }

    interface PresetItem extends vscode.QuickPickItem {
      preset: string;
      isUserPreset: boolean;
    }
    log.debug(localize('opening.build.preset.selection', 'Opening build preset selection QuickPick'));
    const items: PresetItem[] = presets.filter(_preset => _preset.configurePreset === selectedConfigurePreset).map(
      _preset => ({
          label: _preset.displayName || _preset.name,
          description: _preset.description,
          preset: _preset.name,
          isUserPreset: false
        }),
    );
    items.concat(userPresets.filter(_preset => _preset.configurePreset === selectedConfigurePreset).map(
      _preset => ({
        label: _preset.displayName || _preset.name,
        description: _preset.description,
        preset: _preset.name,
        isUserPreset: true
      }),
    ));
    items.push({
      label: localize('add.build.preset', 'Add Build Preset...'),
      description: localize('description.add.build.preset', 'Add a new build preset'),
      preset: '__addPreset__',
      isUserPreset: false
    });
    const chosenPreset = await vscode.window.showQuickPick(items,
                                                            { placeHolder: localize('select.a.build.preset.placeholder', 'Select a configure preset for {0}', this.folder.name) });
    if (!chosenPreset) {
      log.debug(localize('user.cancelled.build.preset.selection', 'User cancelled build preset selection'));
      return false;
    } else if (chosenPreset.preset === '__addPreset__') {
      return this.addBuildPreset();
    } else {
      log.debug(localize('user.selected.build.preset', 'User selected build preset {0}', JSON.stringify(chosenPreset)));
      await this.setBuildPreset(chosenPreset.preset);
      return true;
    }
  }

  async setBuildPreset(presetName: string): Promise<void> {
    // Load the build preset into the backend
    await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: localize('loading.build.preset', 'Loading build preset {0}', presetName),
        },
        () => this._cmakeTools.setBuildPreset(presetName),
    );
  }

  async selectTestPreset(): Promise<boolean> {
    preset.expandConfigurePresetForPresets('test');
    const presets = preset.testPresets();
    const userPresets = preset.userTestPresets();

    log.debug(localize('start.selection.of.test.presets', 'Start selection of test presets. Found {0} presets.', presets.length));

    // configure preset required
    const selectedConfigurePreset = await this.checkConfigurePreset();
    if (!selectedConfigurePreset) {
      return false;
    }

    interface PresetItem extends vscode.QuickPickItem {
      preset: string;
      isUserPreset: boolean;
    }
    log.debug(localize('opening.test.preset.selection', 'Opening test preset selection QuickPick'));
    const items: PresetItem[] = presets.filter(_preset => _preset.configurePreset === selectedConfigurePreset).map(
      _preset => ({
          label: _preset.displayName || _preset.name,
          description: _preset.description,
          preset: _preset.name,
          isUserPreset: false
        }),
    );
    items.concat(userPresets.filter(_preset => _preset.configurePreset === selectedConfigurePreset).map(
      _preset => ({
        label: _preset.displayName || _preset.name,
        description: _preset.description,
        preset: _preset.name,
        isUserPreset: true
      }),
    ));
    items.push({
      label: localize('add.test.preset', 'Add Test Preset...'),
      description: localize('description.add.test.preset', 'Add a new test preset'),
      preset: '__addPreset__',
      isUserPreset: false
    });
    const chosenPreset = await vscode.window.showQuickPick(items,
                                                            {placeHolder: localize('select.a.test.preset.placeholder', 'Select a configure preset for {0}', this.folder.name)});
    if (!chosenPreset) {
      log.debug(localize('user.cancelled.test.preset.selection', 'User cancelled test preset selection'));
      return false;
    } else if (chosenPreset.preset === '__addPreset__') {
      return this.addTestPreset();
    } else {
      log.debug(localize('user.selected.test.preset', 'User selected test preset {0}', JSON.stringify(chosenPreset)));
      await this.setTestPreset(chosenPreset.preset);
      return true;
    }
  }

  async setTestPreset(presetName: string): Promise<void> {
    // Load the test preset into the backend
    await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: localize('loading.test.preset', 'Loading test preset {0}', presetName),
        },
        () => this._cmakeTools.setTestPreset(presetName),
    );
  }

  openCMakePresets(): Thenable<vscode.TextEditor> {
    return vscode.window.showTextDocument(vscode.Uri.file(this.presetsPath));
  }

  openCMakeUserPresets(): Thenable<vscode.TextEditor> {
    return vscode.window.showTextDocument(vscode.Uri.file(this.userPresetsPath));
  }

  private async readPresetsFile(file: string): Promise<preset.PresetsFile | undefined> {
    if (!await fs.exists(file)) {
      return undefined;
    }
    log.debug(localize('reading.presets.file', 'Reading presets file {0}', file));
    const presetsFileStr = await fs.readFile(file);
    let presetsFile: preset.PresetsFile;
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
      return undefined;
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

  async updatePresetsFile(presetsFile: preset.PresetsFile, isUserPresets = false): Promise<boolean> {
    const presetsFilePath = isUserPresets? this.userPresetsPath : this.presetsPath;
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
      this._presetsWatcher.close().then(() => {}, () => {});
    }
    if (this._userPresetsWatcher) {
      this._userPresetsWatcher.close().then(() => {}, () => {});
    }
    if (this._sourceDirChangedSub) {
      this._sourceDirChangedSub.dispose();
    }
  }
}
