import path = require('path');
import {
    commands,
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
import { runCommand, thisExtension } from './util';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export class SideBar {
    private sideBarTreeView: TreeView<Node>;
    private sideBarTreeDataProvider: SideBarTreeDataProvider;
    constructor() {
        this.sideBarTreeDataProvider = new SideBarTreeDataProvider();
        this.sideBarTreeView = window.createTreeView('cmake.sideBar', { treeDataProvider: this.sideBarTreeDataProvider });
        commands.registerCommand('cmake.sideBar.selectKit', () => {}),
        commands.registerCommand('cmake.sideBar.build', (node: Node) => { this.build(node); })
    }

    updateActiveProject(cmakeProject?: CMakeProject): void {
        // Update Active Project
        this.sideBarTreeDataProvider.updateActiveProject(cmakeProject);
    }

    selectKit(node: Node) {
        runCommand('selectKit', node.getWorkspaceFolder(), node.getBuildTargetName());
        this.sideBarTreeDataProvider.refresh();
    }

    build(node: Node) {
        if (!node) {
            return;
        }
        runCommand('build', node.getWorkspaceFolder(), node.getBuildTargetName());
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
            this.refresh();
        }
    }

    public refresh(): any {
        // Sig
        this._onDidChangeTreeData.fire(undefined);
    }

    clear(): void {
        Node.updateActiveProject(undefined);
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: Node): TreeItem {
        return element.getTreeItem();
    }

    getChildren(element?: Node | undefined): Node[] {
        // When initializing the tree
        if (!element) {
            return [new ConfigNode(), new BuildNode()];
        } else {
            return element.getChildren();
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

    getWorkspaceFolder(): WorkspaceFolder | undefined {
        return Node.cmakeProject?.workspaceFolder;
    }

    async getBuildTargetName(): Promise<string | undefined>{
        return await Node.cmakeProject?.buildTargetName() || Node.cmakeProject?.allTargetName || undefined;
    }

    async initialize(nodeType: NodeType): Promise<void> {
        let icon: string;
        if (!Node.cmakeProject) {
            return;
        }
        switch (nodeType) {
            case NodeType.Kit:
                this.label = Node.cmakeProject.activeKit?.name || "";
                icon = 'binary-icon.svg';
                this.iconPath = {
                    light: path.join(thisExtension().extensionPath, "res/light", icon),
                    dark: path.join(thisExtension().extensionPath, "res/dark", icon)
                };
                this.command = {
                    title: localize('Change Kit', 'Change Kit'),
                    command: 'cmake.sideBar.selectKit',
                    arguments: []
                };
                this.tooltip = "";
                this.collapsibleState = TreeItemCollapsibleState.None;
                break;
            case NodeType.Variant:
                this.label = await Node.cmakeProject.currentBuildType() || "Debug";
                icon = 'binary-icon.svg';
                this.iconPath = {
                    light: path.join(thisExtension().extensionPath, "res/light", icon),
                    dark: path.join(thisExtension().extensionPath, "res/dark", icon)
                };
                this.command = {
                    title: localize('Change Build Type', 'Change Build Type'),
                    command: 'cmake.buildType',
                    arguments: []
                };
                this.tooltip = "";
                this.collapsibleState = TreeItemCollapsibleState.None;
                break;
            case NodeType.Target:
                this.label = await Node.cmakeProject.buildTargetName() || await Node.cmakeProject.allTargetName;
                icon = 'binary-icon.svg';
                this.iconPath = {
                    light: path.join(thisExtension().extensionPath, "res/light", icon),
                    dark: path.join(thisExtension().extensionPath, "res/dark", icon)
                };
                this.command = {
                    title: localize('Change Target', 'Change Target'),
                    command: 'cmake.buildTargetName',
                    arguments: []
                };
                this.tooltip = "";
                this.collapsibleState = TreeItemCollapsibleState.None;
        }
    }
}

export class ConfigNode extends Node {

    private useCMakePresets?: boolean;
    private kit?: Node;
    private variant?: Node;
    private preset?: Node;
    
    constructor() {
        super(NodeType.Configure);
        this.label = NodeType.Configure;
        const icon = 'binary-icon.svg';
        this.iconPath = {
            light: path.join(thisExtension().extensionPath, "res/light", icon),
            dark: path.join(thisExtension().extensionPath, "res/dark", icon)
        };
        this.command = {
            title: localize('Configure', 'Configure'),
            command: 'cmake.configure',
            arguments: []
        };
        this.tooltip = "";
        this.collapsibleState = TreeItemCollapsibleState.Expanded;
        this.InitializeChildren(false);
    }

    InitializeChildren(useCMakePresets: boolean) {
        this.useCMakePresets = useCMakePresets;
        if (!this.useCMakePresets) {
            this.kit = new Node(NodeType.Kit);
            this.kit.initialize(NodeType.Kit);
            this.variant = new Node("Debug");
            this.variant.initialize(NodeType.Variant);
        } else {
            this.preset = new Node(NodeType.Preset);
            this.preset.initialize(NodeType.Preset);     
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
    private target?: Node;
    private preset?: Node;
    
    constructor() {
        super(NodeType.Build);
        const icon = 'binary-icon.svg';
        this.iconPath = {
            light: path.join(thisExtension().extensionPath, "res/light", icon),
            dark: path.join(thisExtension().extensionPath, "res/dark", icon)
        };
        this.command = {
            title: localize('Build', 'Build'),
            command: 'cmake.sideBar.build',
            arguments: [this]
        };
        this.tooltip = "";
        this.collapsibleState = TreeItemCollapsibleState.Expanded;
        this.initialize(NodeType.Build);
        this.InitializeChildren(false);
    }

    InitializeChildren(_useCMakePresets: boolean) {
        this.useCMakePresets = false;
        if (!this.useCMakePresets) {
            this.target = new Node(NodeType.Target);
            this.target.initialize(NodeType.Target);
        } else {
            this.preset = new Node(NodeType.Preset);
            this.preset.initialize(NodeType.Preset);     
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

enum NodeType {
    Configure = "Configure",
    Build = "Build",
    Test = "Test",
    Preset = "Preset",
    Kit = "Kit",
    Variant = "Variant",
    Target = "Target"
}
