import path = require('path');
import {
    Event,
    EventEmitter,
    TreeDataProvider,
    TreeItem,
    TreeItemCollapsibleState,
    TreeView,
    window
} from 'vscode';
import * as nls from 'vscode-nls';
import CMakeProject from './cmakeProject';
import { thisExtension } from './util';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export class SideBar {
    private sideBarTreeView: TreeView<Node>;
    private sideBarTreeDataProvider: SideBarTreeDataProvider;
    constructor() {
        this.sideBarTreeDataProvider = new SideBarTreeDataProvider();
        this.sideBarTreeView = window.createTreeView('cmake.sideBar', { treeDataProvider: this.sideBarTreeDataProvider });
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

    dispose(): void {
        this.sideBarTreeView.dispose;
    }
}

export class SideBarTreeDataProvider implements TreeDataProvider<Node>{

    private _onDidChangeTreeData: EventEmitter<any> = new EventEmitter<any>();
    readonly onDidChangeTreeData: Event<any> = this._onDidChangeTreeData.event;

    constructor() {
    }

    updateActiveProject(cmakeProject?: CMakeProject): void {
        // Use project to create the tree
        if (cmakeProject) {
            Node.updateActiveProject(cmakeProject);
            //this.refresh();
        }
    }

    public refresh(): any {
        this._onDidChangeTreeData.fire(undefined);
    }

    clear(): void {
        Node.updateActiveProject(undefined);
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(node: Node): TreeItem {
        return node.getTreeItem();
    }

    async getChildren(node?: Node | undefined): Promise<Node[]> {
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

export class Node extends TreeItem{

    static cmakeProject?: CMakeProject;
    static updateActiveProject(cmakeProject?: CMakeProject): void {
        // Use project to create the tree
        if (cmakeProject) {
            Node.cmakeProject = cmakeProject;
        }
    }

    getTreeItem(): TreeItem {
        return this;
    }

    getChildren(): Node[] {
        return [];
    }

    async initialize(): Promise<void> {
    }
}

export class ConfigNode extends Node {

    private useCMakePresets?: boolean;
    private kit?: KitNode;
    private variant?: VariantNode;
    private preset?: Node;
    
    constructor() {
        super(NodeType.Configure);
    }

    async initialize(): Promise<void> {
        if (!Node.cmakeProject) {
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

    async InitializeChildren(useCMakePresets: boolean): Promise<void> {
        this.useCMakePresets = useCMakePresets;
        if (!this.useCMakePresets) {
            this.kit = new KitNode();
            await this.kit.initialize();
            this.variant = new VariantNode();
            await this.variant.initialize();
        } else {
            this.preset = new PresetNode();
            await this.preset.initialize();     
        }
    }

    getChildren(): Node[] {
        if (this.useCMakePresets) {
            return [this.preset!];
        } else {
            return [this.kit!, this.variant!];
        }
    }

}

export class BuildNode extends Node {

    private useCMakePresets?: boolean;
    private target?: TargetNode;
    private preset?: PresetNode;

    constructor() {
        super(NodeType.Build);
    }

    async initialize(): Promise<void> {
        if (!Node.cmakeProject) {
            return;
        }
        this.command = {
            title: localize('Build', 'Build'),
            command: 'cmake.sideBar.build',
            arguments: [Node.cmakeProject.workspaceFolder, Node.cmakeProject.buildTargetName()]
        };
        this.tooltip = "";
        this.collapsibleState = TreeItemCollapsibleState.Expanded;
        this.contextValue = 'build';
        await this.InitializeChildren(false);
    }

    async InitializeChildren(_useCMakePresets: boolean): Promise<void> {
        this.useCMakePresets = false;
        if (!this.useCMakePresets) {
            this.target = new TargetNode();
            await this.target.initialize();
        } else {
            this.preset = new PresetNode();
            await this.preset.initialize();     
        }
    }

    getChildren(): Node[] {
        if (this.useCMakePresets) {
            return [this.preset!];
        } else {
            return [this.target!];
        }
    }

}

export class PresetNode extends Node {

    constructor() {
        super(NodeType.Preset);
    }

    async initialize(): Promise<void> {
        if (!Node.cmakeProject) {
            return;
        }
        this.label = Node.cmakeProject.activeKit?.name || "";
        this.command = {
            title: localize('Change Kit', 'Change Kit'),
            command: 'cmake.sideBar.selectKit',
            arguments: []
        };
        this.tooltip = "";
        this.collapsibleState = TreeItemCollapsibleState.None;
        this.contextValue = 'editable';
    }
}

export class KitNode extends Node {

    constructor() {
        super(NodeType.Kit);
    }

    async initialize(): Promise<void> {
        if (!Node.cmakeProject) {
            return;
        }
        this.label = Node.cmakeProject.activeKit?.name || "";
        this.command = {
            title: localize('Change Kit', 'Change Kit'),
            command: 'cmake.sideBar.selectKit',
            arguments: []
        };
        this.tooltip = "";
        this.collapsibleState = TreeItemCollapsibleState.None;
        this.contextValue = 'editable';
    }
}
export class TargetNode extends Node {

    constructor() {
        super(NodeType.Target);
    }

    async initialize(): Promise<void> {
        if (!Node.cmakeProject) {
            return;
        }
        this.label = await Node.cmakeProject.buildTargetName() || await Node.cmakeProject.allTargetName;
        this.command = {
            title: localize('set.build.target', 'Set Build Target'),
            command: 'cmake.sideBar.setDefaultTarget',
            arguments: [Node.cmakeProject.workspaceFolder, Node.cmakeProject.buildTargetName()]
        };
        this.tooltip = "";
        this.collapsibleState = TreeItemCollapsibleState.None;
        this.contextValue = 'defaultTarget';
    }
}

export class VariantNode extends Node {

    constructor() {
        super(NodeType.Variant);
    }

    async initialize(): Promise<void> {
        if (!Node.cmakeProject) {
            return;
        }
        this.label = await Node.cmakeProject.currentBuildType() || "Debug";
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
