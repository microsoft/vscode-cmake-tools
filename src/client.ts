'use strict';

import * as vscode from 'vscode';
import * as api from './api';

// export class ServerClientCMakeTools implements api.CMakeToolsAPI {
//   constructor(private _ctx: vscode.ExtensionContext) {}

//   private async _init(): Promise<ServerClientCMakeTools> {

//   }

//   static startup(ct: vscode.ExtensionContext): Promise<ServerClientCMakeTools> {
//     const cmt = new ServerClientCMakeTools(ct);
//     return cmt._init();
//   }
// }