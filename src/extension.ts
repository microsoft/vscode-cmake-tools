'use strict';

import * as vscode from 'vscode';
import * as cmake_mod from './cmake';

export async function activate(context: vscode.ExtensionContext) {
    const cmake = new cmake_mod.CMakeTools(context);
    await cmake.initFinished;
    function register(name, fn) {
        fn = fn.bind(cmake);
        return vscode.commands.registerCommand(name, _ => fn());
    }

    for (const key of [
        'configure',
        'build',
        'install',
        'cleanConfigure',
        'jumpToCacheFile',
        'clean',
        'cleanRebuild',
        'buildWithTarget',
        'setDefaultTarget',
        'setBuildType',
        'ctest',
        'quickStart',
        'stop',
        'debugTarget',
        'selectDebugTarget',
        'selectEnvironments',
    ]) {
        context.subscriptions.push(register('cmake.' + key, cmake[key as string]));
    }

    return cmake;
}

// this method is called when your extension is deactivated
export function deactivate() {
}