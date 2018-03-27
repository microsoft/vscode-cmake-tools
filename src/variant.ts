import * as ajv from 'ajv';
import * as yaml from 'js-yaml';
import * as json5 from 'json5';
import * as path from 'path';
import * as vscode from 'vscode';

import * as logging from './logging';
import {fs} from './pr';
import {EnvironmentVariables} from './proc';
import rollbar from './rollbar';
import {loadSchema} from './schema';
import {StateManager} from './state';
import * as util from './util';
import {MultiWatcher} from './watcher';

const log = logging.createLogger('variant');


export type ConfigureArguments = {
  [key: string]: (string|string[]|number|boolean)
};

export interface VariantConfigurationOptions {
  short: string;
  long?: string;
  buildType?: string;
  linkage?: 'static'|'shared';
  settings?: ConfigureArguments;
  generator?: string;
  toolset?: string;
  env?: EnvironmentVariables;
}

export interface VariantSetting {
  description?: string;
  default_: string;
  choices: Map<string, VariantConfigurationOptions>;
}

export type VariantSet = Map<string, VariantSetting>;

export interface VariantCombination extends vscode.QuickPickItem { keywordSettings: Map<string, string>; }

export interface VariantFileContent {
  [key: string]: {default: string; description: string; choices: {[name: string]: VariantConfigurationOptions;};};
}

export const DEFAULT_VARIANTS: VariantFileContent = {
  buildType: {
    default: 'debug',
    description: 'The build type',
    choices: {
      debug: {
        short: 'Debug',
        long: 'Emit debug information without performing optimizations',
        buildType: 'Debug',
      },
      release: {
        short: 'Release',
        long: 'Enable optimizations, omit debug info',
        buildType: 'Release',
      },
      minsize: {
        short: 'MinSizeRel',
        long: 'Optimize for smallest binary size',
        buildType: 'MinSizeRel',
      },
      reldeb: {
        short: 'RelWithDebInfo',
        long: 'Perform optimizations AND include debugging information',
        buildType: 'RelWithDebInfo',
      }
    }
  }
};

export class VariantManager implements vscode.Disposable {
  /**
   * The variants available for this project
   */
  private _variants: VariantSet = new Map();

  get onActiveVariantChanged() { return this._activeVariantChanged.event; }
  private readonly _activeVariantChanged = new vscode.EventEmitter<void>();

  /**
   * Watches for changes to the variants file on the filesystem
   */
  private readonly _variantFileWatcher = new MultiWatcher();

  dispose() {
    this._variantFileWatcher.dispose();
    this._activeVariantChanged.dispose();
  }

  /**
   * Create a new VariantManager
   * @param stateManager The state manager for this instance
   */
  constructor(readonly stateManager: StateManager) {
    log.debug('Constructing VariantManager');
    if (!vscode.workspace.workspaceFolders) {
      return;  // Nothing we can do. We have no directory open
    }
    const folder = vscode.workspace.workspaceFolders[0];  // TODO: Multi-root!
    if (!folder) {
      return;  // No root folder open
    }
    const base_path = folder.uri.path;
    for (const filename of ['cmake-variants.yaml',
                            'cmake-variants.json',
                            '.vscode/cmake-variants.yaml',
                            '.vscode/cmake-variants.json']) {
      this._variantFileWatcher.createWatcher(path.join(base_path, filename));
    }
    this._variantFileWatcher.onAnyEvent(
        e => { rollbar.invokeAsync(`Reloading variants file ${e.fsPath}`, () => this._reloadVariantsFile(e.fsPath)); });
  }

  private async _reloadVariantsFile(filepath?: string) {
    const validate = await loadSchema('schemas/variants-schema.json');

    const workdir = vscode.workspace.rootPath;
    if (!workdir) {
      // Can't read, we don't have a dir open
      return;
    }

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

    let new_variants = DEFAULT_VARIANTS;
    // Check once more that we have a file to read
    if (filepath && await fs.exists(filepath)) {
      const content = (await fs.readFile(filepath)).toString();
      try {
        if (filepath.endsWith('.json')) {
          new_variants = json5.parse(content);
        } else {
          new_variants = yaml.load(content);
        }
      } catch (e) { log.error(`Error parsing ${filepath}: ${e}`); }
    }

    let loaded_default = false;
    const is_valid = validate(new_variants);
    if (!is_valid) {
      const errors = validate.errors as ajv.ErrorObject[];
      log.error('Invalid variants specified:');
      for (const err of errors) {
        log.error(` >> ${err.dataPath}: ${err.message}`);
      }
      new_variants = DEFAULT_VARIANTS;
      loaded_default = true;
    }

    const sets = new Map() as VariantSet;
    for (const setting_name in new_variants) {
      const setting = new_variants[setting_name];
      let def = setting.default;
      const desc = setting.description;
      const choices = new Map<string, VariantConfigurationOptions>();
      for (const choice_name in setting.choices) {
        const choice = setting.choices[choice_name];
        choices.set(choice_name, choice);
      }

      // Check existence of default choice
      if (!choices.has(def)) {
        const newDefault = Array.from(choices.keys())[0];
        log.warning('Invalid variants specified:');
        log.warning(` >> [${setting_name}]: invalid default choice "${def}", falling back to "${newDefault}"`);
        def = newDefault;
      }

      sets.set(setting_name, {
        default_: def,
        description: desc,
        choices,
      });
    }

    if (loaded_default) {
      log.info('Loaded default variants');
    } else {
      log.info('Loaded new set of variants');
    }


    this._variants = sets;
  }

  get haveVariant(): boolean { return !!this.stateManager.activeVariantSettings; }

  variantConfigurationOptionsForKWs(keywordSetting: Map<string, string>): VariantConfigurationOptions[]|string {
    const vars = this._variants;
    let error: string|undefined = undefined;
    const data = Array.from(keywordSetting.entries()).map(([param, setting]): VariantConfigurationOptions => {
      let choice: VariantConfigurationOptions = {short: 'Unknown'};

      if (vars.has(param)) {
        const choices = vars.get(param)!.choices;
        if (choices.has(setting)) {
          choice = choices.get(setting)!;
        } else {
          error = `Missing variant choice "${param}": "${setting}" in variant definition.`;
        }
      } else {
        error = `Missing variant "${param}" in variant definition.`;
      }
      return choice;
    });

    if (error) {
      return error;
    } else {
      return data;
    }
  }

  mergeVariantConfigurations(options: VariantConfigurationOptions[]): VariantConfigurationOptions {
    const init = {short: '', long: '', settings: {}} as any as VariantConfigurationOptions;
    return options.reduce((acc, el) => ({
                            buildType: el.buildType || acc.buildType,
                            generator: el.generator || acc.generator,
                            linkage: el.linkage || acc.linkage,
                            toolset: el.toolset || acc.toolset,
                            // TS 2.4 doesn't like using object spread here, for some reason.
                            // tslint:disable-next-line:prefer-object-spread
                            settings: Object.assign({}, acc.settings, el.settings),
                            short: [acc.short, el.short].join(' ').trim(),
                            long: [acc.long, el.long].join(', '),
                            env: util.mergeEnvironment(acc.env || {}, el.env || {}),
                          }),
                          init);
  }

  get activeVariantOptions(): VariantConfigurationOptions {
    const invalid_variant = {
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
      log.warning('Last variant selection is incompatible with present variant definition.');
      log.warning('>> ' + options_or_error);

      log.warning('Using default variant choices from variant definition.');
      const defaultKws = this.findDefaultChoiceCombination();
      options_or_error = this.variantConfigurationOptionsForKWs(defaultKws);
    }

    if (typeof options_or_error === 'string') {
      // Still invalid?
      return invalid_variant;
    }

    return this.mergeVariantConfigurations(options_or_error);
  }

  async selectVariant() {
    const variants
        = Array.from(this._variants.entries())
              .map(([key, variant]) => Array.from(variant.choices.entries())
                                           .map(([value_name, value]) => (
                                                    {settingKey: key, settingValue: value_name, settings: value})));
    const product = util.product(variants);
    const items: VariantCombination[]
        = product.map(optionset => ({
                        label: optionset.map(o => o.settings.short).join(' + '),
                        keywordSettings: this.transformChoiceCombinationToKeywordSettings(optionset),
                        description: optionset.map(o => o.settings.long).join(' + '),
                      }));
    const chosen = await vscode.window.showQuickPick(items);
    if (!chosen) {
      return false;
    }
    this.publishActiveKeywordSettings(chosen.keywordSettings);
    return true;
  }

  publishActiveKeywordSettings(keywordSettings: Map<string, string>) {
    this.stateManager.activeVariantSettings = keywordSettings;
    this._activeVariantChanged.fire();
  }

  transformChoiceCombinationToKeywordSettings(choiceCombination: {settingKey: string, settingValue: string}[]):
      Map<string, string> {
    const keywords = new Map<string, string>();
    choiceCombination.forEach(kv => keywords.set(kv.settingKey, kv.settingValue));
    return keywords;
  }

  findDefaultChoiceCombination(): Map<string, string> {
    const defaults = util.map(this._variants.entries(), ([option, definition]) => ({
                                                          settingKey: option,
                                                          settingValue: definition.default_,
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
