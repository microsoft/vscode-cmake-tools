/**
 * Extension startup/teardown
 */ /** */

'use strict';

import * as vscode from 'vscode';
// import * as api from './api';
// import { CMakeToolsWrapper } from './wrapper';
// import { log } from './logging';
// import { outputChannels } from "./util";

import CMakeTools from './cmake-tools';
import rollbar from './rollbar';

/**
 * Starts up the extension.
 * @param context The extension context
 * @returns A promise that will resolve when the extension is ready for use
 */
export async function activate(context: vscode.ExtensionContext): Promise<CMakeTools> {
  // log.initialize(context);

  // Create a new instance and initailize.
  const cmt = await CMakeTools.create(context);

  // Push it so we get clean teardown.
  context.subscriptions.push(cmt);

  // A register function helps us bind the commands to the extension
  function register<K extends keyof CMakeTools>(name: K) {
    const fn = (cmt[name] as Function).bind(cmt);
    return vscode.commands.registerCommand('cmake.' + name, () => {
      return rollbar.invokeAsync(name, fn);
    });
  }

  // List of functions that will be bound commands
  const funs : (keyof CMakeTools)[] =
                   [
                     'editKits',
                     'scanForKits',
                     'selectKit',
                     'configure',
                     // 'build',
                     // 'install',
                     // 'jumpToCacheFile',
                     // 'clean',
                     // 'cleanConfigure',
                     // 'cleanRebuild',
                     // 'buildWithTarget',
                     // 'setDefaultTarget',
                     // 'setBuildType',
                     // 'ctest',
                     // 'stop',
                     // 'quickStart',
                     // 'launchTargetProgramPath',
                     // 'debugTarget',
                     // 'launchTarget',
                     // 'selectLaunchTarget',
                     // 'selectEnvironments',
                     // 'toggleCoverageDecorations',
                   ];

  // Bind them all!
  for (const key of funs) { context.subscriptions.push(register(key));}

  // Return that promise
  return cmt;
}

// this method is called when your extension is deactivated
export function
deactivate() {
  //   outputChannels.dispose();
}
