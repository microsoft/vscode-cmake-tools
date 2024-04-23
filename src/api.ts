/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as api from 'vscode-cmake-tools';
import CMakeProject from '@cmt/cmakeProject';
import { ExtensionManager } from '@cmt/extension';
import { assertNever } from '@cmt/util';

export class CMakeToolsApiImpl implements api.CMakeToolsApi {
    constructor(private readonly manager: ExtensionManager) {}

    version: api.Version = api.Version.v2;

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

    async getProject(uri: vscode.Uri): Promise<CMakeProjectWrapper | undefined> {
        const project: CMakeProject | undefined = await this.manager.projectController.getProjectForFolder(uri.fsPath);
        return project ? new CMakeProjectWrapper(project) : undefined;
    }

    getActiveFolderPath(): string {
        return this.manager.activeFolderPath();
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

async function withErrorCheck(name: string, action: () => Promise<number>): Promise<void> {
    const code = await action();
    if (code !== 0) {
        throw new Error(`${name} failed with code ${code}`);
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

    get onSelectedConfigurationChanged() {
        return this.project.onSelectedConfigurationChangedApiEvent;
    }

    configure(): Promise<void> {
        return withErrorCheck('configure', async () => (await this.project.configure()).result);
    }

    build(targets?: string[]): Promise<void> {
        return withErrorCheck('build', () => this.project.build(targets));
    }

    install(): Promise<void> {
        return withErrorCheck('install', () => this.project.install());
    }

    clean(): Promise<void> {
        return withErrorCheck('clean', () => this.project.clean());
    }

    reconfigure(): Promise<void> {
        return withErrorCheck('reconfigure', async () => (await this.project.cleanConfigure()).result);
    }

    async getBuildDirectory(): Promise<string | undefined> {
        return (await this.project.buildDirectory()) ?? undefined;
    }

    async getActiveBuildType(): Promise<string | undefined> {
        return (await this.project.currentBuildType()) ?? undefined;
    }
}
