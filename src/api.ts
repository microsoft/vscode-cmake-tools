/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as api from 'vscode-cmake-tools';
import CMakeProject from '@cmt/cmakeProject';
import { ExtensionManager } from '@cmt/extension';
import { assertNever } from '@cmt/util';
import { CTestOutputLogger } from '@cmt/ctest';

export class CMakeToolsApiImpl implements api.CMakeToolsApi {
    constructor(private readonly manager: ExtensionManager) {}

    version: api.Version = api.Version.v4;

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

    async configureWithResult(cancellationToken?: vscode.CancellationToken): Promise<api.CommandResult> {
        return this.project.configure(undefined, cancellationToken);
    }

    build(targets?: string[]): Promise<void> {
        return withErrorCheck('build', async () => (await this.project.build(targets)).result);
    }

    async buildWithResult(targets?: string[], cancellationToken?: vscode.CancellationToken): Promise<api.CommandResult> {
        return this.project.build(targets, undefined, undefined, cancellationToken);
    }

    async ctestWithResult(tests?: string[], cancellationToken?: vscode.CancellationToken): Promise<api.CommandResult> {
        return this.project.ctest(undefined, new CTestOutputLogger(), tests, cancellationToken);
    }

    install(): Promise<void> {
        return withErrorCheck('install', async () => (await this.project.install()).result);
    }

    installWithResult(cancellationToken?: vscode.CancellationToken): Promise<api.CommandResult> {
        return this.project.install(cancellationToken);
    }

    clean(): Promise<void> {
        return withErrorCheck('clean', async () => (await this.project.clean()).result);
    }

    async cleanWithResult(cancellationToken?: vscode.CancellationToken): Promise<api.CommandResult> {
        return this.project.clean(cancellationToken);
    }

    reconfigure(): Promise<void> {
        return withErrorCheck('reconfigure', async () => (await this.project.cleanConfigure()).result);
    }

    async reconfigureWithResult(cancellationToken?: vscode.CancellationToken): Promise<api.CommandResult> {
        return this.project.cleanConfigure(undefined, cancellationToken);
    }

    async getBuildDirectory(): Promise<string | undefined> {
        return (await this.project.buildDirectory()) ?? undefined;
    }

    async getActiveBuildType(): Promise<string | undefined> {
        return (await this.project.currentBuildType()) ?? undefined;
    }

    async listBuildTargets(): Promise<string[] | undefined> {
        return (await this.project.targets).map(target => target.name);    
    }

    async listTests(): Promise<string[] | undefined> {
        return this.project.cTestController.getTestNames();
    }
}
