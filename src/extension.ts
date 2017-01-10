'use strict';

import * as vscode from 'vscode';
import * as api from './api';
import * as wrapper from './wrapper';

export async function activate(context: vscode.ExtensionContext): Promise<api.CMakeToolsAPI | null> {
    let cmake: wrapper.CMakeToolsWrapper | null = null;
    try {
        cmake = await wrapper.CMakeToolsWrapper.startup(context);
    } catch (e) {
        debugger;
        console.error('Error during CMake Tools initialization!', e);
    }
    if (cmake) {
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
            'debugTarget',
            'selectDebugTarget',
            'selectEnvironments',
        ]) {
            context.subscriptions.push(register('cmake.' + key, cmake[key as string]));
        }
    }

    return cmake;
}

// this method is called when your extension is deactivated
export function deactivate() {
}