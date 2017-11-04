/**
 * Extension startup/teardown
 */ /** */

'use strict';

import * as vscode from 'vscode';
import * as logging from './logging';
import * as util from './util';

const log = logging.createLogger('extension');

// import * as api from './api';
// import { CMakeToolsWrapper } from './wrapper';
// import { log } from './logging';
// import { outputChannels } from "./util";

import CMakeTools from './cmake-tools';
import rollbar from './rollbar';

let INSTANCE: CMakeTools | null = null;

/**
 * Starts up the extension.
 * @param context The extension context
 * @returns A promise that will resolve when the extension is ready for use
 */
export async function activate(context: vscode.ExtensionContext): Promise<CMakeTools> {
  // Create a new instance and initailize.
  const cmt = await CMakeTools.create(context);

  // Push it so we get clean teardown.
  context.subscriptions.push(cmt);

  // We are now safe to do logging
  log.debug('Registering extension commands');

  // A register function helps us bind the commands to the extension
  function register<K extends keyof CMakeTools>(name: K) {
    const fn = (cmt[name] as Function).bind(cmt);
    return vscode.commands.registerCommand('cmake.' + name, () => {
      const id = util.randint(1000, 10000);
      log.debug(`[${id}]`, 'cmake.' + name, 'started');
      const pr = rollbar.invokeAsync(name, fn);
      pr.then(() => { log.debug(`[${id}]`, 'cmake.' + name, 'finished'); }).catch(e => {
        log.debug(`[${id}]`, 'cmake.' + name, 'finished with an exception', e);
      });
      return pr;
    });
  }

  // List of functions that will be bound commands
  const funs : (keyof CMakeTools)[] =
                   [
                     'editKits',
                     'scanForKits',
                     'selectKit',
                     'cleanConfigure',
                     'configure',
                     'build',
                     'setVariant',
                     'install',
                     // 'jumpToCacheFile',
                     'clean',
                     'cleanRebuild',
                     'buildWithTarget',
                     'setDefaultTarget',
                     'ctest',
                     'stop',
                     'quickStart',
                     // 'launchTargetProgramPath',
                     // 'debugTarget',
                     // 'launchTarget',
                     // 'selectLaunchTarget',
                     // 'toggleCoverageDecorations',
                   ];

  // Bind them all!
  for (const key of funs) {
    log.trace(`Register CMakeTools extension command cmake.${key}`);
    context.subscriptions.push(register(key));
  }

  context.subscriptions.push(
      vscode.commands.registerCommand('cmake._extensionInstance', () => { return cmt;}));

  // Return the extension
  INSTANCE = cmt;
  return INSTANCE;
}

// this method is called when your extension is deactivated
export async function
deactivate() {
  log.debug('Deactivate CMakeTools');
  //   outputChannels.dispose();
  if (INSTANCE) {
    await INSTANCE.asyncDispose();
  }
}
