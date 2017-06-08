'use strict';

import * as vscode from 'vscode';
import * as api from './api';
import { CMakeToolsWrapper } from './wrapper';
import { log } from './logging';

export async function activate(context: vscode.ExtensionContext): Promise<CMakeToolsWrapper> {
    log.initialize(context);

    const cmake = new CMakeToolsWrapper(context);
    context.subscriptions.push(cmake);

    function register(name, fn) {
        fn = fn.bind(cmake);
        return vscode.commands.registerCommand(name, _ => fn());
    }

    for (const key of [
        'configure',
        'build',
        'install',
        'jumpToCacheFile',
        'clean',
        'cleanConfigure',
        'cleanRebuild',
        'buildWithTarget',
        'setDefaultTarget',
        'setBuildType',
        'ctest',
        'stop',
        'quickStart',
        'launchTargetProgramPath',
        'debugTarget',
        'launchTarget',
        'selectLaunchTarget',
        'selectEnvironments',
        'toggleCoverageDecorations',
    ]) {
        context.subscriptions.push(register('cmake.' + key, cmake[key]));
    }

    await cmake.start();

    return cmake;
}

// this method is called when your extension is deactivated
export function deactivate() {
    log.dispose();
}