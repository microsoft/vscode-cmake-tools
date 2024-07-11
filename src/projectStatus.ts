import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import CMakeProject from './cmakeProject';
import * as preset from './preset';
import { runCommand } from './util';
import { OptionConfig, checkBuildOverridesPresent, checkConfigureOverridesPresent, checkTestOverridesPresent, checkPackageOverridesPresent } from './config';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
const noKitSelected = localize('no.kit.selected', '[No Kit Selected]');
const noConfigPresetSelected = localize('no.configure.preset.selected', '[No Configure Preset Selected]');
const noBuildPresetSelected = localize('no.build.preset.selected', '[No Build Preset Selected]');
const noTestPresetSelected = localize('no.test.preset.selected', '[No Test Preset Selected]');
const noPackagePresetSelected = localize('no.package.preset.selected', '[No Package Preset Selected]');
const noWorkflowPresetSelected = localize('no.workflow.preset.selected', '[No Workflow Preset Selected]');

export let treeDataProvider: TreeDataProvider;

export class ProjectStatus {

    protected disposables: vscode.Disposable[] = [];

    constructor() {
        treeDataProvider = new TreeDataProvider();
        this.disposables.push(...[
            // Commands for projectStatus items
            vscode.commands.registerCommand('cmake.projectStatus.stop', async (_node: Node) => {
                await runCommand('stop');
            }),
            vscode.commands.registerCommand('cmake.projectStatus.cleanConfigure', async (_node: Node) => {
                await runCommand('cleanConfigure');
                await this.refresh();
            }),
            vscode.commands.registerCommand('cmake.projectStatus.openSettings', async(_node: Node) => {
                await runCommand('openSettings');
            }),
            vscode.commands.registerCommand('cmake.projectStatus.openVisibilitySettings', async(_node: Node) => {
                await this.openVisibilitySettings();
            }),
            vscode.commands.registerCommand('cmake.projectStatus.selectKit', async (_node: Node) => {
                await runCommand('selectKit');
                await this.refresh();
            }),
            vscode.commands.registerCommand('cmake.projectStatus.selectConfigurePreset', async (node: Node) => {
                await runCommand('selectConfigurePreset');
                await this.refresh(node);
            }),
            vscode.commands.registerCommand('cmake.projectStatus.viewConfigureSettings', async (_node: Node) => {
                await runCommand('viewConfigureSettings');
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
            vscode.commands.registerCommand('cmake.projectStatus.viewBuildSettings', async (_node: Node) => {
                await runCommand('viewBuildSettings');
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
            vscode.commands.registerCommand('cmake.projectStatus.viewTestSettings', async (_node: Node) => {
                await runCommand('viewTestSettings');
            }),
            vscode.commands.registerCommand('cmake.projectStatus.selectPackagePreset', async (node: Node) => {
                await runCommand('selectPackagePreset');
                await this.refresh(node);
            }),
            vscode.commands.registerCommand('cmake.projectStatus.viewPackageSettings', async (_node: Node) => {
                await runCommand('viewPackageSettings');
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

    async openVisibilitySettings(): Promise<void> {
        await vscode.commands.executeCommand('workbench.action.openSettingsJson', { revealSetting: { key: 'cmake.options.advanced' }});
    }

    async updateActiveProject(cmakeProject?: CMakeProject, options?: OptionConfig): Promise<void> {
        // Update Active Project
        await treeDataProvider.updateActiveProject(cmakeProject, options);
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

    async doStatusChange(options: OptionConfig) {
        await treeDataProvider.doStatusChange(options);
    }

}

class TreeDataProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {

    private treeView: vscode.TreeView<Node>;
    private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
    private activeCMakeProject?: CMakeProject;
    private isFolderButtonHidden: boolean = false;
    private isConfigButtonHidden: boolean = false;
    private isBuildButtonHidden: boolean = false;
    private isTestButtonHidden: boolean = false;
    private isPackageButtonHidden: boolean = false;
    private isWorkflowButtonHidden: boolean = false;
    private isDebugButtonHidden: boolean = false;
    private isLaunchButtonHidden: boolean = false;
    private isBusy: boolean = false;
    private configNode: ConfigNode | undefined;
    private buildNode: BuildNode | undefined;
    private testNode: TestNode | undefined;
    private packageNode: PackageNode | undefined;
    private workflowNode: WorkflowNode | undefined;

    get onDidChangeTreeData(): vscode.Event<Node | undefined> {
        return this._onDidChangeTreeData.event;
    }

    constructor() {
        this.treeView = vscode.window.createTreeView('cmake.projectStatus', { treeDataProvider: this });
    }

    get cmakeProject(): CMakeProject | undefined {
        return this.activeCMakeProject;
    }

    async updateActiveProject(cmakeProject?: CMakeProject, options?: OptionConfig): Promise<void> {
        // Use project to create the tree
        if (cmakeProject) {
            this.activeCMakeProject = cmakeProject;
            await this.doStatusChange(options);
        } else {
            this.isConfigButtonHidden = false;
            this.isFolderButtonHidden = false;
            this.isBuildButtonHidden = false;
            this.isTestButtonHidden = false;
            this.isPackageButtonHidden = false;
            this.isWorkflowButtonHidden = false;
            this.isDebugButtonHidden = false;
            this.isLaunchButtonHidden = false;
        }
        await this.refresh();
    }

    public async refreshNode(node: ConfigNode | BuildNode | TestNode | PackageNode | WorkflowNode | undefined): Promise<any> {
        if (node) {
            await node.refresh();
            this._onDidChangeTreeData.fire(node);
        }
    }

    public async refreshConfigNode(): Promise<any> {
        await this.refreshNode(this.configNode);
    }

    public async refreshBuildNode(): Promise<any> {
        await this.refreshNode(this.buildNode);
    }

    public async refreshTestNode(): Promise<any> {
        await this.refreshNode(this.testNode);
    }

    public async refreshPackageNode(): Promise<any> {
        await this.refreshNode(this.packageNode);
    }

    public async refreshWorkflowNode(): Promise<any> {
        await this.refreshNode(this.workflowNode);
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
            if (!this.isFolderButtonHidden) {
                const folderNode = new FolderNode();
                await folderNode.initialize();
                if (this.isBusy) {
                    folderNode.convertToStopCommand();
                }
                nodes.push(folderNode);
            }
            if (!this.isConfigButtonHidden) {
                const configNode = new ConfigNode();
                this.configNode = configNode;
                await configNode.initialize();
                if (this.isBusy) {
                    configNode.convertToStopCommand();
                }
                nodes.push(configNode);
            }
            if (!this.isBuildButtonHidden) {
                const buildNode = new BuildNode();
                this.buildNode = buildNode;
                await buildNode.initialize();
                if (this.isBusy) {
                    buildNode.convertToStopCommand();
                }
                nodes.push(buildNode);
            }
            if (!this.isTestButtonHidden) {
                const testNode = new TestNode();
                this.testNode = testNode;
                await testNode.initialize();
                if (this.isBusy) {
                    testNode.convertToStopCommand();
                }
                nodes.push(testNode);
            }
            if (this.cmakeProject?.useCMakePresets) {
                if (!this.isPackageButtonHidden) {
                    const packageNode = new PackageNode();
                    this.packageNode = packageNode;
                    await packageNode.initialize();
                    if (this.isBusy) {
                        packageNode.convertToStopCommand();
                    }
                    nodes.push(packageNode);
                }
                if (!this.isWorkflowButtonHidden) {
                    const workflowNode = new WorkflowNode();
                    this.workflowNode = workflowNode;
                    await workflowNode.initialize();
                    if (this.isBusy) {
                        workflowNode.convertToStopCommand();
                    }
                    nodes.push(workflowNode);
                }
            }
            if (!this.isDebugButtonHidden) {
                const debugNode = new DebugNode();
                await debugNode.initialize();
                if (this.isBusy) {
                    debugNode.convertToStopCommand();
                }
                nodes.push(debugNode);
            }
            if (!this.isLaunchButtonHidden) {
                const launchNode = new LaunchNode();
                await launchNode.initialize();
                if (this.isBusy) {
                    launchNode.convertToStopCommand();
                }
                nodes.push(launchNode);
            }
            return nodes;
        }
    }

    // TODO: get rid of undefined?
    public async doStatusChange(options: OptionConfig | undefined) {
        let didChange: boolean = false;
        if (this.activeCMakeProject) {
            const folderVisibility = options?.advanced?.folder?.projectStatusVisibility !== "hidden";
            if (folderVisibility === this.isFolderButtonHidden) {
                didChange = true;
                this.isFolderButtonHidden = !folderVisibility;
            }
            const configureVisibility = options?.advanced?.configure?.projectStatusVisibility !== "hidden";
            if (configureVisibility === this.isConfigButtonHidden) {
                didChange = true;
                this.isConfigButtonHidden = !configureVisibility;
            }
            const buildVisibility = options?.advanced?.build?.projectStatusVisibility !== "hidden";
            if (buildVisibility === this.isBuildButtonHidden) {
                didChange = true;
                this.isBuildButtonHidden = !buildVisibility;
            }
            const testVisibility = options?.advanced?.ctest?.projectStatusVisibility !== "hidden";
            if (testVisibility === this.isTestButtonHidden) {
                didChange = true;
                this.isTestButtonHidden = !testVisibility;
            }
            const packageVisibility = options?.advanced?.cpack?.projectStatusVisibility !== "hidden";
            if (packageVisibility === this.isPackageButtonHidden) {
                didChange = true;
                this.isPackageButtonHidden = !packageVisibility;
            }
            const workflowVisibility = options?.advanced?.workflow?.projectStatusVisibility !== "hidden";
            if (workflowVisibility === this.isWorkflowButtonHidden) {
                didChange = true;
                this.isWorkflowButtonHidden = !workflowVisibility;
            }
            const debugVisibility = options?.advanced?.debug?.projectStatusVisibility !== "hidden";
            if (debugVisibility === this.isDebugButtonHidden) {
                didChange = true;
                this.isDebugButtonHidden = !debugVisibility;
            }
            const launchVisibility = options?.advanced?.launch?.projectStatusVisibility !== "hidden";
            if (launchVisibility === this.isLaunchButtonHidden) {
                didChange = true;
                this.isLaunchButtonHidden = !launchVisibility;
            }
        }
        if (didChange) {
            await this.refresh();
        }
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

    async refresh(): Promise<void> {
        await this.configPreset?.refresh();
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

    async refresh(): Promise<void> {
        await this.buildPreset?.refresh();
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

    async refresh(): Promise<void> {
        await this.testPreset?.refresh();
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

    async refresh(): Promise<void> {
        await this.packagePreset?.refresh();
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

class FolderNode extends Node {

    private project?: Project;

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = localize('Folder', 'Folder');
        this.tooltip = localize('active.folder', 'Active Folder');
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
        this.label = (treeDataProvider.cmakeProject.configurePreset?.displayName || treeDataProvider.cmakeProject.configurePreset?.name) || noConfigPresetSelected;
        this.tooltip = localize("configPreset.change", "Change Configure Preset");
        this.contextValue = 'configPreset';
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        await this.updateDescription();
    }

    async refresh() {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = (treeDataProvider.cmakeProject.configurePreset?.displayName || treeDataProvider.cmakeProject.configurePreset?.name) || noConfigPresetSelected;
        await this.updateDescription();
    }

    private async updateDescription(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        const config = (await treeDataProvider.cmakeProject.getCMakeDriverInstance())?.config;
        if (config && checkConfigureOverridesPresent(config)) {
            this.description = localize("override.settings.applied", "Override settings applied");
            this.contextValue = 'configPreset - overrides present';
        } else {
            this.description = "";
            this.contextValue = 'configPreset';
        }
    }
}

class BuildPreset extends Node {

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject || !treeDataProvider.cmakeProject.useCMakePresets) {
            return;
        }
        this.label = (treeDataProvider.cmakeProject.buildPreset?.displayName || treeDataProvider.cmakeProject.buildPreset?.name) || noBuildPresetSelected;
        if (this.label === preset.defaultBuildPreset.name) {
            this.label = preset.defaultBuildPreset.displayName;
        }
        this.tooltip = localize("buildPreset.change", "Change Build Preset");
        this.contextValue = 'buildPreset';
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        await this.updateDescription();
    }

    async refresh() {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = (treeDataProvider.cmakeProject.buildPreset?.displayName || treeDataProvider.cmakeProject.buildPreset?.name) || noBuildPresetSelected;
        await this.updateDescription();
    }

    private async updateDescription(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }

        const config = (await treeDataProvider.cmakeProject.getCMakeDriverInstance())?.config;
        if (config && checkBuildOverridesPresent(config)) {
            this.description = localize("override.settings.applied", "Override settings applied");
            this.contextValue = 'buildPreset - overrides present';
        } else {
            this.description = "";
            this.contextValue = 'buildPreset';
        }
    }
}

class TestPreset extends Node {

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject || !treeDataProvider.cmakeProject.useCMakePresets) {
            return;
        }
        this.label = (treeDataProvider.cmakeProject.testPreset?.displayName || treeDataProvider.cmakeProject.testPreset?.name) || noTestPresetSelected;
        if (this.label === preset.defaultTestPreset.name) {
            this.label = preset.defaultTestPreset.displayName;
        }
        this.tooltip = localize("testPreset.change", "Change Test Preset");
        this.contextValue = 'testPreset';
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        await this.updateDescription();
    }

    async refresh() {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = (treeDataProvider.cmakeProject.testPreset?.displayName || treeDataProvider.cmakeProject.testPreset?.name) || noTestPresetSelected;
        await this.updateDescription();
    }

    private async updateDescription(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }

        const config = (await treeDataProvider.cmakeProject.getCMakeDriverInstance())?.config;
        if (config && checkTestOverridesPresent(config)) {
            this.description = localize("override.settings.applied", "Override settings applied");
            this.contextValue = 'testPreset - overrides present';
        } else {
            this.description = "";
            this.contextValue = 'testPreset';
        }
    }
}

class PackagePreset extends Node {

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject || !treeDataProvider.cmakeProject.useCMakePresets) {
            return;
        }
        this.label = (treeDataProvider.cmakeProject.packagePreset?.displayName || treeDataProvider.cmakeProject.packagePreset?.name)  || noPackagePresetSelected;
        if (this.label === preset.defaultPackagePreset.name) {
            this.label = preset.defaultPackagePreset.displayName;
        }
        this.tooltip = localize("packagePreset.change", "Change Package Preset");
        this.contextValue = 'packagePreset';
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;

        await this.updateDescription();
    }

    async refresh() {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = (treeDataProvider.cmakeProject.packagePreset?.displayName || treeDataProvider.cmakeProject.packagePreset?.name)  || noPackagePresetSelected;
        await this.updateDescription();
    }

    private async updateDescription(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }

        const config = (await treeDataProvider.cmakeProject.getCMakeDriverInstance())?.config;
        if (config && checkPackageOverridesPresent(config)) {
            this.description = localize("override.settings.applied", "Override settings applied");
            this.contextValue = 'packagePreset - overrides present';
        } else {
            this.description = "";
            this.contextValue = 'packagePreset';
        }
    }
}

class WorkflowPreset extends Node {

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject || !treeDataProvider.cmakeProject.useCMakePresets) {
            return;
        }
        this.label = (treeDataProvider.cmakeProject.workflowPreset?.displayName || treeDataProvider.cmakeProject.workflowPreset?.name) || noWorkflowPresetSelected;
        if (this.label === preset.defaultWorkflowPreset.name) {
            this.label = preset.defaultWorkflowPreset.displayName;
        }
        this.tooltip = localize("workflowPreset.change", "Change Workflow Preset");
        this.contextValue = 'workflowPreset';
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
    }

    async refresh() {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = (treeDataProvider.cmakeProject.workflowPreset?.displayName || treeDataProvider.cmakeProject.workflowPreset?.name) || noWorkflowPresetSelected;
    }
}

class Kit extends Node {

    async initialize(): Promise<void> {
        if (!treeDataProvider.cmakeProject) {
            return;
        }
        this.label = treeDataProvider.cmakeProject.activeKit?.name || noKitSelected;
        this.tooltip = localize("kit.change", "Change Kit");
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
        const title: string = localize('set.debug.target', 'Set Debug Target');
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
        const title: string = localize('select.active.folder', 'Select Active Folder');
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
        this.tooltip = localize("set.variant", "Set variant");
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
