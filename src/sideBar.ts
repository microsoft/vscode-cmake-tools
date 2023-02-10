
import path = require('path');
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import CMakeProject from './cmakeProject';
import { thisExtension } from './util';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export class SideBar {
    private sideBar: vscode.TreeView<NodeEntry>;
    constructor() {
        const sideBarTreeProvider = new SideBarTreeProvider();
        this.sideBar = vscode.window.createTreeView('CMakeProjectExplorer', { treeDataProvider: sideBarTreeProvider });
        vscode.commands.registerCommand('CMakeProjectExplorer.changeProject', () => this.changeProject());
        vscode.commands.registerCommand('CMakeProjectExplorer.refresh', () => sideBarTreeProvider.refresh());
        // register all commands
        
    }
    changeProject(): void {
        // Change Active Project
    }
    dispose(): void {
        this.sideBar.dispose;
    }
}

export class SideBarTreeProvider implements vscode.TreeDataProvider<NodeEntry>{

    /*private configSetting: SettingNode;
    private buildSetting: SettingNode;
    private testSetting: SettingNode;
    private project: SettingNode;*/

    private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
	readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

    constructor(){
    }
    setProject (_project: CMakeProject): void {
        // Use project to create the tree
    }
    public refresh(): any {
		this._onDidChangeTreeData.fire(undefined);
	}
    getTreeItem(element: subNodeEntry): vscode.TreeItem {
        if (element.nodeType === NodeType.Configure || element.nodeType === NodeType.Build || element.nodeType === NodeType.Test) {
            return {
                label: element.nodeType,
                tooltip: "",
                collapsibleState: vscode.TreeItemCollapsibleState.Expanded
            };
        } else {
            if (element.kit) {
                const lable = element.kit;
                const item = new vscode.TreeItem(lable);
                //item.command = ;
                const icon = 'binary-icon.svg';
                item.iconPath = {
                    light: path.join(thisExtension().extensionPath, "res/light", icon),
                    dark: path.join(thisExtension().extensionPath, "res/dark", icon)
                };
                item.command = {
                    title: localize('Change Kit', 'Change Kit'),
                    command: 'cmake.selectKit',
                    arguments: []
                };
                item.tooltip = "";
                item.collapsibleState= vscode.TreeItemCollapsibleState.None;
                return item;
            } else if (element.variant) {
                const lable = element.variant;
                const item = new vscode.TreeItem(lable);
                //item.command = ;
                const icon = 'binary-icon.svg';
                item.iconPath = {
                    light: path.join(thisExtension().extensionPath, "res/light", icon),
                    dark: path.join(thisExtension().extensionPath, "res/dark", icon)
                };
                item.command = {
                    title: localize('Change Build Type', 'Change Build Type'),
                    command: 'cmake.buildType',
                    arguments: []
                };
                item.tooltip = "";
                item.collapsibleState= vscode.TreeItemCollapsibleState.None;
                return item;
            }
            return {};
        }
    }
    getChildren(element?: subNodeEntry | undefined): vscode.ProviderResult<subNodeEntry[]> {
        // When initializing the tree
        if (!element) {
            return [
                {
                    useCMakePresets: true,
                    nodeType: NodeType.Configure
                },
                {
                    useCMakePresets: true,
                    nodeType: NodeType.Build
                },
                {
                    useCMakePresets: true,
                    nodeType: NodeType.Test
                }
        ];
        } else {
            if (element.nodeType === NodeType.Configure) {
                return [
                    {
                        useCMakePresets: element.useCMakePresets,
                        nodeType: NodeType.subNode,
                        kit: "kit1",
                    },
                    {
                    useCMakePresets: element.useCMakePresets,
                    nodeType: NodeType.subNode,
                    variant: "Debug"
                    }
                ];
            }
        }
    }
    getParent?(_element: NodeEntry): vscode.ProviderResult<NodeEntry> {
        throw new Error('Method not implemented.');
    }
    resolveTreeItem?(_item: vscode.TreeItem, _element: NodeEntry, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.TreeItem> {
        throw new Error('Method not implemented.');
    }
}

interface NodeEntry {
    useCMakePresets: boolean;
    nodeType: NodeType;
}

interface subNodeEntry extends NodeEntry {
    kit?: string;
    preset?: string;
    target?: string;
    variant?: string;
}

enum NodeType {
    Configure = "Configure",
    Build = "Build",
    Test = "Test",
    subNode = "subNode"
}

/*export class PresetConfigProvider extends SideBarTreeProvider{
}

export class KitConfigProvider extends SideBarTreeProvider{
}

export class SettingNode extends vscode.TreeItem {

    constructor(
        public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: CMakeCommand
    ){
        super(label, collapsibleState);
        this.tooltip = `${this.label}`;
    }

}

export class PresetNode extends SettingNode {

}

export class KitNode extends SettingNode {

}*/


export class CMakeCommand implements vscode.Command {

    constructor(public title: string, public command: string, public aruments?: string[]) {}
}

export class FileSystemProvider implements vscode.TreeDataProvider<NodeEntry> {
    onDidChangeTreeData?: vscode.Event<any> | undefined;
    getTreeItem(_element: NodeEntry): vscode.TreeItem | Thenable<vscode.TreeItem> {
        throw new Error('Method not implemented.');
    }
    getChildren(_element?: any): vscode.ProviderResult<NodeEntry[]> {
        throw new Error('Method not implemented.');
    }
    getParent?(_element: NodeEntry): vscode.ProviderResult<NodeEntry> {
        throw new Error('Method not implemented.');
    }
    resolveTreeItem?(_item: vscode.TreeItem, _element: NodeEntry, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.TreeItem> {
        throw new Error('Method not implemented.');
    }
}
