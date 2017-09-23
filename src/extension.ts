'use strict';

import * as vscode from 'vscode';
// import * as api from './api';
// import { CMakeToolsWrapper } from './wrapper';
// import { log } from './logging';
// import { outputChannels } from "./util";

import {CMakeProject} from './project';

export async function activate(context: vscode.ExtensionContext): Promise<CMakeProject> {
  // log.initialize(context);

  const pr = await CMakeProject.create(context);

  context.subscriptions.push(pr);

  function register(name: keyof CMakeProject) {
    const fn = (pr[name] as Function).bind(pr);
    return vscode.commands.registerCommand('cmake.' + name, _ => fn());
  }

  for (const key of['editKits', 'scanForKits',
                    //   'configure',
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
] as(keyof CMakeProject)[]) { context.subscriptions.push(register(key));}

  return pr;
}

// this method is called when your extension is deactivated
export function
deactivate() {
  //   outputChannels.dispose();
}
