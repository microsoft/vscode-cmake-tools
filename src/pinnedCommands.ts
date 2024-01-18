import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { GetExtensionActiveCommands, GetExtensionActiveCommandsEmitter, GetExtensionLocalizedStrings } from './extension';
import * as logging from './logging';
import { ConfigurationReader } from '@cmt/config';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
const log = logging.createLogger('pinnedCommands');

interface PinnedCommandsQuickPickItem extends vscode.QuickPickItem {
    command: string;
}

class PinnedCommandNode extends vscode.TreeItem {
    public commandName : string;
    public isVisible : boolean;
    constructor(label:string, command:string, isVisible: boolean ) {
        super(label);
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        this.tooltip = label;
        this.commandName = command;
        this.isVisible = isVisible;
    }

    getTreeItem(): vscode.TreeItem {
        return this;
    }

    runThisCommand(){
        vscode.commands.executeCommand(this.commandName);
    }
}

export class PinnedCommands {

    private treeDataProvider: PinnedCommandsTreeDataProvider;
    protected disposables: vscode.Disposable[] = [];
    
    constructor(configReader : ConfigurationReader) {
        this.treeDataProvider = new PinnedCommandsTreeDataProvider(configReader);
        this.disposables.push(...[
            // Commands for projectStatus items
            vscode.commands.registerCommand('cmake.pinnedCommands.add', async () => {
                let chosen = await this.showPinnableCommands();
                if (chosen != null) {
                   this.treeDataProvider.addCommand(chosen);
                }
            }),
            vscode.commands.registerCommand('cmake.pinnedCommands.remove', async (what: PinnedCommandNode) => {
                this.treeDataProvider.removeCommand(what);
            }),
            vscode.commands.registerCommand('cmake.pinnedCommands.run', async (what: PinnedCommandNode) => {
                this.treeDataProvider.runCommand(what);
            }),
        ]);
    }

     /**
     * Show List of All Commands that can be pinned
     */
     async showPinnableCommands() : Promise<PinnedCommandsQuickPickItem | null> {
        var localization = GetExtensionLocalizedStrings();
        let items = GetExtensionActiveCommands().map((x) => {return {
        command: x,
        label: localization[`cmake-tools.command.${x}.title`]} as PinnedCommandsQuickPickItem});
        const chosenItem = await vscode.window.showQuickPick(items,
            { placeHolder: localize('add.pinned.cmake.command', 'Select a CMake command to pin') });
        if (!chosenItem) {
            log.debug(localize('user.cancelled.add.pinned.cmake.command', 'User cancelled selecting CMake Command to Pin'));
            return null;
        }
        return chosenItem;
    }
    
    refresh(): Promise<any> {
        return this.treeDataProvider.refresh();
    }

    dispose() {
        vscode.Disposable.from(...this.disposables).dispose();
        this.treeDataProvider.dispose();
    }
}

class PinnedCommandsTreeDataProvider implements vscode.TreeDataProvider<PinnedCommandNode>, vscode.Disposable {
    private treeView: vscode.TreeView<PinnedCommandNode>;
    private _onDidChangeTreeData: vscode.EventEmitter<PinnedCommandNode | void> = new vscode.EventEmitter<PinnedCommandNode | void>();
    private pinnedCommands : PinnedCommandNode[] = [];
    private config: vscode.WorkspaceConfiguration | null;
    private pinnedCommandsKey : string = "cmake.pinnedCommandsList";
    private isInitialized = false;
    private readonly _settingsSub ;

    constructor(configReader : ConfigurationReader) {
        this.treeView = vscode.window.createTreeView('cmake.pinnedCommands', { treeDataProvider: this });
        this._settingsSub = configReader.onChange('pinnedCommandsList', () => this.doConfigureSettingsChange());
        this.config = vscode.workspace.getConfiguration();
        GetExtensionActiveCommandsEmitter()?.event(this.doConfigureSettingsChange, this);
    }

    get onDidChangeTreeData(): vscode.Event<PinnedCommandNode | void | undefined> {
        return this._onDidChangeTreeData.event;
    }
    
    async initialize(): Promise<void> {
        this.config = vscode.workspace.getConfiguration();
        this.pinnedCommands = []; //reset to empty list.
        if (this.config.has(this.pinnedCommandsKey)) {
            const localization = GetExtensionLocalizedStrings();
            const settingsPinnedCommands = this.config.get(this.pinnedCommandsKey) as string[];
            const activeCommands = new Set<string>(GetExtensionActiveCommands());
            for (const commandName of settingsPinnedCommands) {
                // only show commands that are contained in the active commands for the extension.
                this.pinnedCommands.push(new PinnedCommandNode(localization[`cmake-tools.command.${commandName}.title`], commandName, activeCommands.has(commandName)));
            }
        }
        this.isInitialized = true
    }

    async doConfigureSettingsChange() {
        await this.initialize();
        this.refresh();
    }

    addCommand(chosen: PinnedCommandsQuickPickItem) {
        // first check if it is already in the list of pinned commands.
        if(this.findNode(chosen.label) == -1) {
            const node = new PinnedCommandNode(chosen.label, chosen.command, true);
            this.pinnedCommands.push(node);
            this.refresh();
            this.updateSettings();
        }
    }
    
    findNode(nodeLabel: string) {
        for(let i = 0; i < this.pinnedCommands.length; i++) {
            if (this.pinnedCommands[i].label === nodeLabel) {
                return i;
            }
        }
        return -1;
    }

    removeCommand(node: PinnedCommandNode) {
        const index = this.findNode(node.label as string);
        if (index != -1) {
            this.pinnedCommands.splice(index, 1);
            this.refresh();
        }
        this.updateSettings();
    }

    runCommand(node: PinnedCommandNode) {
        node.runThisCommand();
    }

    getTreeItem(node: PinnedCommandNode): vscode.TreeItem {
        return node.getTreeItem();
    }

    updateSettings() {
        if (this.config) {
            const newValue: string[] = this.pinnedCommands.map(x=>x.commandName);
            this.config.update(this.pinnedCommandsKey, newValue, true); // update global
        }
    }

    public async refresh() {
        this._onDidChangeTreeData.fire();
    }

    dispose(): void {
        this.treeView.dispose();
        this._settingsSub.dispose();
    }

    async getChildren(): Promise<PinnedCommandNode[]> {
        if(!this.isInitialized) {
            await this.initialize();
        }
        return this.pinnedCommands.filter(x=>x.isVisible)!;
    }
}
