import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import CMakeProject from './cmakeProject';
import * as preset from './preset';
import { runCommand } from './util';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
const noKitSelected = localize('no.kit.selected', '[No Kit Selected]');
const noConfigPresetSelected = localize('no.configure.preset.selected', '[No Configure Preset Selected]');
const noBuildPresetSelected = localize('no.build.preset.selected', '[No Build Preset Selected]');
const noTestPresetSelected = localize('no.test.preset.selected', '[No Test Preset Selected]');
const noPackagePresetSelected = localize('no.package.preset.selected', '[No Package Preset Selected]');
const noWorkflowPresetSelected = localize('no.workflow.preset.selected', '[No Workflow Preset Selected]');

let treeDataProvider: TreeDataProvider;

export class ProjectStatus {

    protected disposables: vscode.Disposable[] = [];

    constructor() {
        treeDataProvider = new TreeDataProvider();
        this.disposables.push(...[
            // Commands for projectStatus items
            vscode.commands.registerCommand('cmake.projectStatus.stop', async (_node: Node) => {
                await runCommand('stop');
            }),
            vscode.commands.registerCommand('cmake.projectStatus.selectKit', async (_node: Node) => {
                await runCommand('selectKit');
                await this.refresh();
            }),
            vscode.commands.registerCommand('cmake.projectStatus.selectConfigurePreset', async (node: Node) => {
                await runCommand('selectConfigurePreset');
                await this.refresh(node);
            }),
            vscode.commands.registerCommand('cmake.projectStatus.configure', async (_node: Node) => {
                void runCommand('configure');
            }),
            vscode.commands.registerCommand('cmake.projectStatus.setVariant', async (node: Node) => {
                await runCommand('setVariant');
                await this.refresh(node);
            }),
            vscode.commands.registerCommand('cmake.projectStatus.build', async (_node: Node) => {
                void runCommand('build');
            }),
            vscode.commands.registerCommand('cmake.projectStatus.setDefaultTarget', async (node: Node) => {
                await runCommand('setDefaultTarget');
                await this.refresh(node);
            }),
            vscode.commands.registerCommand('cmake.projectStatus.selectBuildPreset', async (node: Node) => {
                await runCommand('selectBuildPreset');
                await this.refresh(node);
            }),
            vscode.commands.registerCommand('cmake.projectStatus.ctest', async (_node: Node) => {
                void runCommand('ctest');
            }),
            vscode.commands.registerCommand('cmake.projectStatus.cpack', async (_node: Node) => {
                void runCommand('cpack');
            }),
            vscode.commands.registerCommand('cmake.projectStatus.workflow', async (_node: Node) => {
                void runCommand('workflow');
            }),
            vscode.commands.registerCommand('cmake.projectStatus.setTestTarget', async (_node: Node) => {
                // Do nothing
            }),
            vscode.commands.registerCommand('cmake.projectStatus.selectTestPreset', async (node: Node) => {
                await runCommand('selectTestPreset');
                await this.refresh(node);
            }),
            vscode.commands.registerCommand('cmake.projectStatus.selectPackagePreset', async (node: Node) => {
                await runCommand('selectPackagePreset');
                await this.refresh(node);
            }),
            vscode.commands.registerCommand('cmake.projectStatus.selectWorkflowPreset', async (node: Node) => {
                await runCommand('selectWorkflowPreset');
                await this.refresh(node);
            }),
            vscode.commands.registerCommand('cmake.projectStatus.debugTarget', async (_node: Node) => {
                await runCommand('debugTarget');
            }),
            vscode.commands.registerCommand('cmake.projectStatus.setDebugTarget', async (node: Node) => {
                await runCommand('selectLaunchTarget');
                await this.refresh(node);
            }),
            vscode.commands.registerCommand('cmake.projectStatus.launchTarget', async (_node: Node) => {
                await runCommand('launchTarget');
            }),
            vscode.commands.registerCommand('cmake.projectStatus.setLaunchTarget', async (node: Node) => {
                await runCommand('selectLaunchTarget');
                await this.refresh(node);
            }),
            vscode.commands.registerCommand('cmake.projectStatus.selectActiveProject', async () => {
                await runCommand('selectActiveFolder');
                await this.refresh();
            }),
            vscode.commands.registerCommand('cmake.projectStatus.update', async () => {
                await this.refresh();
            })
        ]);
    }

    async updateActiveProject(cmakeProject?: CMakeProject): Promise<void> {
        // Update Active Project
        await treeDataProvider.updateActiveProject(cmakeProject);
    }

    refresh(node?: Node): Promise<any> {
        return treeDataProvider.refresh(node);
    }

    clear(): Promise<any> {
        return treeDataProvider.clear();
    }

    dispose() {
        vscode.Disposable.from(...this.disposables).dispose();
        treeDataProvider.dispose();
    }

    async hideBuildButton(isHidden: boolean) {
        await treeDataProvider.hideBuildButton(isHidden);
    }

    async hideDebugButton(isHidden: boolean) {
        await treeDataProvider.hideDebugButton(isHidden);
    }

    async hideLaunchButton(isHidden: boolean) {
        await treeDataProvider.hideLaunchButton(isHidden);
    }

    async setIsBusy(isBusy: boolean) {
        await treeDataProvider.setIsBusy(isBusy);
    }

    async doStatusBarChange() {
        await treeDataProvider.doStatusBarChange();
    }

}

class TreeDataProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {

    private treeView: vscode.TreeView<Node>;
    private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
    private activeCMakeProject?: CMakeProject;
    private isBuildButtonHidden: boolean = false;
    private isDebugButtonHidden: boolean = false;
    private isLaunchButtonHidden: boolean = false;
    private isBusy: boolean = false;

    get onDidChangeTreeData(): vscode.Event<Node | undefined> {
        return this._onDidChangeTreeData.event;
    }

    constructor() {
        this.treeView = vscode.window.createTreeView('cmake.projectStatus', { treeDataProvider: this });
    }

    get cmakeProject(): CMakeProject | undefined {
        return this.activeCMakeProject;
    }

    async updateActiveProject(cmakeProject?: CMakeProject): Promise<void> {
        // Use project to create the tree
        if (cmakeProject) {
            this.activeCMakeProject = cmakeProject;
            // this.isBuildButtonHidden = cmakeProject.hideBuildButton;
            // this.isDebugButtonHidden = cmakeProject.hideDebugButton;
            // this.isLaunchButtonHidden = cmakeProject.hideLaunchButton;
            // temporary to not allow status bar settings to affect side bar view
            this.isBuildButtonHidden = false;
            this.isDebugButtonHidden = false;
            this.isLaunchButtonHidden = false;
        } else {
            this.isBuildButtonHidden = false;
            this.isDebugButtonHidden = false;
            this.isLaunchButtonHidden = false;
        }
        await this.refresh();
    }

    public async refresh(node?: Node): Promise<any> {
        if (node) {
            await node.refresh();
            this._onDidChangeTreeData.fire(node);
        } else {
            this._onDidChangeTreeData.fire(undefined);
        }
    }

    clear(): Promise<any> {
        this.activeCMakeProject = undefined;
        return this.refresh();
    }

    dispose(): void {
        this.treeView.dispose();
    }

    getTreeItem(node: Node): vscode.TreeItem {
        return node.getTreeItem();
    }

    async getChildren(node?: Node | undefined): Promise<Node[]> {
        if (node) {
            return node.getChildren();
        } else {
            // Initializing the tree for the first time
            const nodes: Node[] = [];
            const projectNode = new ProjectNode();
            await projectNode.initialize();
            nodes.push(projectNode);

            const configNode = new ConfigNode();
            await configNode.initialize();
            if (this.isBusy) {
                configNode.convertToStopCommand();
            }
            nodes.push(configNode);

            if (!this.isBuildButtonHidden) {
                const buildNode = new BuildNode();
                await buildNode.initialize();
                if (this.isBusy) {
                    buildNode.convertToStopCommand();
                }
                nodes.push(buildNode);
            }

            const testNode = new TestNode();
            await testNode.initialize();
            nodes.push(testNode);

            if (this.cmakeProject?.useCMakePresets) {
               const packageNode = new PackageNode();
               await packageNode.initialize();
               if (this.isBusy) {
                  packageNode.convertToStopCommand();
               }
               nodes.push(packageNode);

               const workflowNode = new WorkflowNode();
               await workflowNode.initialize();
               if (this.isBusy) {
                  workflowNode.convertToStopCommand();
               }
               nodes.push(workflowNode);
            }

            if (!this.isDebugButtonHidden) {
                const debugNode = new DebugNode();
                await debugNode.initialize();
                nodes.push(debugNode);
            }
            if (!this.isLaunchButtonHidden) {
                const launchNode = new LaunchNode();
                await launchNode.initialize();
                nodes.push(launchNode);
            }
            return nodes;
        }
    }

    public async doStatusBarChange() {
        // temporary change to prevent status bar settings from affecting side bar
        // let didChange: boolean = false;
        // if (this.activeCMakeProject) {
        //     if (this.isBuildButtonHidden !== this.activeCMakeProject.hideBuildButton) {
        //         didChange = true;
        //         this.isBuildButtonHidden = this.activeCMakeProject.hideBuildButton;
        //     }
        //     if (this.isDebugButtonHidden !== this.activeCMakeProject.hideDebugButton) {
        //         didChange = true;
        //         this.isDebugButtonHidden = this.activeCMakeProject.hideDebugButton;
        //     }
        //     if (this.isLaunchButtonHidden !== this.activeCMakeProject.hideLaunchButton) {
        //         didChange = true;
        //         this.isLaunchButtonHidden = this.activeCMakeProject.hideLaunchButton;
        //     }
        // if (didChange) {
        //     await this.refresh();
        // }
        // }
    }

    public async hideBuildButton(isHidden: boolean) {
        if (isHidden !== this.isBuildButtonHidden) {
            if (this.activeCMakeProject) {
                this.activeCMakeProject.hideBuildButton = isHidden;
            }
            this.isBuildButtonHidden = isHidden;
            await this.refresh();
        }
    }

    public async hideDebugButton(isHidden: boolean): Promise<void> {
        if (isHidden !== this.isDebugButtonHidden) {
            if (this.activeCMakeProject) {
                this.activeCMakeProject.hideDebugButton = isHidden;
            }
            this.isDebugButtonHidden = isHidden;
            await this.refresh();
        }
    }

    public async hideLaunchButton(isHidden: boolean): Promise<void> {
        if (isHidden !== this.isLaunchButtonHidden) {
            if (this.activeCMakeProject) {
                this.activeCMakeProject.hideLaunchButton = isHidden;
            }
            this.isLaunchButtonHidden = isHidden;
            await this.refresh();
        }
    }

    async setIsBusy(isBusy: boolean): Promise<void> {
        if (this.isBusy !== isBusy) {
            this.isBusy = isBusy;
            await this.refresh();
        }
    }

}

class Node extends vscode.TreeItem {

    constructor(label?: string | vscode.TreeItemLabel) {
        super(label ? label : "");
    }

    getTreeItem(): vscode.TreeItem {
        return this;
    }

    getChildren(): Node[] {
        return [];
    }

    async initialize(): Promise<void> {
    }

    async refresh(): Promise<void> {
    }

    convertToStopCommand(): void {
    }

    convertToOriginalCommand(): void {
    }
}

class ConfigNode extends Node {

    private kit?: Kit;
    private variant?: Variant;
    private configPreset?: ConfigPreset;

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = localize('Configure', 'Configure');
        this.tooltip = this.label;
        this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        this.contextValue = "configure";
        await this.InitializeChildren();
    }

    async InitializeChildren(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        if (!treeDataProvider.cmakeProject.useCMakePresets) {
            this.kit = new Kit();
            await this.kit.initialize();
            this.variant = new Variant();
            await this.variant.initialize();
        } else {
            this.configPreset = new ConfigPreset();
            await this.configPreset.initialize();
        }
    }

    getChildren(): Node[] {
        if (!treeDataProvider.cmakeProject) {
            return [];
        }
        if (!treeDataProvider.cmakeProject.useCMakePresets) {
            return [this.kit!, this.variant!];
        } else {
            return [this.configPreset!];
        }
    }

    convertToStopCommand(): void {
        this.label = localize("configure.running", "Configure (Running)");
        const title: string = localize('Stop', 'Stop');
        this.tooltip = title;
        this.contextValue = "stop";
    }

    convertToOriginalCommand(): Promise<void> {
        return this.initialize();
    }

}

class BuildNode extends Node {

    private buildTarget?: BuildTarget;
    private buildPreset?: BuildPreset;

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = localize('Build', 'Build');
        this.tooltip = this.label;
        this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        this.contextValue = 'build';
        await this.InitializeChildren();
    }

    async InitializeChildren(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        if (treeDataProvider.cmakeProject.useCMakePresets) {
            this.buildPreset = new BuildPreset();
            await this.buildPreset.initialize();
        }
        this.buildTarget = new BuildTarget();
        await this.buildTarget.initialize();
    }

    getChildren(): Node[] {
        if (!treeDataProvider.cmakeProject) {
            return [];
        }
        if (!treeDataProvider.cmakeProject.useCMakePresets) {
            return [this.buildTarget!];
        } else {
            return [this.buildPreset!, this.buildTarget!];
        }
    }

    convertToStopCommand(): void {
        this.label = localize("build.running", "Build (Running)");
        const title: string = localize('Stop', 'Stop');
        this.tooltip = title;
        this.contextValue = "stop";
    }

    convertToOriginalCommand(): Promise<void> {
        return this.initialize();
    }

}

class TestNode extends Node {

    private testTarget?: TestTarget;
    private testPreset?: TestPreset;

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = localize('Test', 'Test');
        this.tooltip = this.label;
        this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        this.contextValue = 'test';
        await this.InitializeChildren();
    }

    async InitializeChildren(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        if (!treeDataProvider.cmakeProject.useCMakePresets) {
            this.testTarget = new TestTarget();
            await this.testTarget.initialize();
        } else {
            this.testPreset = new TestPreset();
            await this.testPreset.initialize();
        }
    }

    getChildren(): Node[] {
        if (!treeDataProvider.cmakeProject) {
            return [];
        }
        if (!treeDataProvider.cmakeProject.useCMakePresets) {
            return [this.testTarget!];
        } else {
            return [this.testPreset!];
        }
    }

}

class PackageNode extends Node {
    private packagePreset?: PackagePreset;

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = localize('Package', 'Package');
        this.tooltip = this.label;
        this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        this.contextValue = "package";
        await this.InitializeChildren();
    }

    async InitializeChildren(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        if (treeDataProvider.cmakeProject.useCMakePresets) {
            this.packagePreset = new PackagePreset();
            await this.packagePreset.initialize();
        }
    }

    getChildren(): Node[] {
        if (!treeDataProvider.cmakeProject) {
            return [];
        }
        if (treeDataProvider.cmakeProject.useCMakePresets) {
            return [this.packagePreset!];
        } else {
            return [];
        }
    }

    convertToStopCommand(): void {
        this.label = localize("cpack.running", "CPack (packaging)");
        const title: string = localize('Stop', 'Stop');
        this.tooltip = title;
        this.contextValue = "stop";
    }

    convertToOriginalCommand(): Promise<void> {
        return this.initialize();
    }

}

class WorkflowNode extends Node {
    private workflowPreset?: WorkflowPreset;

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = localize('Workflow', 'Workflow');
        this.tooltip = this.label;
        this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        this.contextValue = "workflow";
        await this.InitializeChildren();
    }

    async InitializeChildren(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        if (treeDataProvider.cmakeProject.useCMakePresets) {
            this.workflowPreset = new WorkflowPreset();
            await this.workflowPreset.initialize();
        }
    }

    getChildren(): Node[] {
        if (!treeDataProvider.cmakeProject) {
            return [];
        }
        if (treeDataProvider.cmakeProject.useCMakePresets) {
            return [this.workflowPreset!];
        } else {
            return [];
        }
    }

    convertToStopCommand(): void {
        this.label = localize("workflow.running", "Workflow (Running)");
        const title: string = localize('Stop', 'Stop');
        this.tooltip = title;
        this.contextValue = "stop";
    }

    convertToOriginalCommand(): Promise<void> {
        return this.initialize();
    }

}

class DebugNode extends Node {

    private target?: DebugTarget;

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = localize('Debug', 'Debug');
        this.tooltip = this.label;
        this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        this.contextValue = 'debug';
        await this.InitializeChildren();
    }

    async InitializeChildren(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.target = new DebugTarget();
        await this.target.initialize();
    }

    getChildren(): Node[] {
        if (!treeDataProvider.cmakeProject) {
            return [];
        }
        return [this.target!];
    }

}

class LaunchNode extends Node {

    private launchTarget?: LaunchTarget;

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = localize('Launch', 'Launch');
        this.tooltip = this.label;
        this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        this.contextValue = 'launch';
        await this.InitializeChildren();
    }

    async InitializeChildren(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.launchTarget = new LaunchTarget();
        await this.launchTarget.initialize();
    }

    getChildren(): Node[] {
        if (!treeDataProvider.cmakeProject) {
            return [];
        }
        return [this.launchTarget!];
    }

}

class ProjectNode extends Node {

    private project?: Project;

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = localize('Project', 'Project');
        this.tooltip = localize('active.project', 'Active project');
        this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        await this.InitializeChildren();
    }

    async InitializeChildren(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.project = new Project();
        await this.project!.initialize();
    }

    getChildren(): Node[] {
        if (!treeDataProvider.cmakeProject) {
            return [];
        }
        return [this.project!];
    }

}

class ConfigPreset extends Node {

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject || !treeDataProvider.cmakeProject.useCMakePresets) {
            return;
        }
        this.label = (treeDataProvider.cmakeProject.configurePreset?.displayName ?? treeDataProvider.cmakeProject.configurePreset?.name) || noConfigPresetSelected;
        this.tooltip = 'Change Configure Preset';
        this.contextValue = 'configPreset';
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
    }

    async refresh() {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = (treeDataProvider.cmakeProject.configurePreset?.displayName ?? treeDataProvider.cmakeProject.configurePreset?.name) || noConfigPresetSelected;
    }
}

class BuildPreset extends Node {

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject || !treeDataProvider.cmakeProject.useCMakePresets) {
            return;
        }
        this.label = (treeDataProvider.cmakeProject.buildPreset?.displayName ?? treeDataProvider.cmakeProject.buildPreset?.name) || noBuildPresetSelected;
        if (this.label === preset.defaultBuildPreset.name) {
            this.label = preset.defaultBuildPreset.displayName;
        }
        this.tooltip = 'Change Build Preset';
        this.contextValue = 'buildPreset';
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
    }

    async refresh() {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = (treeDataProvider.cmakeProject.buildPreset?.displayName ?? treeDataProvider.cmakeProject.buildPreset?.name) || noBuildPresetSelected;
    }
}

class TestPreset extends Node {

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject || !treeDataProvider.cmakeProject.useCMakePresets) {
            return;
        }
        this.label = (treeDataProvider.cmakeProject.testPreset?.displayName ?? treeDataProvider.cmakeProject.testPreset?.name) || noTestPresetSelected;
        if (this.label === preset.defaultTestPreset.name) {
            this.label = preset.defaultTestPreset.displayName;
        }
        this.tooltip = 'Change Test Preset';
        this.contextValue = 'testPreset';
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
    }

    async refresh() {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = (treeDataProvider.cmakeProject.testPreset?.displayName ?? treeDataProvider.cmakeProject.testPreset?.name)  || noTestPresetSelected;
    }
}

class PackagePreset extends Node {

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject || !treeDataProvider.cmakeProject.useCMakePresets) {
            return;
        }
        this.label = (treeDataProvider.cmakeProject.packagePreset?.displayName ?? treeDataProvider.cmakeProject.packagePreset?.name) || noPackagePresetSelected;
        if (this.label === preset.defaultPackagePreset.name) {
            this.label = preset.defaultPackagePreset.displayName;
        }
        this.tooltip = 'Change Package Preset';
        this.contextValue = 'packagePreset';
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
    }

    async refresh() {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = (treeDataProvider.cmakeProject.packagePreset?.displayName ?? treeDataProvider.cmakeProject.packagePreset?.name)  || noPackagePresetSelected;
    }
}

class WorkflowPreset extends Node {

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject || !treeDataProvider.cmakeProject.useCMakePresets) {
            return;
        }
        this.label = (treeDataProvider.cmakeProject.workflowPreset?.displayName ?? treeDataProvider.cmakeProject.workflowPreset?.name) || noWorkflowPresetSelected;
        if (this.label === preset.defaultWorkflowPreset.name) {
            this.label = preset.defaultWorkflowPreset.displayName;
        }
        this.tooltip = 'Change Workflow Preset';
        this.contextValue = 'workflowPreset';
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
    }

    async refresh() {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = (treeDataProvider.cmakeProject.workflowPreset?.displayName ?? treeDataProvider.cmakeProject.workflowPreset?.name)  || noWorkflowPresetSelected;
    }
}

class Kit extends Node {

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = treeDataProvider.cmakeProject.activeKit?.name || noKitSelected;
        this.tooltip = "Change Kit";
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        this.contextValue = 'kit';
    }

    getTreeItem(): vscode.TreeItem {
        if (!treeDataProvider.cmakeProject) {
            return this;
        }
        this.label = treeDataProvider.cmakeProject.activeKit?.name || noKitSelected;
        return this;
    }
}

class BuildTarget extends Node {

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        const title: string = localize('set.build.target', 'Set Build Target');
        this.label = await treeDataProvider.cmakeProject.buildTargetName() || await treeDataProvider.cmakeProject.allTargetName;
        this.tooltip = title;
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        this.contextValue = 'buildTarget';
    }

    async refresh() {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = await treeDataProvider.cmakeProject.buildTargetName() || await treeDataProvider.cmakeProject.allTargetName;
    }
}

class TestTarget extends Node {

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = "[All tests]";
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        // Set the contextValue to 'testTarget' when we implement setTestTarget to choose a target for a test.
    }

    async refresh() {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = "[All tests]";
    }
}

class DebugTarget extends Node {

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = treeDataProvider.cmakeProject.launchTargetName || await treeDataProvider.cmakeProject.allTargetName;
        const title: string = localize('set.debug.target', 'Set debug target');
        this.tooltip = title;
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        this.contextValue = 'debugTarget';
    }

    async refresh() {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = treeDataProvider.cmakeProject.launchTargetName || await treeDataProvider.cmakeProject.allTargetName;
    }
}

class LaunchTarget extends Node {

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = treeDataProvider.cmakeProject.launchTargetName || await treeDataProvider.cmakeProject.allTargetName;
        const title: string = localize('set.launch.target', 'Set Launch Target');
        this.tooltip = title;
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        this.contextValue = 'launchTarget';
    }

    async refresh() {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = treeDataProvider.cmakeProject.launchTargetName || await treeDataProvider.cmakeProject.allTargetName;
    }
}

class Project extends Node {

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = treeDataProvider.cmakeProject.folderName;
        const title: string = localize('select.active.project', 'Select active project');
        this.tooltip = title;
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        this.contextValue = 'activeProject';
    }

    async refresh() {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = treeDataProvider.cmakeProject.folderName;
    }
}
class Variant extends Node {

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = treeDataProvider.cmakeProject.activeVariantName || "Debug";
        this.tooltip = "Set variant";
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        this.contextValue = 'variant';
    }

    async refresh(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = treeDataProvider.cmakeProject.activeVariantName || "Debug";
    }
}
