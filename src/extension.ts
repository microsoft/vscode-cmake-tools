/**
 * Extension startup/teardown
 */ /** */

'use strict';

require('module-alias/register');

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

let INSTANCE: CMakeTools|null = null;

/**
 * Starts up the extension.
 * @param context The extension context
 * @returns A promise that will resolve when the extension is ready for use
 */
export async function activate(context: vscode.ExtensionContext): Promise<CMakeTools> {
  // Create a new instance and initailize.
  const cmt_pr = CMakeTools.create(context);

  // A register function helps us bind the commands to the extension
  function register<K extends keyof CMakeTools>(name: K) {
    return vscode.commands.registerCommand(`cmake.${name}`, () => {
      const id = util.randint(1000, 10000);
      return rollbar.invokeAsync(name, async () => {
        const cmt_inst = await cmt_pr;
        log.debug(`[${id}]`, `cmake.${name}`, 'started');
        const fn = (cmt_inst[name] as Function).bind(cmt_inst);
        await fn();
        log.debug(`[${id}]`, `cmake.${name}`, 'finished');
      });
    });
  }

  // List of functions that will be bound commands
  const funs: (keyof CMakeTools)[] = [
    'editKits',     'scanForKits',      'selectKit',        'cleanConfigure', 'configure',
    'build',        'setVariant',       'install',          'editCache',      'clean',
    'cleanRebuild', 'buildWithTarget',  'setDefaultTarget', 'ctest',          'stop',
    'quickStart',   'launchTargetPath', 'debugTarget',      'launchTarget',   'selectLaunchTarget',
    'resetState',
    // 'toggleCoverageDecorations', // XXX: Should coverage decorations be revived?
  ];

  // Register the functions before the extension is done loading so that fast
  // fingers won't cause "unregistered command" errors while CMake Tools starts
  // up. The command wrapper will await on the extension promise.
  for (const key of funs) {
    log.trace(`Register CMakeTools extension command cmake.${key}`);
    context.subscriptions.push(register(key));
  }

  const cmt = await cmt_pr;

  // Push it so we get clean teardown.
  context.subscriptions.push(cmt);

  context.subscriptions.push(vscode.commands.registerCommand('cmake._extensionInstance', () => cmt));

  // Return the extension
  INSTANCE = cmt;
  return INSTANCE;
}

// this method is called when your extension is deactivated
export async function deactivate() {
  log.debug('Deactivate CMakeTools');
  //   outputChannels.dispose();
  if (INSTANCE) {
    await INSTANCE.asyncDispose();
  }
}
