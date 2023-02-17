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

    updateActiveProject(cmakeProject?: CMakeProject): void {
        // Update Active Project
        this.sideBarTreeDataProvider.updateActiveProject(cmakeProject);
    }

    refresh() {
        this.sideBarTreeDataProvider.refresh();
    }

    clear(){
        this.sideBarTreeDataProvider.clear();
    }

    dispose(){
        this.sideBarTreeDataProvider.dispose();
    }

}

export class SideBarTreeDataProvider implements TreeDataProvider<BaseNode>, Disposable{

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
            commands.registerCommand('cmake.sideBar.selectKit', async (node: BaseNode) => {
                await runCommand('selectKit');
                await node.refresh();
                this.refresh();
            }),
            commands.registerCommand('cmake.sideBar.selectConfigurePreset', async (node: BaseNode, folder: WorkspaceFolder) => {
                await runCommand('selectConfigurePreset', folder);
                await node.refresh();
                this.refresh(node);
            }),
            commands.registerCommand('cmake.sideBar.build', async (folder: WorkspaceFolder, target: Promise<string>) => runCommand('build', folder, await target)),
            commands.registerCommand('cmake.sideBar.setDefaultTarget', async (node: BaseNode, folder: WorkspaceFolder, target: Promise<string>) => {
                await runCommand('setDefaultTarget', folder, await target);
                await node.refresh();
                this.refresh(node);
            }),
            commands.registerCommand('cmake.sideBar.selectBuildPreset', async (node: BaseNode, folder: WorkspaceFolder) => {
                await runCommand('selectBuildPreset', folder);
                await node.refresh();
                this.refresh(node);
            })
        ]);
    }

    updateActiveProject(cmakeProject?: CMakeProject): void {
        // Use project to create the tree
        if (cmakeProject) {
            BaseNode.updateActiveProject(cmakeProject);
            this.refresh();
        }
    }

    public refresh(node?: BaseNode): any {
        this._onDidChangeTreeData.fire(node != null ? node : undefined);
    }

    clear(): void {
        BaseNode.updateActiveProject(undefined);
        this.refresh();
    }

    dispose(): void {
        Disposable.from(...this.disposables).dispose();
    }

    getTreeItem(node: BaseNode): TreeItem {
        return node.getTreeItem();
    }

    async getChildren(node?: BaseNode | undefined): Promise<BaseNode[]> {
        // When initializing the tree
        if (!node) {
            const configNode = new ConfigNode();
            await configNode.initialize();
            const buildNode = new BuildNode();
            await buildNode.initialize();
            return [configNode, buildNode];
        } else {
            return node.getChildren();
        }
    }

}

export class BaseNode extends TreeItem{

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

    async refresh() {
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
            command: 'cmake.configure',
            arguments: []
        };
        this.tooltip = "";
        this.collapsibleState = TreeItemCollapsibleState.Expanded;
        await this.InitializeChildren(false);
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
            arguments: [BaseNode.cmakeProject.workspaceFolder, BaseNode.cmakeProject.buildTargetName()]
        };
        this.tooltip = "";
        this.collapsibleState = TreeItemCollapsibleState.Expanded;
        this.contextValue = 'build';
        await this.InitializeChildren();
    }

    async InitializeChildren(): Promise<void> {
        if (!BaseNode.cmakeProject) {
            return;
        }
        if (!BaseNode.cmakeProject.useCMakePresets) {
            this.target = new TargetNode();
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

}

export class PresetNode extends BaseNode {

    presetType: PresetType;

    constructor(presetType: PresetType) {
        super(NodeType.Kit);
        this.presetType = presetType;
    }

    async initialize(): Promise<void> {
        if (!BaseNode.cmakeProject || !BaseNode.cmakeProject.useCMakePresets) {
            return;
        }
        switch (this.presetType) {
            case PresetType.Configure: 
                this.label = BaseNode.cmakeProject.buildPreset?.name;
                this.command = {
                    title: localize('Change Preset', 'Change Preset'),
                    command: 'cmake.sideBar.selectConfigurePreset',
                    arguments: [this]
                };
                this.contextValue = 'configPreset';
                break;
            case PresetType.Build: 
                this.label = BaseNode.cmakeProject.buildPreset?.name;
                this.command = {
                    title: localize('Change Preset', 'Change Preset'),
                    command: 'cmake.sideBar.selectBuildPreset',
                    arguments: [this]
                };
                this.contextValue = 'buildPreset';
                break;
        }
        this.tooltip = "";
        this.collapsibleState = TreeItemCollapsibleState.None;
    }

    async refresh() {
        if (!BaseNode.cmakeProject) {
            return;
        }
        switch (this.presetType) {
            case PresetType.Build: 
            this.label = BaseNode.cmakeProject.buildPreset?.name;
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
            title: localize('Change Kit', 'Change Kit'),
            command: 'cmake.sideBar.selectKit',
            arguments: []
        };
        this.tooltip = "";
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

    constructor() {
        super(NodeType.Target);
    }

    async initialize(): Promise<void> {
        if (!BaseNode.cmakeProject) {
            return;
        }
        this.label = await BaseNode.cmakeProject.buildTargetName() || await BaseNode.cmakeProject.allTargetName;
        this.command = {
            title: localize('set.build.target', 'Set Build Target'),
            command: 'cmake.sideBar.setDefaultTarget',
            arguments: [this, BaseNode.cmakeProject.workspaceFolder, BaseNode.cmakeProject.buildTargetName()]
        };
        this.tooltip = "";
        this.collapsibleState = TreeItemCollapsibleState.None;
        this.contextValue = 'defaultTarget';
    }

    async refresh() {
        if (!BaseNode.cmakeProject) {
            return;
        }
        this.label = await BaseNode.cmakeProject.buildTargetName() || await BaseNode.cmakeProject.allTargetName;
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
        this.label = await BaseNode.cmakeProject.currentBuildType() || "Debug";
        this.command = {
            title: localize('Change Build Type', 'Change Build Type'),
            command: 'cmake.buildType',
            arguments: []
        };
        this.tooltip = "";
        this.collapsibleState = TreeItemCollapsibleState.None;
    }
}

enum NodeType {
    Configure = "Configure",
    Build = "Build",
    Test = "Test",
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
