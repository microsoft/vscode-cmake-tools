/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as api from 'vscode-cmake-tools/out/api';
import CMakeProject from '@cmt/cmakeProject';
import { ExtensionManager } from '@cmt/extension';
import { assertNever } from '@cmt/util';

export class CMakeToolsApiImpl implements api.CMakeToolsApi {
    constructor(private readonly manager: ExtensionManager) {}

    version: api.Version = api.Version.v1;

    showUIElement(element: api.UIElement): Promise<void> {
        return this.setUIElementVisibility(element, true);
    }

    hideUIElement(element: api.UIElement): Promise<void> {
        return this.setUIElementVisibility(element, false);
    }

    get onBuildTargetChanged() {
        return this.manager.onBuildTargetChanged;
    }

    get onLaunchTargetChanged() {
        return this.manager.onLaunchTargetChanged;
    }

    get onActiveProjectChanged() {
        return this.manager.onActiveProjectChanged;
    }

    async getProject(uri: vscode.Uri) {
        const project = this.manager.cmakeWorkspaceFolders.get([uri.fsPath])?.cmakeProject;
        return project && new CMakeProjectWrapper(project);
    }

    private async setUIElementVisibility(element: api.UIElement, visible: boolean): Promise<void> {
        switch (element) {
            case api.UIElement.StatusBarDebugButton:
                await this.manager.hideDebugCommand(!visible);
                break;
            case api.UIElement.StatusBarLaunchButton:
                await this.manager.hideLaunchCommand(!visible);
                break;
            default:
                assertNever(element);
        }
    }
}

class CMakeProjectWrapper implements api.Project {
    constructor(private readonly project: CMakeProject) {}

    get codeModel() {
        return this.project.codeModelContent ?? undefined;
    }

    get onCodeModelChanged() {
        return this.project.onCodeModelChangedApiEvent;
    }
}
