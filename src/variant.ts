import * as ajv from 'ajv';
import * as chokidar from 'chokidar';
import * as yaml from 'js-yaml';
import * as json5 from 'json5';
import * as path from 'path';
import * as vscode from 'vscode';

import {ConfigurationReader} from '@cmt/config';
import * as logging from './logging';
import {fs} from './pr';
import {EnvironmentVariables} from './proc';
import rollbar from './rollbar';
import {loadSchema} from './schema';
import {StateManager} from './state';
import * as util from './util';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('variant');

/**
 * Configure arguments for CMake
 */
export interface ConfigureArguments {
  [key: string]: (string|string[]|number|boolean);
}

/**
 * A `choice` loaded from a `cmake-variants.(yaml|json)`.
 */
export interface VarFileOption {
  /**
   * The short description of the option
   */
  short: string;
  /**
   * The long description of the option
   */
  long?: string;
  /**
   * The `CMAKE_BUILD_TYPE` for the option.
   */
  buildType?: string;
  /**
   * Whether we set `BUILD_SHARED_LIBS`
   */
  linkage?: 'static'|'shared';
  /**
   * Other CMake cache arguments for the option
   */
  settings?: ConfigureArguments;
  /**
   * Environment variables to set for the option
   */
  env?: EnvironmentVariables;
}

/**
 * A setting loaded from a `cmake-variants.(yaml|json)`.
 */
export interface VarFileSetting {
  /**
   * The default option for the setting. Ignored by CMake Tools
   */
  default: string;
  /**
   * The description of the setting. Ignored by CMake Tools
   */
  description: string;
  /**
   * The possible options for this setting.
   */
  choices: {[key: string]: VarFileOption|undefined;};
}
/**
 * The root of a `cmake-variants.(yaml|json)`
 */
export interface VarFileRoot {
  [key: string]: VarFileSetting|undefined;
}

/**
 * An option for a variant. Includes all attributes from `VarFileOption` but
 * adds a `key` to identify it.
 */
export interface VariantOption extends VarFileOption {
  /**
   * The key for the option as it appeared in the `choices` option on the
   * associated setting in the variants file.
   */
  key: string;
}

/**
 * A possible variant setting with a list of options
 */
export interface VariantSetting {
  /**
   * The name of the setting.
   */
  name: string;
  /**
   * The default option choice for this variant
   */
  default: string;
  /**
   * The options available for this setting.
   */
  choices: VariantOption[];
}

/**
 * A collection of variant settings
 */
export interface VariantCollection {
  /**
   * The settings in this collection
   */
  settings: VariantSetting[];
}

/**
 * A variant combination to show to the user in a selection UI
 */
export interface VariantCombination extends vscode.QuickPickItem {
  keywordSettings: Map<string, string>;
}

export function processVariantFileData(root: VarFileRoot): VariantCollection {
  const settings = util.objectPairs(root).map(([setting_name, setting_def]): VariantSetting => {
    const choices = util.objectPairs(setting_def!.choices).map(([opt_key, opt_def]): VariantOption => {
      return {
        ...opt_def!,
        key: opt_key,
      };
    });
    return {
      name: setting_name,
      default: setting_def!.default,
      choices,
    };
  });
  return {settings};
}

export const DEFAULT_VARIANTS: VarFileRoot = {
  buildType: {
    default: 'debug',
    description: localize('build.type.description', 'The build type'),
    choices: {
      debug: {
        short: 'Debug',
        long: localize('emit.debug.without.optimizations', 'Emit debug information without performing optimizations'),
        buildType: 'Debug',
      },
      release: {
        short: 'Release',
        long: localize('enable.optimizations.omit.debug', 'Enable optimizations, omit debug info'),
        buildType: 'Release',
      },
      minsize: {
        short: 'MinSizeRel',
        long: localize('optimize.for.smallest', 'Optimize for smallest binary size'),
        buildType: 'MinSizeRel',
      },
      reldeb: {
        short: 'RelWithDebInfo',
        long: localize('optimize.and.debug', 'Perform optimizations AND include debugging information'),
        buildType: 'RelWithDebInfo',
      }
    }
  }
};

export class VariantManager implements vscode.Disposable {
  /**
   * The variants available for this project
   */
  private _variants: VariantCollection = {settings: []};

  get onActiveVariantChanged() { return this._activeVariantChanged.event; }
  private readonly _activeVariantChanged = new vscode.EventEmitter<void>();

  /**
   * Watches for changes to the variants file on the filesystem
   */
  private readonly _variantFileWatcher = chokidar.watch([], {ignoreInitial: true});


  dispose() {
    // tslint:disable-next-line: no-floating-promises
    this._variantFileWatcher.close();
    this._activeVariantChanged.dispose();
  }

  /**
   * Create a new VariantManager
   * @param stateManager The state manager for this instance
   */
  constructor(readonly folder: vscode.WorkspaceFolder, readonly stateManager: StateManager, readonly config: ConfigurationReader) {
    log.debug(localize('constructing', 'Constructing {0}', 'VariantManager'));
    if (!vscode.workspace.workspaceFolders) {
      return;  // Nothing we can do. We have no directory open
    }
    const base_path = folder.uri.path;
    for (const filename of ['cmake-variants.yaml',
                            'cmake-variants.json',
                            '.vscode/cmake-variants.yaml',
                            '.vscode/cmake-variants.json']) {
      this._variantFileWatcher.add(path.join(base_path, filename));
    }
    util.chokidarOnAnyChange(
            this._variantFileWatcher,
            filePath => { rollbar.invokeAsync(localize('reloading.variants.file', 'Reloading variants file {0}', filePath), () => this._reloadVariantsFile(filePath)); });

    config.onChange('defaultVariants', () => {
      rollbar.invokeAsync(localize('reloading.variants.from.settings', 'Reloading variants from settings'), () => this._reloadVariantsFile());
    });
  }

  private loadVariantsFromSettings(): VarFileRoot {
    const collectionOfVariantsFromConfig = this.config.defaultVariants;
    if (collectionOfVariantsFromConfig) {
      return collectionOfVariantsFromConfig as VarFileRoot;
    } else {
      return DEFAULT_VARIANTS as VarFileRoot;
    }
  }

  private async _reloadVariantsFile(filepath?: string) {
    const validate = await loadSchema('schemas/variants-schema.json');

    const workdir = this.folder.uri.fsPath;

    if (!filepath || !await fs.exists(filepath)) {
      const candidates = [
        path.join(workdir, 'cmake-variants.json'),
        path.join(workdir, 'cmake-variants.yaml'),
        path.join(workdir, '.vscode/cmake-variants.json'),
        path.join(workdir, '.vscode/cmake-variants.yaml'),
      ];
      for (const testpath of candidates) {
        if (await fs.exists(testpath)) {
          filepath = testpath;
          break;
        }
      }
    }

    let new_variants = this.loadVariantsFromSettings();
    // Check once more that we have a file to read
    if (filepath && await fs.exists(filepath)) {
      const content = (await fs.readFile(filepath)).toString();
      try {
        if (filepath.endsWith('.json')) {
          new_variants = json5.parse(content);
        } else {
          new_variants = yaml.load(content) as VarFileRoot;
        }
      } catch (e) {
        log.error(localize('error.parsing', 'Error parsing {0}: {1}', filepath, util.errorToString(e)));
      }
    }

    const is_valid = validate(new_variants);
    if (!is_valid) {
      const errors = validate.errors as ajv.ErrorObject[];
      log.error(localize('invalid.variants', 'Invalid variants specified:'));
      for (const err of errors) {
        log.error(` >> ${err.dataPath}: ${err.message}`);
      }
      new_variants = DEFAULT_VARIANTS;
      log.info(localize('loaded.default.variants', 'Loaded default variants'));
    } else {
      log.info(localize('loaded.new.variants.set', 'Loaded new set of variants'));
    }

    this._variants = processVariantFileData(new_variants);
  }

  get haveVariant(): boolean { return !!this.stateManager.activeVariantSettings; }

  variantConfigurationOptionsForKWs(keywordSetting: Map<string, string>): VariantOption[]|string {
    const vars = this._variants;
    let error: string|undefined = undefined;
    const data = Array.from(keywordSetting.entries()).map(([setting_key, opt_key]): VariantOption => {
      const unknown_choice: VariantOption = {short: 'Unknown', key: '__unknown__'};
      const found_setting = vars.settings.find(s => s.name == setting_key);
      if (!found_setting) {
        error = localize('missing.setting.in.variant', 'Missing setting "{0}" in variant definition.', setting_key);
        return unknown_choice;
      }
      const found_choice = found_setting.choices.find(o => o.key == opt_key);
      if (!found_choice) {
        error = localize('missing.variant.choice', 'Missing variant choice "{0}" on "{1}" in variant definition.', opt_key, setting_key);
        return unknown_choice;
      }
      return found_choice;
    });

    if (error) {
      return error;
    } else {
      return data;
    }
  }

  mergeVariantConfigurations(options: VariantOption[]): VariantOption {
    const init = {short: '', long: '', settings: {}} as any as VariantOption;
    return options.reduce((acc, el) => ({
                            key: '__merged__',
                            buildType: el.buildType || acc.buildType,
                            linkage: el.linkage || acc.linkage,
                            // TS 2.4 doesn't like using object spread here, for some reason.
                            // tslint:disable-next-line:prefer-object-spread
                            settings: Object.assign({}, acc.settings, el.settings),
                            short: [acc.short, el.short].join(' ').trim(),
                            long: [acc.long, el.long].join(', '),
                            env: util.mergeEnvironment(acc.env || {}, el.env || {}),
                          }),
                          init);
  }

  get activeVariantOptions(): VariantOption {
    const invalid_variant = {
      key: '__invalid__',
      short: 'Unknown',
      long: 'Unknwon',
    };
    const kws = this.stateManager.activeVariantSettings;
    if (!kws) {
      return invalid_variant;
    }
    const vars = this._variants;
    if (!vars) {
      return invalid_variant;
    }

    let options_or_error = this.variantConfigurationOptionsForKWs(kws);
    if (typeof options_or_error === 'string') {
      log.warning(localize('incompatible.variant', 'Last variant selection is incompatible with present variant definition.'));
      log.warning('>> ' + options_or_error);

      log.warning(localize('using.default.variant.choices', 'Using default variant choices from variant definition.'));
      const defaultKws = this.findDefaultChoiceCombination();
      options_or_error = this.variantConfigurationOptionsForKWs(defaultKws);
    }

    if (typeof options_or_error === 'string') {
      // Still invalid?
      return invalid_variant;
    }

    return this.mergeVariantConfigurations(options_or_error);
  }

  async selectVariant(name?: string) {
    const variants = this._variants.settings.map(setting => setting.choices.map(opt => ({
                                                                                  settingKey: setting.name,
                                                                                  settingValue: opt.key,
                                                                                  settings: opt,
                                                                                })));
    const product = util.product(variants);
    const items: VariantCombination[]
        = product.map(optionset => ({
                        label: optionset.map(o => o.settings.short).join(' + '),
                        keywordSettings: this.transformChoiceCombinationToKeywordSettings(optionset),
                        description: optionset.map(o => o.settings.long).join(' + '),
                      }));
    if (name) {
      for (const item of items) {
        if (name === item.label) {
          this.publishActiveKeywordSettings(item.keywordSettings);
          return true;
        }
      }
      return false;
    } else {
      const chosen = await vscode.window.showQuickPick(items);
      if (!chosen) {
        return false;
      }
      this.publishActiveKeywordSettings(chosen.keywordSettings);
      return true;
    }
  }

  publishActiveKeywordSettings(keywordSettings: Map<string, string>) {
    this.stateManager.activeVariantSettings = keywordSettings;
    this._activeVariantChanged.fire();
  }

  public get activeKeywordSetting(): Map<string, string> | null {
    return this.stateManager.activeVariantSettings;
  }

  transformChoiceCombinationToKeywordSettings(choiceCombination: {settingKey: string, settingValue: string}[]):
      Map<string, string> {
    const keywords = new Map<string, string>();
    choiceCombination.forEach(kv => keywords.set(kv.settingKey, kv.settingValue));
    return keywords;
  }

  findDefaultChoiceCombination(): Map<string, string> {
    const defaults = this._variants.settings.map(setting => ({
                                                   settingKey: setting.name,
                                                   settingValue: setting.default,
                                                 }));
    return this.transformChoiceCombinationToKeywordSettings(Array.from(defaults));
  }

  async initialize() {
    await this._reloadVariantsFile();

    if (this.stateManager.activeVariantSettings === null) {
      const defaultChoices = this.findDefaultChoiceCombination();
      this.publishActiveKeywordSettings(defaultChoices);
    }
  }
}
