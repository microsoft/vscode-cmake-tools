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
import { KitsController } from '@cmt/kitsController';
import { descriptionForKit, Kit, SpecialKits } from '@cmt/kit';
import { loadSchema } from '@cmt/schema';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('presetController');

export class PresetsController {
  private _presetsWatcher: chokidar.FSWatcher | undefined;
  private _userPresetsWatcher: chokidar.FSWatcher | undefined;
  private _sourceDir: string = '';
  private _sourceDirChangedSub: vscode.Disposable | undefined;
  private _presetsFileExists = false;
  private _userPresetsFileExists = false;

  private static readonly _addPreset = '__addPreset__';

  static async init(cmakeTools: CMakeTools, kitsController: KitsController): Promise<PresetsController> {
    const presetsController = new PresetsController(cmakeTools, kitsController);

    preset.setCompilers(kitsController.availableKits);

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

    type SetPresetsFileFunc = (presets: preset.PresetsFile | undefined) => void;
    const resetPresetsFile = async (file: string,
                                    setPresetsFile: SetPresetsFileFunc,
                                    setOriginalPresetsFile: SetPresetsFileFunc,
                                    fileExistCallback: (fileExists: boolean) => void) => {
      const presetsFileBuffer = await presetsController.readPresetsFile(file);

      // There might be a better location for this, but for now this is the best one...
      fileExistCallback(Boolean(presetsFileBuffer));

      let presetsFile = await presetsController.parsePresetsFile(presetsFileBuffer, file);
      presetsFile = await presetsController.validatePresetsFile(presetsFile, file);
      setPresetsFile(presetsFile);
      // Parse again so we automatically have a copy by value
      setOriginalPresetsFile(await presetsController.parsePresetsFile(presetsFileBuffer, file));
    };

    // Need to reapply presets every time presets changed since the binary dir or cmake path could change
    // (need to clean or reload driver)
    const reapplyPresets = async () => {
      // Reset all changes due to expansion since parents could change
      await resetPresetsFile(presetsController.presetsPath,
                             preset.setPresetsFile,
                             preset.setOriginalPresetsFile,
                             exists => presetsController._presetsFileExists = exists);
      await resetPresetsFile(presetsController.userPresetsPath,
                             preset.setUserPresetsFile,
                             preset.setOriginalUserPresetsFile,
                             exists => presetsController._userPresetsFileExists = exists);

      if (cmakeTools.configurePreset) {
        await presetsController.setConfigurePreset(cmakeTools.configurePreset.name);
      }
      if (cmakeTools.buildPreset) {
        await presetsController.setBuildPreset(cmakeTools.buildPreset.name);
      }
      if (cmakeTools.testPreset) {
        await presetsController.setTestPreset(cmakeTools.testPreset.name);
      }
    };

    const watchPresetsChange = async () => {
      // We explicitly read presets file here, instead of on the initialization of the file watcher. Otherwise
      // there might be timing issues, since listeners are invoked async.
      await reapplyPresets();

      if (presetsController._presetsWatcher) {
        presetsController._presetsWatcher.close().then(() => {}, () => {});
      }
      if (presetsController._userPresetsWatcher) {
        presetsController._userPresetsWatcher.close().then(() => {}, () => {});
      }

      presetsController._presetsWatcher = chokidar.watch(presetsController.presetsPath, { ignoreInitial: true })
                                    .on('add', async () => {
                                      await reapplyPresets();
                                    })
                                    .on('change', async () => {
                                      await reapplyPresets();
                                    })
                                    .on('unlink', async () => {
                                      await reapplyPresets();
                                    });
      presetsController._userPresetsWatcher = chokidar.watch(presetsController.userPresetsPath, { ignoreInitial: true })
                                        .on('add', async () => {
                                          await reapplyPresets();
                                        })
                                        .on('change', async () => {
                                          await reapplyPresets();
                                        })
                                        .on('unlink', async () => {
                                          await reapplyPresets();
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

  private constructor(private readonly _cmakeTools: CMakeTools, private readonly _kitsController: KitsController) { }

  get presetsPath() { return path.join(this._sourceDir, 'CMakePresets.json'); }

  get userPresetsPath() { return path.join(this._sourceDir, 'CMakeUserPresets.json'); }

  get folder() { return this._cmakeTools.folder; }

  get presetsFileExist() { return this._presetsFileExists || this._userPresetsFileExists; }

  private showNameInputBox() {
    return vscode.window.showInputBox({ placeHolder: localize('preset.name', 'Preset name') });
  }

  private getOsName() {
    const platmap = {
      win32: 'Windows',
      darwin: 'macOS',
      linux: 'Linux',
    } as {[k: string]: preset.OsName};
    return platmap[process.platform];
  }

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
      const name = await this.showNameInputBox();
      if (!name) {
        return false;
      }

      switch(chosenItem.name) {
        case SpecialOptions.ScanForCompilers: {
          // Check that we have kits
          if (!await this._kitsController.checkHaveKits()) {
            return false;
          }

          const avail = this._kitsController.availableKits;
          log.debug(localize('start.selection.of.compilers', 'Start selection of compilers. Found {0} compilers.', avail.length));

          interface KitItem extends vscode.QuickPickItem {
            kit: Kit;
          }
          log.debug(localize('opening.compiler.selection', 'Opening compiler selection QuickPick'));
          // Generate the quickpick items from our known kits
          const getKitName = (kit: Kit) => {
            switch (kit.name) {
            case SpecialKits.ScanForKits as string:
              return `[${localize('scan.for.compilers.button', 'Scan for compilers')}]`;
            default:
              return kit.name;
            }
          };
          const item_promises = avail.filter(kit => kit.name !== SpecialKits.Unspecified).map(
              async (kit): Promise<KitItem> => ({
                label: getKitName(kit),
                description: await descriptionForKit(kit),
                kit,
              }),
          );
          const quickPickItems = await Promise.all(item_promises);
          const chosen_kit = await vscode.window.showQuickPick(quickPickItems,
                                                               {placeHolder: localize('select.a.compiler.placeholder', 'Select a Kit for {0}', this.folder.name)});
          if (chosen_kit === undefined) {
            log.debug(localize('user.cancelled.compiler.selection', 'User cancelled compiler selection'));
            // No selection was made
            return false;
          } else {
            if (chosen_kit.kit.name == SpecialKits.ScanForKits) {
              await KitsController.scanForKits(this._cmakeTools);
              preset.setCompilers(this._kitsController.availableKits);
              return false;
            } else {
              log.debug(localize('user.selected.compiler', 'User selected compiler {0}', JSON.stringify(chosen_kit)));
              const newPreset: preset.ConfigurePreset = {
                name,
                displayName: chosen_kit.kit.name,
                description: chosen_kit.description,
                generator: chosen_kit.kit.preferredGenerator?.name,
                toolset: chosen_kit.kit.preferredGenerator?.toolset,
                architecture: chosen_kit.kit.preferredGenerator?.platform,
                binaryDir: '${sourceDir}/out/build/${presetName}',
                cacheVariables: {
                  CMAKE_BUILD_TYPE: 'Debug',
                  CMAKE_INSTALL_PREFIX: '${sourceDir}/out/install/${presetName}',
                  CMAKE_C_COMPILER: chosen_kit.kit.compilers?.['C']!,
                  CMAKE_CXX_COMPILER: chosen_kit.kit.compilers?.['CXX']!
                }
              };
              await this.addPresetAddUpdate(newPreset, 'configurePresets');
            }
          }
          break;
        }
        case SpecialOptions.InheritConfigurationPreset: {
          const placeHolder = localize('select.one.or.more.config.preset.placeholder', 'Select one or more configure presets');
          const inherits = await this.showPresetSelector(preset.configurePresets(), { placeHolder, canPickMany: true });
          const newPreset: preset.ConfigurePreset = { name, description: '', displayName: '', inherits };
          await this.addPresetAddUpdate(newPreset, 'configurePresets');
          break;
        }
        case SpecialOptions.ToolchainFile: {
          const toolchain = await vscode.window.showOpenDialog({ /* Blank */ });
          if (!toolchain) {
            return false;
          }
          const newPreset: preset.ConfigurePreset = {
            name,
            displayName: `Configure preset using toolchain file`,
            description: 'Sets Ninja generator, build and install directory',
            generator: 'Ninja',
            binaryDir: '${sourceDir}/out/build/${presetName}',
            cacheVariables: {
              CMAKE_BUILD_TYPE: 'Debug',
              CMAKE_TOOLCHAIN_FILE: toolchain[0].path,
              CMAKE_INSTALL_PREFIX: '${sourceDir}/out/install/${presetName}'
            }
          };
          await this.addPresetAddUpdate(newPreset, 'configurePresets');
          break;
        }
        case SpecialOptions.Custom: {
          const newPreset: preset.ConfigurePreset = {
            name,
            displayName: `Custom configure preset`,
            description: 'Sets Ninja generator, build and install directory',
            generator: 'Ninja',
            binaryDir: '${sourceDir}/out/build/${presetName}',
            cacheVariables: {
              CMAKE_INSTALL_PREFIX: '${sourceDir}/out/install/${presetName}'
            }
          };
          await this.addPresetAddUpdate(newPreset, 'configurePresets');
          break;
        }
        default:
          // Shouldn't reach here
          break;
      }
      return true;
    }
  }

  private async handleNoConfigurePresets(): Promise<boolean> {
    const yes = localize('yes', 'Yes');
    const no = localize('no', 'No');
    const result = await vscode.window.showWarningMessage(
      localize('no.config.preset', 'No Configure Presets exist. Would you like to add a Configure Preset?'), yes, no);
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
      const name = await this.showNameInputBox();
      if (!name) {
        return false;
      }

      switch(chosenItem.name) {
        case SpecialOptions.CreateFromConfigurationPreset: {
          const placeHolder = localize('select.a.config.preset.placeholder', 'Select a configure preset');
          const configurePreset = await this.showPresetSelector(preset.configurePresets(), { placeHolder });
          const newPreset: preset.BuildPreset = { name, description: '', displayName: '', configurePreset };
          await this.addPresetAddUpdate(newPreset, 'buildPresets');
          break;
        }
        case SpecialOptions.InheritBuildPreset: {
          const placeHolder = localize('select.one.or.more.build.preset.placeholder', 'Select one or more build presets');
          const inherits = await this.showPresetSelector(preset.buildPresets(), { placeHolder, canPickMany: true });
          const newPreset: preset.BuildPreset = { name, description: '', displayName: '', inherits };
          await this.addPresetAddUpdate(newPreset, 'buildPresets');
          break;
        }
        case SpecialOptions.Custom: {
          const newPreset: preset.BuildPreset = { name, description: '', displayName: '' };
          await this.addPresetAddUpdate(newPreset, 'buildPresets');
          break;
        }
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
      const name = await this.showNameInputBox();
      if (!name) {
        return false;
      }

      switch(chosenItem.name) {
        case SpecialOptions.CreateFromConfigurationPreset: {
          const placeHolder = localize('select.a.config.preset.placeholder', 'Select a configure preset');
          const configurePreset = await this.showPresetSelector(preset.configurePresets(), { placeHolder });
          const newPreset: preset.TestPreset = { name, description: '', displayName: '', configurePreset };
          await this.addPresetAddUpdate(newPreset, 'testPresets');
          break;
        }
        case SpecialOptions.InheritTestPreset: {
          const placeHolder = localize('select.one.or.more.test.preset.placeholder', 'Select one or more test presets');
          const inherits = await this.showPresetSelector(preset.testPresets(), { placeHolder, canPickMany: true });
          const newPreset: preset.TestPreset = { name, description: '', displayName: '', inherits };
          await this.addPresetAddUpdate(newPreset, 'testPresets');
          break;
        }
        case SpecialOptions.Custom: {
          const newPreset: preset.TestPreset = { name, description: '', displayName: '' };
          await this.addPresetAddUpdate(newPreset, 'testPresets');
          break;
        }
        default:
          break;
      }
      return true;
    }
  }

  // Returns the name of the preset selected
  private async showPresetSelector(presets: preset.Preset[], options: vscode.QuickPickOptions & { canPickMany: true; }): Promise<string[] | undefined>;
  private async showPresetSelector(presets: preset.Preset[], options: vscode.QuickPickOptions): Promise<string | undefined>;
  private async showPresetSelector(presets: preset.Preset[], options: vscode.QuickPickOptions): Promise<string | string[] | undefined> {
    interface PresetItem extends vscode.QuickPickItem {
      preset: string;
    }
    const items: PresetItem[] = presets.filter(_preset => !_preset.hidden).map(
        _preset => ({
          label: _preset.displayName || _preset.name,
          description: _preset.description,
          preset: _preset.name
        }),
    );
    items.push({
      label: localize('add.new.preset', 'Add a New Preset...'),
      preset: PresetsController._addPreset
    });
    const chosenPresets = await vscode.window.showQuickPick(items, options);
    if (util.isArray<PresetItem>(chosenPresets)) {
      return chosenPresets.map(_preset => _preset.preset);
    }
    return chosenPresets?.preset;
  }

  async selectConfigurePreset(): Promise<boolean> {
    preset.expandVendorForConfigurePresets();

    const presets = preset.configurePresets().concat(preset.userConfigurePresets()).filter(
      _preset => {
        const supportedHost =  (_preset.vendor as preset.Vendor_VsSettings)?.['microsoft.com/VisualStudioSettings/CMake/1.0'].hostOS;
        const osName = this.getOsName();
        if (supportedHost) {
          if (util.isString(supportedHost)) {
            return supportedHost === osName;
          } else {
            return supportedHost.includes(osName);
          }
        } else {
          return true;
        }
      }
    );

    log.debug(localize('start.selection.of.config.presets', 'Start selection of configure presets. Found {0} presets.', presets.length));

    log.debug(localize('opening.config.preset.selection', 'Opening configure preset selection QuickPick'));
    const placeHolder = localize('select.active.config.preset.placeholder', 'Select a configure preset for {0}', this.folder.name);
    const chosenPreset = await this.showPresetSelector(presets, { placeHolder });
    if (!chosenPreset) {
      log.debug(localize('user.cancelled.config.preset.selection', 'User cancelled configure preset selection'));
      return false;
    } else if (chosenPreset === '__addPreset__') {
      await this.addConfigurePreset();
      return false;
    } else {
      log.debug(localize('user.selected.config.preset', 'User selected configure preset {0}', JSON.stringify(chosenPreset)));
      await this.setConfigurePreset(chosenPreset);
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

  private async checkConfigurePreset(): Promise<preset.ConfigurePreset | null> {
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
    // configure preset required
    const selectedConfigurePreset = await this.checkConfigurePreset();
    if (!selectedConfigurePreset) {
      return false;
    }

    preset.expandConfigurePresetForPresets('build');
    const presets = preset.buildPresets().
                           concat(preset.userBuildPresets()).
                           filter(_preset => _preset.configurePreset === selectedConfigurePreset.name);

    log.debug(localize('start.selection.of.build.presets', 'Start selection of build presets. Found {0} presets.', presets.length));

    log.debug(localize('opening.build.preset.selection', 'Opening build preset selection QuickPick'));
    const placeHolder = localize('select.active.build.preset.placeholder', 'Select a build preset for {0}', this.folder.name);
    const chosenPreset = await this.showPresetSelector(presets, { placeHolder });
    if (!chosenPreset) {
      log.debug(localize('user.cancelled.build.preset.selection', 'User cancelled build preset selection'));
      return false;
    } else if (chosenPreset === '__addPreset__') {
      await this.addBuildPreset();
      return false;
    } else {
      log.debug(localize('user.selected.build.preset', 'User selected build preset {0}', JSON.stringify(chosenPreset)));
      await this.setBuildPreset(chosenPreset);
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
    // configure preset required
    const selectedConfigurePreset = await this.checkConfigurePreset();
    if (!selectedConfigurePreset) {
      return false;
    }

    preset.expandConfigurePresetForPresets('test');
    const presets = preset.testPresets().
                           concat(preset.userTestPresets()).
                           filter(_preset => _preset.configurePreset === selectedConfigurePreset.name);

    log.debug(localize('start.selection.of.test.presets', 'Start selection of test presets. Found {0} presets.', presets.length));
    const placeHolder = localize('select.active.test.preset.placeholder', 'Select a test preset for {0}', this.folder.name);
    const chosenPreset = await this.showPresetSelector(presets, { placeHolder });
    if (!chosenPreset) {
      log.debug(localize('user.cancelled.test.preset.selection', 'User cancelled test preset selection'));
      return false;
    } else if (chosenPreset === '__addPreset__') {
      await this.addTestPreset();
      return false;
    } else {
      log.debug(localize('user.selected.test.preset', 'User selected test preset {0}', JSON.stringify(chosenPreset)));
      await this.setTestPreset(chosenPreset);
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

  private async readPresetsFile(file: string): Promise<Buffer | undefined> {
    if (!await fs.exists(file)) {
      return undefined;
    }
    log.debug(localize('reading.presets.file', 'Reading presets file {0}', file));
    return fs.readFile(file);
  }

  private async parsePresetsFile(fileContent: Buffer | undefined, file: string): Promise<preset.PresetsFile | undefined> {
    if (!fileContent) {
      return undefined;
    }

    let presetsFile: preset.PresetsFile;
    try {
      presetsFile = json5.parse(fileContent.toLocaleString());
    } catch (e) {
      log.error(localize('failed.to.parse', 'Failed to parse {0}: {1}', path.basename(file), util.errorToString(e)));
      return undefined;
    }
    return presetsFile;
  }

  private async validatePresetsFile(presetsFile: preset.PresetsFile | undefined, file: string) {
    if (!presetsFile) {
      return undefined;
    }
    if (presetsFile.version < 2) {
      await this.showPresetsFileVersionError(file);
      return undefined;
    }
    const validator = await loadSchema('schemas/CMakePresets-schema.json');
    const is_valid = validator(presetsFile);
    if (!is_valid) {
      const errors = validator.errors!;
      log.error(localize('invalid.file.error', 'Invalid kit contents {0} ({1}):', path.basename(file), file));
      for (const err of errors) {
        log.error(` >> ${err.dataPath}: ${err.message}`);
      }
      return undefined;
    }
    log.info(localize('successfully.validated.presets', 'Successfully validated presets kits in {0}', file));
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

  // Note: in case anyone want to change this, presetType must match the corresponding key in presets.json files
  async addPresetAddUpdate(newPreset: preset.ConfigurePreset, presetType: 'configurePresets' | 'buildPresets' | 'testPresets') {
    const originalPresetsFile: preset.PresetsFile = preset.getOriginalPresetsFile() || { version: 2 };
    if (!originalPresetsFile[presetType]) {
      originalPresetsFile[presetType] = [];
    }
    originalPresetsFile[presetType]!.push(newPreset);
    await this.updatePresetsFile(originalPresetsFile);
  }

  private getIndentationSettings() {
    const config = vscode.workspace.getConfiguration('editor', this.folder.uri);
    const tabSize = config.get<number>('tabSize') || 4;
    const insertSpaces = config.get<boolean>('insertSpaces') || true;
    return { insertSpaces, tabSize };
  }

  async updatePresetsFile(presetsFile: preset.PresetsFile, isUserPresets = false): Promise<boolean> {
    const presetsFilePath = isUserPresets? this.userPresetsPath : this.presetsPath;
    const indent = this.getIndentationSettings();
    try {
        await fs.writeFile(presetsFilePath, JSON.stringify(presetsFile, null, indent.insertSpaces ? indent.tabSize : '\t'));
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
