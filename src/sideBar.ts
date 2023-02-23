import {
    commands,
    Disposable,
    Event,
    EventEmitter,
    TreeDataProvider,
    TreeItem,
    TreeItemCollapsibleState,
    TreeView,
    window,
    WorkspaceFolder
} from 'vscode';
import * as nls from 'vscode-nls';
import CMakeProject from './cmakeProject';
import { runCommand } from './util';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export class SideBar {

    private sideBarTreeDataProvider: SideBarTreeDataProvider;

    constructor() {
        this.sideBarTreeDataProvider = new SideBarTreeDataProvider();
    }

    async updateActiveProject(cmakeProject?: CMakeProject): Promise<void> {
        // Update Active Project
        await this.sideBarTreeDataProvider.updateActiveProject(cmakeProject);
    }

    refresh(): Promise<any> {
        return this.sideBarTreeDataProvider.refresh();
    }

    clear(): Promise<any> {
        return this.sideBarTreeDataProvider.clear();
    }

    dispose() {
        this.sideBarTreeDataProvider.dispose();
    }

}

export class SideBarTreeDataProvider implements TreeDataProvider<BaseNode>, Disposable {

    private sideBarTreeView: TreeView<BaseNode>;
    protected disposables: Disposable[] = [];
    private _onDidChangeTreeData: EventEmitter<any> = new EventEmitter<any>();
    get onDidChangeTreeData(): Event<BaseNode | undefined> {
        return this._onDidChangeTreeData.event;
    }

    constructor() {
        this.sideBarTreeView = window.createTreeView('cmake.sideBar', { treeDataProvider: this });
        BaseNode.initializeTreeView(this.sideBarTreeView);
        this.disposables.push(...[
            this.sideBarTreeView,
            // Commands for sideBar items
            commands.registerCommand('cmake.sideBar.stop', async (node: BaseNode) => {
                await runCommand('stop');
                await this.refresh(node);
            }),
            commands.registerCommand('cmake.sideBar.selectKit', async (node: BaseNode) => {
                await runCommand('selectKit');
                await this.refresh(node);
            }),
            commands.registerCommand('cmake.sideBar.selectConfigurePreset', async (node: BaseNode, folder: WorkspaceFolder) => {
                await runCommand('selectConfigurePreset', folder);
                await this.refresh(node);
            }),
            commands.registerCommand('cmake.sideBar.configure', async (node: BaseNode, folder: WorkspaceFolder) => {
                node.changeToStop();
                await this.refresh(node);
                // No await on configure
                await runCommand('configure', folder);
                node.changeBackToOriginal();
                await this.refresh(node);
            }),
            commands.registerCommand('cmake.sideBar.setVariant', async (node: BaseNode, folder: WorkspaceFolder, variant: Promise<string>) => {
                await runCommand('setVariant', folder, await variant);
                await this.refresh(node);
            }),
            commands.registerCommand('cmake.sideBar.build', async (node: BaseNode, folder: WorkspaceFolder, target: Promise<string>) => {
                node.changeToStop();
                await this.refresh(node);
                await runCommand('build', folder, await target);
                node.changeBackToOriginal();
                await this.refresh(node);
            }),
            commands.registerCommand('cmake.sideBar.setDefaultTarget', async (node: BaseNode, folder: WorkspaceFolder, target: Promise<string>) => {
                await runCommand('setDefaultTarget', folder, await target);
                await this.refresh(node);
            }),
            commands.registerCommand('cmake.sideBar.selectBuildPreset', async (node: BaseNode, folder: WorkspaceFolder) => {
                await runCommand('selectBuildPreset', folder);
                await this.refresh(node);
            }),
            commands.registerCommand('cmake.sideBar.ctest', async (folder: WorkspaceFolder) => runCommand('ctest', folder)),
            commands.registerCommand('cmake.sideBar.setTestTarget', async (_node: BaseNode, _folder: WorkspaceFolder, _test: Promise<string>) => {
                // Do nothing
            }),
            commands.registerCommand('cmake.sideBar.selectTestPreset', async (node: BaseNode, folder: WorkspaceFolder) => {
                await runCommand('selectTestPreset', folder);
                await this.refresh(node);
            }),
            commands.registerCommand('cmake.sideBar.debugTarget', async (folder: WorkspaceFolder, target?: Promise<string>) => {
                await runCommand('debugTarget', folder, target);
            }),
            commands.registerCommand('cmake.sideBar.setDebugTarget', async (node: BaseNode, folder: WorkspaceFolder, target?: Promise<string>) => {
                await runCommand('selectLaunchTarget', folder, target);
                await this.refresh(node);
            }),
            commands.registerCommand('cmake.sideBar.launchTarget', async (folder: WorkspaceFolder, target?: Promise<string>) => {
                await runCommand('launchTarget', folder, target);
            }),
            commands.registerCommand('cmake.sideBar.setLaunchTarget', async (node: BaseNode, folder: WorkspaceFolder, target?: Promise<string>) => {
                await runCommand('selectLaunchTarget', folder, target);
                await this.refresh(node);
            })
        ]);
    }

    async updateActiveProject(cmakeProject?: CMakeProject): Promise<void> {
        // Use project to create the tree
        if (cmakeProject) {
            BaseNode.updateActiveProject(cmakeProject);
            await this.refresh();
        }
    }

    public async refresh(node?: BaseNode): Promise<any> {
        if (node) {
            await node.refresh();
            this._onDidChangeTreeData.fire(node);
        } else {
            this._onDidChangeTreeData.fire(undefined);
        }
    }

    clear(): Promise<any> {
        BaseNode.updateActiveProject(undefined);
        return this.refresh();
    }

    dispose(): void {
        Disposable.from(...this.disposables).dispose();
    }

    getTreeItem(node: BaseNode): TreeItem {
        return node.getTreeItem();
    }

    async getChildren(node?: BaseNode | undefined): Promise<BaseNode[]> {
        // Initializing the tree for the first time
        if (!node) {
            const configNode = new ConfigNode();
            await configNode.initialize();
            const buildNode = new BuildNode();
            await buildNode.initialize();
            const testNode = new TestNode();
            await testNode.initialize();
            const debugNode = new SingleItemNode(TargetType.Debug);
            await debugNode.initialize();
            const launchNode = new SingleItemNode(TargetType.Launch);
            await launchNode.initialize();
            const projectNode = new SingleItemNode(TargetType.Project);
            await projectNode.initialize();
            return [configNode, buildNode, testNode, debugNode, launchNode, projectNode];
        } else {
            return node.getChildren();
        }
    }

}

export class BaseNode extends TreeItem {

    static sideBarTreeView?: TreeView<BaseNode>;
    static cmakeProject?: CMakeProject;

    static initializeTreeView(sideBarTreeView: TreeView<BaseNode>) {
        BaseNode.sideBarTreeView = sideBarTreeView;
    }

    static updateActiveProject(cmakeProject?: CMakeProject): void {
        // Use project to create the tree
        if (cmakeProject) {
            BaseNode.cmakeProject = cmakeProject;
        }
    }

    getTreeItem(): TreeItem {
        return this;
    }

    getChildren(): BaseNode[] {
        return [];
    }

    async initialize(): Promise<void> {
    }

    async refresh(): Promise<void> {
    }

    changeToStop(): void {
    }

    changeBackToOriginal(): void {
    }
}

export class ConfigNode extends BaseNode {

    private kit?: KitNode;
    private variant?: VariantNode;
    private preset?: PresetNode;

    constructor() {
        super(NodeType.Configure);
    }

    async initialize(): Promise<void> {
        if (!BaseNode.cmakeProject) {
            return;
        }
        this.command = {
            title: localize('Configure', 'Configure'),
            command: 'cmake.sideBar.configure',
            arguments: [this, BaseNode.cmakeProject.workspaceFolder]
        };
        this.tooltip = "Configure";
        this.collapsibleState = TreeItemCollapsibleState.Expanded;
        this.contextValue = "configure";
        await this.InitializeChildren();
    }

    async InitializeChildren(): Promise<void> {
        if (!BaseNode.cmakeProject) {
            return;
        }
        if (!BaseNode.cmakeProject.useCMakePresets) {
            this.kit = new KitNode();
            await this.kit.initialize();
            this.variant = new VariantNode();
            await this.variant.initialize();
        } else {
            this.preset = new PresetNode(PresetType.Configure);
            await this.preset.initialize();
        }
    }

    getChildren(): BaseNode[] {
        if (!BaseNode.cmakeProject) {
            return [];
        }
        if (!BaseNode.cmakeProject.useCMakePresets) {
            return [this.kit!, this.variant!];
        } else {
            return [this.preset!];
        }
    }

    changeToStop(): void {
        this.label = NodeType.Configure + " (Running)";
        this.command = {
            title: localize('Stop', 'Stop'),
            command: 'cmake.sideBar.stop',
            arguments: []
        };
        this.tooltip = "Stop";
        this.contextValue = "stop";
    }

    changeBackToOriginal(): Promise<void> {
        this.label = NodeType.Configure;
        return this.initialize();
    }

}

export class BuildNode extends BaseNode {

    private target?: TargetNode;
    private preset?: PresetNode;

    constructor() {
        super(NodeType.Build);
    }

    async initialize(): Promise<void> {
        if (!BaseNode.cmakeProject) {
            return;
        }
        this.command = {
            title: localize('Build', 'Build'),
            command: 'cmake.sideBar.build',
            arguments: [this, BaseNode.cmakeProject.workspaceFolder, BaseNode.cmakeProject.buildTargetName()]
        };
        this.tooltip = 'Build';
        this.collapsibleState = TreeItemCollapsibleState.Expanded;
        this.contextValue = 'build';
        await this.InitializeChildren();
    }

    async InitializeChildren(): Promise<void> {
        if (!BaseNode.cmakeProject) {
            return;
        }
        if (!BaseNode.cmakeProject.useCMakePresets) {
            this.target = new TargetNode(TargetType.Build);
            await this.target.initialize();
        } else {
            this.preset = new PresetNode(PresetType.Build);
            await this.preset.initialize();
        }
    }

    getChildren(): BaseNode[] {
        if (!BaseNode.cmakeProject) {
            return [];
        }
        if (!BaseNode.cmakeProject.useCMakePresets) {
            return [this.target!];
        } else {
            return [this.preset!];
        }
    }

    changeToStop(): void {
        this.label = NodeType.Build + " (Running)";
        this.command = {
            title: localize('Stop', 'Stop'),
            command: 'cmake.sideBar.stop',
            arguments: []
        };
        this.tooltip = "Stop";
        this.contextValue = "stop";
    }

    changeBackToOriginal(): Promise<void> {
        this.label = NodeType.Build;
        return this.initialize();
    }

}

export class TestNode extends BaseNode {

    private target?: TargetNode;
    private preset?: PresetNode;

    constructor() {
        super(NodeType.Test);
    }

    async initialize(): Promise<void> {
        if (!BaseNode.cmakeProject) {
            return;
        }
        this.command = {
            title: localize('Test', 'Test'),
            command: 'cmake.sideBar.test',
            arguments: [BaseNode.cmakeProject.workspaceFolder, BaseNode.cmakeProject.allTargetName]
        };
        this.tooltip = 'Test';
        this.collapsibleState = TreeItemCollapsibleState.Expanded;
        this.contextValue = 'test';
        await this.InitializeChildren();
    }

    async InitializeChildren(): Promise<void> {
        if (!BaseNode.cmakeProject) {
            return;
        }
        if (!BaseNode.cmakeProject.useCMakePresets) {
            this.target = new TargetNode(TargetType.Test);
            await this.target.initialize();
        } else {
            this.preset = new PresetNode(PresetType.Test);
            await this.preset.initialize();
        }
    }

    getChildren(): BaseNode[] {
        if (!BaseNode.cmakeProject) {
            return [];
        }
        if (!BaseNode.cmakeProject.useCMakePresets) {
            return [this.target!];
        } else {
            return [this.preset!];
        }
    }

}

// The Debug, Launch, and Project Node only have one child.
export class SingleItemNode extends BaseNode {

    private target?: TargetNode;

    constructor(private targetType: TargetType) {
        super(targetType);
    }

    async initialize(): Promise<void> {
        if (!BaseNode.cmakeProject) {
            return;
        }
        switch (this.targetType) {
            case TargetType.Debug:
                this.command = {
                    title: localize('Debug', 'Debug'),
                    command: 'cmake.sideBar.debugTarget',
                    arguments: [BaseNode.cmakeProject.workspaceFolder, BaseNode.cmakeProject.launchTargetName || await BaseNode.cmakeProject.allTargetName]
                };
                this.tooltip = 'Debug';
                this.collapsibleState = TreeItemCollapsibleState.Expanded;
                this.contextValue = 'debug';
                break;
            case TargetType.Launch:
                this.command = {
                    title: localize('Launch', 'Launch'),
                    command: 'cmake.sideBar.launchTarget',
                    arguments: [BaseNode.cmakeProject.workspaceFolder, BaseNode.cmakeProject.launchTargetName || await BaseNode.cmakeProject.allTargetName]
                };
                this.tooltip = 'Launch';
                this.collapsibleState = TreeItemCollapsibleState.Expanded;
                this.contextValue = 'launch';
                break;
            case TargetType.Project:
                this.tooltip = 'Active project';
                this.collapsibleState = TreeItemCollapsibleState.Expanded;
                this.contextValue = 'activeProject';
                break;
        }

        await this.InitializeChildren();
    }

    async InitializeChildren(): Promise<void> {
        if (!BaseNode.cmakeProject) {
            return;
        }
        switch (this.targetType) {
            case TargetType.Debug:
                this.target = new TargetNode(TargetType.Debug);
                break;
            case TargetType.Launch:
                this.target = new TargetNode(TargetType.Launch);
                break;
            case TargetType.Project:
                this.target = new TargetNode(TargetType.Project);
                break;
            default:
                throw Error('Not a valid type');
        }
        await this.target!.initialize();
    }

    getChildren(): BaseNode[] {
        if (!BaseNode.cmakeProject) {
            return [];
        }
        return [this.target!];
    }

}

export class PresetNode extends BaseNode {

    constructor(private presetType: PresetType) {
        super(NodeType.Kit);
    }

    async initialize(): Promise<void> {
        if (!BaseNode.cmakeProject || !BaseNode.cmakeProject.useCMakePresets) {
            return;
        }
        switch (this.presetType) {
            case PresetType.Configure:
                this.label = BaseNode.cmakeProject.configurePreset?.name;
                this.command = {
                    title: localize('change.preset', 'Change Preset'),
                    command: 'cmake.sideBar.selectConfigurePreset',
                    arguments: [this]
                };
                this.tooltip = 'Change Configure Preset';
                this.contextValue = 'configPreset';
                break;
            case PresetType.Build:
                this.label = BaseNode.cmakeProject.buildPreset?.name;
                this.command = {
                    title: localize('change.preset', 'Change Preset'),
                    command: 'cmake.sideBar.selectBuildPreset',
                    arguments: [this]
                };
                this.tooltip = 'Change Build Preset';
                this.contextValue = 'buildPreset';
                break;
            case PresetType.Test:
                this.label = BaseNode.cmakeProject.testPreset?.name;
                this.command = {
                    title: localize('change.preset', 'Change Preset'),
                    command: 'cmake.sideBar.selectTestPreset',
                    arguments: [this]
                };
                this.tooltip = 'Change Test Preset';
                this.contextValue = 'testPreset';
                break;
        }
        this.collapsibleState = TreeItemCollapsibleState.None;
    }

    async refresh() {
        if (!BaseNode.cmakeProject) {
            return;
        }
        switch (this.presetType) {
            case PresetType.Configure:
                this.label = BaseNode.cmakeProject.configurePreset?.name;
                break;
            case PresetType.Build:
                this.label = BaseNode.cmakeProject.buildPreset?.name;
                break;
            case PresetType.Test:
                this.label = BaseNode.cmakeProject.testPreset?.name;
                break;
        }
    }
}

export class KitNode extends BaseNode {

    constructor() {
        super(NodeType.Kit);
    }

    async initialize(): Promise<void> {
        if (!BaseNode.cmakeProject) {
            return;
        }
        this.label = BaseNode.cmakeProject.activeKit?.name || "";
        this.command = {
            title: localize('change.kit', 'Change Kit'),
            command: 'cmake.sideBar.selectKit',
            arguments: []
        };
        this.tooltip = "Change Kit";
        this.collapsibleState = TreeItemCollapsibleState.None;
        this.contextValue = 'kit';
    }

    getTreeItem(): TreeItem {
        if (!BaseNode.cmakeProject) {
            return this;
        }
        this.label = BaseNode.cmakeProject.activeKit?.name || "";
        return this;
    }
}
export class TargetNode extends BaseNode {

    constructor(private targetType: TargetType) {
        super(NodeType.Target);
    }

    async initialize(): Promise<void> {
        if (!BaseNode.cmakeProject) {
            return;
        }
        switch (this.targetType) {
            case TargetType.Build:
                this.label = await BaseNode.cmakeProject.buildTargetName() || await BaseNode.cmakeProject.allTargetName;
                this.command = {
                    title: localize('set.build.target', 'Set Build Target'),
                    command: 'cmake.sideBar.setDefaultTarget',
                    arguments: [this, BaseNode.cmakeProject.workspaceFolder, BaseNode.cmakeProject.buildTargetName()]
                };
                this.tooltip = "Set Build Target";
                this.collapsibleState = TreeItemCollapsibleState.None;
                this.contextValue = 'buildTarget';
                break;
            case TargetType.Test:
                this.label = "All tests";
                this.command = {
                    title: localize('set.test.target', 'Set Test Target'),
                    command: 'cmake.sideBar.setTestTarget',
                    arguments: [this, BaseNode.cmakeProject.workspaceFolder, "All tests"]
                };
                this.tooltip = "Set Test Target";
                this.collapsibleState = TreeItemCollapsibleState.None;
                this.contextValue = 'testTarget';
                break;
            case TargetType.Debug:
                this.label = BaseNode.cmakeProject.launchTargetName || await BaseNode.cmakeProject.allTargetName;
                this.command = {
                    title: localize('set.debug.target', 'Set debug target'),
                    command: 'cmake.sideBar.setDebugTarget',
                    arguments: [this, BaseNode.cmakeProject.workspaceFolder, BaseNode.cmakeProject.launchTargetName]
                };
                this.tooltip = "Set debug target";
                this.collapsibleState = TreeItemCollapsibleState.None;
                this.contextValue = 'debugTarget';
                break;
            case TargetType.Launch:
                this.label = BaseNode.cmakeProject.launchTargetName || await BaseNode.cmakeProject.allTargetName;
                this.command = {
                    title: localize('set.launch.target', 'Set Launch Target'),
                    command: 'cmake.sideBar.setLaunchTarget',
                    arguments: [this, BaseNode.cmakeProject.workspaceFolder, BaseNode.cmakeProject.launchTargetName]
                };
                this.tooltip = "Set launch target";
                this.collapsibleState = TreeItemCollapsibleState.None;
                this.contextValue = 'launchTarget';
                break;
            case TargetType.Project:
                this.label = BaseNode.cmakeProject.folderName;
                this.command = {
                    title: localize('set.active.project', 'Set active project'),
                    command: "",
                    arguments: []
                };
                this.tooltip = "Set active project";
                this.collapsibleState = TreeItemCollapsibleState.None;
                this.contextValue = 'activeProject';
                break;
        }
    }

    async refresh() {
        if (!BaseNode.cmakeProject) {
            return;
        }
        switch (this.targetType) {
            case TargetType.Build:
                this.label = await BaseNode.cmakeProject.buildTargetName() || await BaseNode.cmakeProject.allTargetName;
                break;
            case TargetType.Test:
                this.label = "All tests";
                break;
            case TargetType.Debug:
                this.label = BaseNode.cmakeProject.launchTargetName || await BaseNode.cmakeProject.allTargetName;
                break;
            case TargetType.Launch:
                this.label = BaseNode.cmakeProject.launchTargetName || await BaseNode.cmakeProject.allTargetName;
                break;
        }
    }
}

export class VariantNode extends BaseNode {

    constructor() {
        super(NodeType.Variant);
    }

    async initialize(): Promise<void> {
        if (!BaseNode.cmakeProject) {
            return;
        }
        this.label = BaseNode.cmakeProject.activeVariantName || "Debug";
        this.command = {
            title: localize('set.variant', 'Set variant'),
            command: 'cmake.setVariant',
            arguments: [this, BaseNode.cmakeProject.workspaceFolder, BaseNode.cmakeProject.activeVariantName]
        };
        this.tooltip = "Set variant";
        this.collapsibleState = TreeItemCollapsibleState.None;
        this.contextValue = 'variant';
    }

    async refresh(): Promise<void> {
        if (!BaseNode.cmakeProject) {
            return;
        }
        this.label = BaseNode.cmakeProject.activeVariantName || "Debug";
    }

}

enum NodeType {
    Configure = "Configure",
    Build = "Build",
    Test = "Test",
    Debug = "Debug",
    Launch = "Lauch",
    Project = "Project",
    Preset = "Preset",
    Kit = "Kit",
    Target = "Target",
    Variant = "Variant"
}

enum PresetType {
    Configure = "Configure",
    Build = "Build",
    Test = "Test",
}

enum TargetType {
    Build = "Build",
    Test = "Test",
    Debug = "Debug",
    Launch = "Launch",
    Project = "Project"
}
