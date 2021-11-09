/**
 * Module for working with and performing expansion of template strings
 * with `${var}`-style variable template expressions.
 */

import * as vscode from 'vscode';

import { createLogger } from './logging';
import { replaceAll, fixPaths, errorToString } from './util';
import * as nls from 'vscode-nls';
import { EnvironmentWithNull, EnvironmentUtils } from './environmentVariables';

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
    envOverride?: EnvironmentWithNull;
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

/**
 * Replace ${variable} references in the given string with their corresponding
 * values.
 * @param instr The input string
 * @param opts Options for the expansion process
 * @returns A string with the variable references replaced
 */
export async function expandString<T>(tmpl: string | T, opts: ExpansionOptions): Promise<string | T> {
    if (typeof tmpl !== 'string') {
        return tmpl;
    }

    const MAX_RECURSION = 10;
    let result = tmpl;
    let didReplacement = false;

    let i = 0;
    do {
        // TODO: consider a full circular reference check?
        const expansion = await expandStringHelper(result, opts);
        result = expansion.result;
        didReplacement = expansion.didReplacement;
        i++;
    } while (i < MAX_RECURSION && opts.recursive && didReplacement);

    if (i === MAX_RECURSION) {
        log.error(localize('reached.max.recursion', 'Reached max string expansion recursion. Possible circular reference.'));
    }

    return replaceAll(result, '${dollar}', '$');
}

async function expandStringHelper(tmpl: string, opts: ExpansionOptions) {
    const envPreNormalize = opts.envOverride ? opts.envOverride : process.env;
    const env = EnvironmentUtils.create(envPreNormalize);
    const repls = opts.vars;

    // We accumulate a list of substitutions that we need to make, preventing
    // recursively expanding or looping forever on bad replacements
    const subs = new Map<string, string>();

    const var_re = /\$\{(\w+)\}/g;
    let mat: RegExpMatchArray | null = null;
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

    // Regular expression for variable value (between the variable suffix and the next ending curly bracket):
    // .+? matches any character (except line terminators) between one and unlimited times,
    // as few times as possible, expanding as needed (lazy)
    const varValueRegexp = ".+?";
    const env_re = RegExp(`\\$\\{env:(${varValueRegexp})\\}`, "g");
    while ((mat = env_re.exec(tmpl))) {
        const full = mat[0];
        const varname = mat[1];
        const repl = fixPaths(env[varname]) || '';
        subs.set(full, repl);
    }

    const env_re2 = RegExp(`\\$\\{env\\.(${varValueRegexp})\\}`, "g");
    while ((mat = env_re2.exec(tmpl))) {
        const full = mat[0];
        const varname = mat[1];
        const repl = fixPaths(env[varname]) || '';
        subs.set(full, repl);
    }

    const env_re3 = RegExp(`\\$env\\{(${varValueRegexp})\\}`, "g");
    while ((mat = env_re3.exec(tmpl))) {
        const full = mat[0];
        const varname = mat[1];
        const repl = fixPaths(env[varname]) || '';
        subs.set(full, repl);
    }

    const penv_re = RegExp(`\\$penv\\{(${varValueRegexp})\\}`, "g");
    while ((mat = penv_re.exec(tmpl))) {
        const full = mat[0];
        const varname = mat[1];
        const repl = fixPaths(process.env[varname]) || '';
        subs.set(full, repl);
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
    return { result: final_str, didReplacement };
}
