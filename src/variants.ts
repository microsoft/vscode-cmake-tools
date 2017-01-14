import * as ajv from 'ajv';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as vscode from 'vscode';

import * as api from './api';
import * as async from './async';
import {config} from './config';
import * as util from './util';
import {Maybe} from './util';

export interface ConfigureArguments {
  key: string;
  value: (string|string[]|number|boolean);
}

export interface VariantConfigurationOptions {
  oneWordSummary$?: string;
  description$?: string;
  buildType?: Maybe<string>;
  linkage?: Maybe<string>;
  settings?: ConfigureArguments[];
  generator?: Maybe<string>;
  toolset?: Maybe<string>;
}

// export type VariantOptionChoices = Map<string, VariantOption>;

export interface VariantSetting {
  description: string;
  default:
    string;
    choices: Map<string, VariantConfigurationOptions>;
}

export type VariantSet = Map<string, VariantSetting>;

export interface VariantCombination extends vscode.QuickPickItem {
  keywordSettings: Map<string, string>;
}

export const DEFAULT_VARIANTS = {
  buildType: {
    'default$': 'debug',
    'description$': 'The build type to use',
    debug: {
      'oneWordSummary$': 'Debug',
      'description$': 'Emit debug information without performing optimizations',
      buildType: 'Debug',
    },
    release: {
      'oneWordSummary$': 'Release',
      'description$': 'Enable optimizations, omit debug info',
      buildType: 'Release',
    },
    minsize: {
      'oneWordSummary$': 'MinSizeRel',
      'description$': 'Optimize for smallest binary size',
      buildType: 'MinSizeRel',
    },
    reldeb: {
      'oneWordSummary$': 'RelWithDebInfo',
      'description$': 'Perform optimizations AND include debugging information',
      buildType: 'RelWithDebInfo',
    }
  },
  // The world isn't ready...
  // link: {
  //   ''$description$'': 'The link usage of build libraries',,
  //   'default$': 'static',
  //   static: {
  //     'oneWordSummary$': 'Static',
  //     'description$': 'Emit Static Libraries',
  //     linkage: 'static',
  //   },
  //   shared: {
  //     'oneWordSummary$': 'Shared',
  //     'description$': 'Emit shared libraries/DLLs',
  //     linkage: 'shared',
  //   }
  // }
};

export class VariantManager implements vscode.Disposable {
  constructor(private readonly _context: vscode.ExtensionContext) {
    const variants_watcher = vscode.workspace.createFileSystemWatcher(
        path.join(vscode.workspace.rootPath, 'cmake-variants.*'));
    this._disposables.push(variants_watcher);
    variants_watcher.onDidChange(this._reloadVariants.bind(this));
    variants_watcher.onDidCreate(this._reloadVariants.bind(this));
    variants_watcher.onDidDelete(this._reloadVariants.bind(this));
    this._reloadVariants();
  }

  private _disposables = [] as vscode.Disposable[];
  dispose() {
    this._disposables.map(e => e.dispose());
  }

  private _availableVariants: VariantSet;
  public get availableVariants(): VariantSet {
    return this._availableVariants;
  }

  /**
   * @brief The active variant combination
   */
  private _activeVariantCombination: VariantCombination;
  public get activeVariantCombination(): VariantCombination {
    return this._activeVariantCombination;
  }
  public set activeVariantCombination(v: VariantCombination) {
    this._activeVariantCombination = v;
    this._activeVariantCombinationEmitter.fire(v);
  }

  private _activeVariantCombinationEmitter =
      new vscode.EventEmitter<VariantCombination>();
  public readonly onActiveVariantCombinationChanged =
      this._activeVariantCombinationEmitter.event;

  /**
   * Get the configuration options associated with the active build variant
   */
  public get activeConfigurationOptions(): VariantConfigurationOptions {
    const vari = this.activeVariantCombination;
    if (!vari) {
      return {};
    }
    const kws = vari.keywordSettings;
    if (!kws) {
      return {};
    }
    const vars = this.availableVariants;
    if (!vars) {
      return {};
    }
    const data = Array.from(kws.entries()).map(([param, setting]) => {
      if (!vars.has(param)) {
        debugger;
        throw 12;
      }
      const choices = vars.get(param)!.choices;
      if (!choices.has(setting)) {
        debugger;
        throw 12;
      }
      return choices.get(setting)!;
    });
    const result: VariantConfigurationOptions = data.reduce(
        (acc, el) => ({
          buildType: el.buildType || acc.buildType,
          generator: el.generator || acc.generator,
          linkage: el.linkage || acc.linkage,
          toolset: el.toolset || acc.toolset,
          settings: Object.assign(acc.settings || {}, el.settings || {})
        }),
        {});
    return result;
  }

  /**
   * Called to reload the contents of cmake-variants.json
   *
   * This function is called once when the extension first starts up, and is
   * called whenever a change is detected in the cmake variants file. This
   * function will also show any error messages related to a malformed variants
   * file if there is a problem therein.
   */
  private async _reloadVariants() {
    const schema_path =
        this._context.asAbsolutePath('schemas/variants-schema.json');
    const schema = JSON.parse((await async.readFile(schema_path)).toString());
    const validate = new ajv({
                       allErrors: true,
                       format: 'full',
                     }).compile(schema);

    const workdir = vscode.workspace.rootPath;
    const yaml_file = path.join(workdir, 'cmake-variants.yaml');
    const json_file = path.join(workdir, 'cmake-variants.json');
    let variants: any;
    if (await async.exists(yaml_file)) {
      const content = (await async.readFile(yaml_file)).toString();
      try {
        variants = yaml.load(content);
      } catch (e) {
        vscode.window.showErrorMessage(
            `${yaml_file} is syntactically invalid.`);
        variants = config.defaultVariants;
      }
    } else if (await async.exists(json_file)) {
      const content = (await async.readFile(json_file)).toString();
      try {
        variants = JSON.parse(content);
      } catch (e) {
        vscode.window.showErrorMessage(
            `${json_file} is syntactically invalid.`);
        variants = config.defaultVariants;
      }
    } else {
      variants = config.defaultVariants;
    }
    const validated = validate(variants);
    if (!validated) {
      const errors = validate.errors as ajv.ErrorObject[];
      const error_strings =
          errors.map(err => `${err.dataPath}: ${err.message}`);
      vscode.window.showErrorMessage(
          `Invalid cmake-variants: ${error_strings.join('; ')}`);
      variants = config.defaultVariants;
    }
    const sets = new Map() as VariantSet;
    for (const key in variants) {
      const sub = variants[key];
      const def = sub['default$'];
      const desc = sub['description$'];
      const choices = new Map<string, VariantConfigurationOptions>();
      for (const name in sub) {
        if (!name || ['default$', 'description$'].indexOf(name) !== -1) {
          continue;
        }
        const settings = sub[name] as VariantConfigurationOptions;
        choices.set(name, settings);
      }
      sets.set(key, {description: desc, default: def, choices});
    }
    this._availableVariants = sets;
  }

  private _generateVariantLabel(settings: api.VariantKeywordSettings): string {
    return Array.from(this.availableVariants.entries())
        .map(([key,
               values]) => values.choices.get(settings[key])!.oneWordSummary$)
        .join('+');
  }

  private _generateVariantDescription(settings: api.VariantKeywordSettings):
      string {
    return Array.from(this.availableVariants.entries())
        .map(([key, values]) => values.choices.get(settings[key])!.description$)
        .join(' + ');
  }

  async setActiveVariantCombination(settings: api.VariantKeywordSettings) {
    this.activeVariantCombination = {
      label: this._generateVariantLabel(settings),
      description: this._generateVariantDescription(settings),
      keywordSettings: Object.keys(settings).reduce<Map<string, string>>(
          (acc, key) => {
            acc.set(key, settings[key]);
            return acc;
          },
          new Map<string, string>()),
    };
  }

  public async showVariantSelector(): Promise<boolean> {
    const variants =
        Array.from(this.availableVariants.entries())
            .map(
                ([key, variant]) => Array.from(variant.choices.entries())
                                        .map(([value_name, value]) => ({
                                               settingKey: key,
                                               settingValue: value_name,
                                               settings: value
                                             })));
    const product = util.product(variants);
    const items = product.map(
        optionset => ({
          label: optionset
                     .map(
                         o => o.settings['oneWordSummary$'] ?
                             o.settings['oneWordSummary$'] :
                             `${o.settingKey}=${o.settingValue}`)
                     .join('+'),
          keywordSettings: new Map<string, string>(optionset.map(
              param => [param.settingKey, param.settingValue] as
                  [string, string])),
          description:
              optionset.map(o => o.settings['description$']).join(' + '),
        }));
    const chosen: VariantCombination = await vscode.window.showQuickPick(items);
    if (!chosen) return false;  // User cancelled
    this.activeVariantCombination = chosen;
    return true;
  }
}