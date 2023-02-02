
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import CMakeProject from './cmakeProject';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
//const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export class SideBarConfigProvider implements vscode.TreeDataProvider<SettingNode>{

    private configSetting: SettingNode;
    private buildSetting: SettingNode;
    private testSetting: SettingNode;
    private project: SettingNode;

    onDidChangeTreeData?: vscode.Event<void | SettingNode | null | undefined> | undefined;
    getTreeItem(_element: SettingNode): vscode.TreeItem | Thenable<vscode.TreeItem> {
        throw new Error('Method not implemented.');
    }
    getChildren(_element?: SettingNode | undefined): vscode.ProviderResult<SettingNode[]> {
        throw new Error('Method not implemented.');
    }
    getParent?(_element: SettingNode): vscode.ProviderResult<SettingNode> {
        throw new Error('Method not implemented.');
    }
    resolveTreeItem?(_item: vscode.TreeItem, _element: SettingNode, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.TreeItem> {
        throw new Error('Method not implemented.');
    }

    constructor(cmakeProject: CMakeProject){
        this.project = new SettingNode(cmakeProject.folderName, vscode.TreeItemCollapsibleState.Expanded);
    }
}

export class PresetConfigProvider extends SideBarConfigProvider{
}

export class KitConfigProvider extends SideBarConfigProvider{
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

}


export class CMakeCommand implements vscode.Command {

    constructor(public title: string, public command: string, public aruments?: string[]) {}
}
