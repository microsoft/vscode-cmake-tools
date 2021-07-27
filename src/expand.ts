/**
 * Module for working with and performing expansion of template strings
 * with `${var}`-style variable template expressions.
 */

import * as vscode from 'vscode';

import {createLogger} from './logging';
import {EnvironmentVariables} from './proc';
import {mergeEnvironment, replaceAll, fixPaths, errorToString, envGetValue, envSet} from './util';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = createLogger('expand');

/**
 * The required keys for expanding a string in CMake Tools.
 *
 * Unless otherwise specified, CMake Tools guarantees that certain variable
 * references will be available when performing an expansion. Those guaranteed
 * variables are specified as properties on this interface.
 */
interface RequiredExpansionContextVars {
  generator: string;
  workspaceFolder: string;
  workspaceFolderBasename: string;
  workspaceHash: string;
  workspaceRoot: string;
  workspaceRootFolderName: string;
  userHome: string;
}

export interface KitContextVars extends RequiredExpansionContextVars {
  [key: string]: string;
  buildType: string;
  buildKit: string;
  buildKitVendor: string;
  buildKitTriple: string;
  buildKitVersion: string;
  buildKitHostOs: string;
  buildKitTargetOs: string;
  buildKitTargetArch: string;
  buildKitVersionMajor: string;
  buildKitVersionMinor: string;
}

export interface PresetContextVars extends RequiredExpansionContextVars {
  [key: string]: string;
  sourceDir: string;
  sourceParentDir: string;
  sourceDirName: string;
  presetName: string;
}

export interface MinimalPresetContextVars extends RequiredExpansionContextVars {
  [key: string]: string;
}

/**
 * Options to control the behavior of `expandString`.
 */
export interface ExpansionOptions {
  /**
   * Plain `${variable}` style expansions.
   */
  vars: KitContextVars | PresetContextVars | MinimalPresetContextVars;
  /**
   * Override the values used in `${env:var}`-style and `${env.var}`-style expansions.
   *
   * Note that setting this property will disable expansion of environment
   * variables for the running process. Only environment variables in this key
   * will be expanded.
   */
  envOverride?: EnvironmentVariables;
  /**
   * Variables for `${variant:var}`-style expansions.
   */
  variantVars?: { [key: string]: string };
  /**
   * Do expandString recursively if set to true.
   */
  recursive?: boolean;
  /**
   * Support commands by default
   */
  doNotSupportCommands?: boolean;
}

export function emptyExpansionOptions() {
  return ({ vars: {}, recursive: true } as ExpansionOptions);
}

/**
 * Compute the environment variables that apply with substitutions by opts and expanded_env
 * @param in_env the base environment to be expaned
 * @param expanded_env the environment map provided to expand string `${env:var}`
 *   it's will override the envOverride member of opts
 * @param intermediateExpand If this is the intermediate expanding
 * procedure or the final expanding procedure, if it's the
 * intermediate expanding procedure, the variable that not found
 * won't not expaned, if it's the final expanding procedure, the variable
 * that not found would expand to ''.
 * @param opts Environment expand options
 */
export async function computeExpandedEnvironment(
  in_env: EnvironmentVariables,
  expanded_env: EnvironmentVariables,
  intermediateExpand: boolean,
  opts?: ExpansionOptions
): Promise<EnvironmentVariables> {
  const env = {} as { [key: string]: string };
  let expandOpts = opts ?? emptyExpansionOptions();
  expandOpts = {
    ...expandOpts,
    envOverride: expanded_env
  };

  const promises: Promise<void>[] = [];
  async function expandSingle(key: string, value: string) {
    const expandedValue = await expandString(value, expandOpts, intermediateExpand);
    if (typeof expandedValue !== typeof value) {
      log.error(`failed to expand value:${value} result:${expandedValue}`);
    }
    envSet(env, key, expandedValue);
  }
  for (const [key, value] of Object.entries(in_env)) {
    promises.push(expandSingle(key, value));
  }
  await Promise.all(promises);
  return env;
}

/**
 * mergeEnvironmentWithExpand will merge new env variable and
 * expand it one by one, so that the environment like this
 * will expand properly:
 * config.environment
 * { PATH:`${env.PATH};C:\\MinGW\\bin` }
 * config.configureEnvironment
 * { PATH:`${env.PATH};C:\\OtherPath\\bin` }
 *
 * @param intermediateExpand If this is the intermediate expanding
 * procedure or the final expanding procedure, if it's the
 * intermediate expanding procedure, the variable that not found
 * won't not expaned, if it's the final expanding procedure, the variable
 * that not found would expand to ''.
 * @param envs The list of environment variables to expand
 * @param opts Environment expand options
 *
 * NOTE: By mergeEnvironment one by one to enable expanding self
 * containd variable such as PATH properly. If configureEnvironment
 * and environment both configured different PATH, doing this will
 * preserve them all
 */
export async function mergeEnvironmentWithExpand(
  intermediateExpand: boolean,
  envs: (EnvironmentVariables | undefined)[],
  opts?: ExpansionOptions): Promise<EnvironmentVariables> {
  let merged_envs: EnvironmentVariables = {};
  for (const env of envs) {
    let new_env = env ?? {};
    new_env = await computeExpandedEnvironment(new_env, merged_envs, true, opts);
    merged_envs = mergeEnvironment(merged_envs, new_env);
  }
  merged_envs = await computeExpandedEnvironment(merged_envs, merged_envs, intermediateExpand, opts);
  return merged_envs;
}

/**
 * Replace ${variable} references in the given string with their corresponding
 * values.
 * @param instr The input string
 * @param opts Options for the expansion process
 * @param intermediateExpand Not the final expandString calling
 * @returns A string with the variable references replaced
 */
export async function expandString(tmpl: string, opts: ExpansionOptions, intermediateExpand?: boolean) {
  if (!tmpl) {
    return tmpl;
  }

  const MAX_RECURSION = 10;
  let result = tmpl;
  let didReplacement = false;

  let i = 0;
  do {
    // TODO: consider a full circular reference check?
    const expansion = await expandStringHelper(result, opts, intermediateExpand);
    result = expansion.result;
    didReplacement = expansion.didReplacement;
    i++;
  } while (i < MAX_RECURSION && opts.recursive && didReplacement);

  if (i === MAX_RECURSION) {
    log.error(localize('reached.max.recursion', 'Reached max string expansion recursion. Possible circular reference.'));
  }
  if (intermediateExpand) {
    return result;
  } else {
    return replaceAll(result, '${dollar}', '$');
  }
}

export async function expandStringHelper(tmpl: string, opts: ExpansionOptions, intermediateExpand?: boolean) {
  const envPreNormalize = opts.envOverride ? opts.envOverride : process.env as EnvironmentVariables;
  const env = mergeEnvironment(envPreNormalize);
  const repls = opts.vars;

  // We accumulate a list of substitutions that we need to make, preventing
  // recursively expanding or looping forever on bad replacements
  const subs = new Map<string, string>();

  const var_re = /\$\{(\w+)\}/g;
  let mat: RegExpMatchArray|null = null;
  while ((mat = var_re.exec(tmpl))) {
    const full = mat[0];
    const key = mat[1];
    if (key !== 'dollar') {
      // Replace dollar sign at the very end of the expanding process
      const repl = repls[key];
      if (!repl) {
        log.warning(localize('invalid.variable.reference', 'Invalid variable reference {0} in string: {1}', full, tmpl));
      } else {
        subs.set(full, repl);
      }
    }
  }

  function updateSubs(current_env: EnvironmentVariables, full: string, varname: string) {
    const repl = envGetValue(current_env, varname);
    if (repl) {
      subs.set(full, fixPaths(repl));
    } else if (!intermediateExpand) {
      subs.set(full, '');
    }
  }

  // Regular expression for variable value (between the variable suffix and the next ending curly bracket):
  // .+? matches any character (except line terminators) between one and unlimited times,
  // as few times as possible, expanding as needed (lazy)
  const varValueRegexp = ".+?";
  const env_re = RegExp(`\\$\\{env:(${varValueRegexp})\\}`, "g");
  while ((mat = env_re.exec(tmpl))) {
    const full = mat[0];
    const varname = mat[1];
    updateSubs(env, full, varname);
  }

  const env_re2 = RegExp(`\\$\\{env\\.(${varValueRegexp})\\}`, "g");
  while ((mat = env_re2.exec(tmpl))) {
    const full = mat[0];
    const varname = mat[1];
    updateSubs(env, full, varname);
  }

  // $env{} $penv{} and $vendor{} comes from cmake preset
  const env_re3 = RegExp(`\\$env\\{(${varValueRegexp})\\}`, "g");
  while ((mat = env_re3.exec(tmpl))) {
    const full = mat[0];
    const varname = mat[1];
    updateSubs(env, full, varname);
  }

  /*
   * Similar to $env{<variable-name>}, except that the value only comes from the parent environment,
   * and never from the environment field. This allows you to prepend or append values to existing
   * environment variables. For example, setting PATH to /path/to/ninja/bin:$penv{PATH} will prepend
   * /path/to/ninja/bin to the PATH environment variable. This is needed because $env{<variable-name>}
   * does not allow circular references.
   */
  const penv_re = RegExp(`\\$penv\\{(${varValueRegexp})\\}`, "g");
  while ((mat = penv_re.exec(tmpl))) {
    const full = mat[0];
    const varname = mat[1];
    updateSubs(env, full, varname);
  }

  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const folder_re = RegExp(`\\$\\{workspaceFolder:(${varValueRegexp})\\}`, "g");
    mat = folder_re.exec(tmpl);
    while (mat) {
      const full = mat[0];
      const folderName = mat[1];
      const f = vscode.workspace.workspaceFolders.find(folder => folder.name.toLocaleLowerCase() === folderName.toLocaleLowerCase());
      if (f) {
        subs.set(full, f.uri.fsPath);
      }
      mat = folder_re.exec(tmpl);
    }
  }

  if (opts.variantVars) {
    const variants = opts.variantVars;
    const variant_regex = RegExp(`\\$\\{variant:(${varValueRegexp})\\}`, "g");
    while ((mat = variant_regex.exec(tmpl))) {
      const full = mat[0];
      const varname = mat[1];
      const repl = variants[varname] || '';
      subs.set(full, repl);
    }
  }

  const command_re = RegExp(`\\$\\{command:(${varValueRegexp})\\}`, "g");
  while ((mat = command_re.exec(tmpl))) {
    if (opts.doNotSupportCommands) {
      log.warning(localize('command.not.supported', 'Commands are not supported for string: {0}', tmpl));
      break;
    }
    const full = mat[0];
    const command = mat[1];
    if (subs.has(full)) {
      continue;  // Don't execute commands more than once per string
    }
    try {
      const command_ret = await vscode.commands.executeCommand(command, opts.vars.workspaceFolder);
      subs.set(full, `${command_ret}`);
    } catch (e) {
      log.warning(localize('exception.executing.command', 'Exception while executing command {0} for string: {1} {2}', command, tmpl, errorToString(e)));
    }
  }

  let final_str = tmpl;
  let didReplacement = false;
  subs.forEach((value, key) => {
    if (value !== key) {
      final_str = replaceAll(final_str, key, value);
      didReplacement = true;
    }
  });
  return { result: final_str, didReplacement};
}
