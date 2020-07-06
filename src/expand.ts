/**
 * Module for working with and performing expansion of template strings
 * with `${var}`-style variable template expressions.
 */

import * as vscode from 'vscode';

import {createLogger} from './logging';
import {EnvironmentVariables} from './proc';
import {mergeEnvironment, normalizeEnvironmentVarname, replaceAll, fixPaths, errorToString} from './util';
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
export interface RequiredExpansionContextVars {
  workspaceRoot: string;
  workspaceFolder: string;
  buildType: string;
  buildKit: string;
  workspaceRootFolderName: string;
  workspaceFolderBasename: string;
  generator: string;
  userHome: string;
}

/**
 * Key-value type for variable expansions
 */
export interface ExpansionVars extends RequiredExpansionContextVars {
  [key: string]: string;
}

/**
 * Options to control the behavior of `expandString`.
 */
export interface ExpansionOptions {
  /**
   * Plain `${variable}` style expansions.
   */
  vars: ExpansionVars;
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
  variantVars?: {[key: string]: string};
}

/**
 * Replace ${variable} references in the given string with their corresponding
 * values.
 * @param instr The input string
 * @param opts Options for the expansion process
 * @returns A string with the variable references replaced
 */
export async function expandString(tmpl: string, opts: ExpansionOptions) {
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
    const repl = repls[key];
    if (!repl) {
      log.warning(localize('invalid.variable.reference', 'Invalid variable reference {0} in string: {1}', full, tmpl));
    } else {
      subs.set(full, repl);
    }
  }

  const env_re = /\$\{env:(.+?)\}/g;
  while ((mat = env_re.exec(tmpl))) {
    const full = mat[0];
    const varname = mat[1];
    const repl = fixPaths(env[normalizeEnvironmentVarname(varname)]) || '';
    subs.set(full, repl);
  }

  const env_re2 = /\$\{env\.(.+?)\}/g;
  while ((mat = env_re2.exec(tmpl))) {
    const full = mat[0];
    const varname = mat[1];
    const repl = fixPaths(env[normalizeEnvironmentVarname(varname)]) || '';
    subs.set(full, repl);
  }

  if (opts.variantVars) {
    const variants = opts.variantVars;
    const variant_regex = /\$\{variant:(.+?)\}/g;
    while ((mat = variant_regex.exec(tmpl))) {
      const full = mat[0];
      const varname = mat[1];
      const repl = variants[varname] || '';
      subs.set(full, repl);
    }
  }

  const command_re = /\$\{command:(.+?)\}/g;
  while ((mat = command_re.exec(tmpl))) {
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
  subs.forEach((value, key) => { final_str = replaceAll(final_str, key, value); });
  return final_str;
}
