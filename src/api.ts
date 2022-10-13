/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as api from 'vscode-cmake-tools/out/api';
import { ExtensionManager } from './extension';
import { assertNever } from './util';

export class CMakeToolsApiImpl implements api.CMakeToolsApi {
    constructor(private readonly manager: ExtensionManager) {}

    version: api.Version = api.Version.v0;

    showUiElement(element: api.UiElement): Promise<void> {
        return this.setUiElementVisibility(element, true);
    }

    hideUiElement(element: api.UiElement): Promise<void> {
        return this.setUiElementVisibility(element, false);
    }

    get onBuildTargetNameChanged() {
        return this.manager.onBuildTargetNameChanged;
    }

    get onLaunchTargetNameChanged() {
        return this.manager.onLaunchTargetNameChanged;
    }

    async getFileApiCodeModel(folder: vscode.WorkspaceFolder): Promise<api.CodeModelContent | undefined> {
        return this.manager.cmakeWorkspaceFolders.get(folder)?.cmakeProject.codeModelContent ?? undefined;
    }

    get onFileApiCodeModelChanged() {
        return this.manager.onCodeModelChanged;
    }

    private async setUiElementVisibility(element: api.UiElement, visible: boolean): Promise<void> {
        switch (element) {
            case api.UiElement.StatusBarDebugButton:
                await this.manager.hideDebugCommand(!visible);
                break;
            case api.UiElement.StatusBarLaunchButton:
                await this.manager.hideLaunchCommand(!visible);
                break;
            default:
                assertNever(element);
        }
    }
}
