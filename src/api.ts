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
import { logEvent } from './telemetry';

export class CMakeToolsApiImpl implements api.CMakeToolsApi {
    constructor(private readonly manager: ExtensionManager) {}

    version: api.Version = api.Version.v4;

    showUIElement(element: api.UIElement): Promise<void> {
        logApiTelemetry('showUIElement');
        return this.setUIElementVisibility(element, true);
    }

    hideUIElement(element: api.UIElement): Promise<void> {
        logApiTelemetry('hideUIElement');
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
        logApiTelemetry('getProject');
        const project: CMakeProject | undefined = await this.manager.projectController.getProjectForFolder(uri.fsPath);
        return project ? new CMakeProjectWrapper(project) : undefined;
    }

    getActiveFolderPath(): string {
        logApiTelemetry('getActiveFolderPath');
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

async function withErrorCheck(name: string, action: () => Promise<api.CommandResult>): Promise<void> {
    const code = await action();
    if (code.exitCode !== 0) {
        throw new Error(`${name} failed with code ${code.exitCode}, stdout: ${code.stdout ?? ''}, stderr: ${code.stderr ?? ''}`);
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

    get configurePreset() {
        return this.project.configurePreset ?? undefined;
    }

    get buildPreset() {
        return this.project.buildPreset ?? undefined;
    }

    get testPreset() {
        return this.project.testPreset ?? undefined;
    }

    get packagePreset() {
        return this.project.packagePreset ?? undefined;
    }

    get useCMakePresets() {
        return this.project.useCMakePresets;
    }

    configure(): Promise<void> {
        logApiTelemetry('configure');
        return withErrorCheck('configure', async () => (this.project.configure()));
    }

    async configureWithResult(cancellationToken?: vscode.CancellationToken): Promise<api.CommandResult> {
        logApiTelemetry('configureWithResult');
        return this.project.configure(undefined, cancellationToken);
    }

    build(targets?: string[]): Promise<void> {
        logApiTelemetry('build');
        return withErrorCheck('build', () => this.project.build(targets));
    }

    async buildWithResult(targets?: string[], cancellationToken?: vscode.CancellationToken): Promise<api.CommandResult> {
        logApiTelemetry('buildWithResult');
        return this.project.build(targets, undefined, undefined, cancellationToken);
    }

    async ctestWithResult(tests?: string[], cancellationToken?: vscode.CancellationToken): Promise<api.CommandResult> {
        logApiTelemetry('ctestWithResult');
        return this.project.ctest(undefined, new CTestOutputLogger(), tests, cancellationToken);
    }

    install(): Promise<void> {
        logApiTelemetry('install');
        return withErrorCheck('install', () => this.project.install());
    }

    installWithResult(cancellationToken?: vscode.CancellationToken): Promise<api.CommandResult> {
        logApiTelemetry('installWithResult');
        return this.project.install(cancellationToken);
    }

    clean(): Promise<void> {
        logApiTelemetry('clean');
        return withErrorCheck('clean', () => this.project.clean());
    }

    async cleanWithResult(cancellationToken?: vscode.CancellationToken): Promise<api.CommandResult> {
        logApiTelemetry('cleanWithResult');
        return this.project.clean(cancellationToken);
    }

    reconfigure(): Promise<void> {
        logApiTelemetry('reconfigure');
        return withErrorCheck('reconfigure', async () => (this.project.cleanConfigure()));
    }

    async reconfigureWithResult(cancellationToken?: vscode.CancellationToken): Promise<api.CommandResult> {
        logApiTelemetry('reconfigureWithResult');
        return this.project.cleanConfigure(undefined, cancellationToken);
    }

    async getBuildDirectory(): Promise<string | undefined> {
        logApiTelemetry('getBuildDirectory');
        return (await this.project.buildDirectory()) ?? undefined;
    }

    async getActiveBuildType(): Promise<string | undefined> {
        logApiTelemetry('getActiveBuildType');
        return (await this.project.currentBuildType()) ?? undefined;
    }

    async listBuildTargets(): Promise<string[] | undefined> {
        logApiTelemetry('listBuildTargets');
        return (await this.project.targets).map(target => target.name);
    }

    async listTests(): Promise<string[] | undefined> {
        logApiTelemetry('listTests');
        return this.project.cTestController.getTestNames();
    }
}

function logApiTelemetry(method: string): void {
    logEvent("api", {
        method: method
    });
}
