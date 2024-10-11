import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { getExtensionActiveCommands, getExtensionLocalizedStrings, onExtensionActiveCommandsChanged } from '@cmt/extension';
import * as logging from '@cmt/logging';
import { ConfigurationReader } from '@cmt/config';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
const log = logging.createLogger('pinnedCommands');
const defaultTaskCommands: string[] = ["workbench.action.tasks.configureTaskRunner", "workbench.action.tasks.runTask"];
const mementoKey = "pinDefaultTasks";

interface PinnedCommandsQuickPickItem extends vscode.QuickPickItem {
    command: string;
}

class PinnedCommandNode extends vscode.TreeItem {
    public commandName: string;
    public isVisible: boolean;
    constructor(label: string, command: string, isVisible: boolean) {
        super(label);
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        this.tooltip = label;
        this.commandName = command;
        this.isVisible = isVisible;
    }

    getTreeItem(): vscode.TreeItem {
        return this;
    }

    async runThisCommand() {
        await vscode.commands.executeCommand(this.commandName);
    }
}

export class PinnedCommands {

    private treeDataProvider: PinnedCommandsTreeDataProvider;
    protected disposables: vscode.Disposable[] = [];

    constructor(configReader: ConfigurationReader, extensionContext: vscode.ExtensionContext) {
        this.treeDataProvider = new PinnedCommandsTreeDataProvider(configReader, extensionContext);
        this.disposables.push(...[
            // Commands for projectStatus items
            vscode.commands.registerCommand('cmake.pinnedCommands.add', async () => {
                const chosen = await this.showPinnableCommands();
                if (chosen !== null) {
                    await this.treeDataProvider.addCommand(chosen);
                }
            }),
            vscode.commands.registerCommand('cmake.pinnedCommands.remove', async (what: PinnedCommandNode) => {
                await this.treeDataProvider.removeCommand(what);
            }),
            vscode.commands.registerCommand('cmake.pinnedCommands.run', async (what: PinnedCommandNode) => {
                await this.treeDataProvider.runCommand(what);
            })
        ]);
    }

    /**
     * Show List of All Commands that can be pinned
     */
    async showPinnableCommands(): Promise<PinnedCommandsQuickPickItem | null> {
        const localization = getExtensionLocalizedStrings();
        const items = PinnedCommands.getPinnableCommands().map((x) => ({
            command: x,
            label: localization[`cmake-tools.command.${x}.title`]} as PinnedCommandsQuickPickItem));
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

    static getPinnableCommands(): string[] {
        const commands = getExtensionActiveCommands();
        return commands.concat(defaultTaskCommands);
    }
}

class PinnedCommandsTreeDataProvider implements vscode.TreeDataProvider<PinnedCommandNode>, vscode.Disposable {
    private treeView: vscode.TreeView<PinnedCommandNode>;
    private _onDidChangeTreeData: vscode.EventEmitter<PinnedCommandNode | void> = new vscode.EventEmitter<PinnedCommandNode | void>();
    private pinnedCommands: PinnedCommandNode[] = [];
    private config: vscode.WorkspaceConfiguration | null;
    private pinnedCommandsKey: string = "cmake.pinnedCommands";
    private isInitialized = false;
    private pinDefaultTasks = true;
    private readonly _settingsSub ;
    private extensionContext: vscode.ExtensionContext;

    constructor(configReader: ConfigurationReader, extensionContext: vscode.ExtensionContext) {
        this.treeView = vscode.window.createTreeView('cmake.pinnedCommands', { treeDataProvider: this });
        this._settingsSub = configReader.onChange('pinnedCommands', () => this.doConfigureSettingsChange());
        this.config = vscode.workspace.getConfiguration();
        this.extensionContext = extensionContext;
        this.pinDefaultTasks = this.extensionContext.globalState.get(mementoKey) === undefined; // the user has not unpinned any of the tasks commands yet.
        onExtensionActiveCommandsChanged(this.doConfigureSettingsChange, this);
    }

    get onDidChangeTreeData(): vscode.Event<PinnedCommandNode | void | undefined> {
        return this._onDidChangeTreeData.event;
    }

    async initialize(): Promise<void> {
        this.config = vscode.workspace.getConfiguration();
        this.pinnedCommands = []; //reset to empty list.
        const localization = getExtensionLocalizedStrings();
        if (this.config.has(this.pinnedCommandsKey)) {
            const settingsPinnedCommands = this.config.get(this.pinnedCommandsKey) as string[];
            const activeCommands = new Set<string>(PinnedCommands.getPinnableCommands());
            for (const commandName of settingsPinnedCommands) {
                const label = localization[`cmake-tools.command.${commandName}.title`];
                if (this.findNode(label) === -1) {
                    // only show commands that are contained in the active commands for the extension.
                    this.pinnedCommands.push(new PinnedCommandNode(label, commandName, activeCommands.has(commandName)));
                }
            }
        }

        if (this.pinDefaultTasks) {
            if (this.pinnedCommands.filter(x => defaultTaskCommands.includes(x.commandName)).length !== defaultTaskCommands.length) {
                defaultTaskCommands.forEach((x) => {
                    const label = localization[`cmake-tools.command.${x}.title`];
                    if (this.findNode(label) === -1) {
                        this.pinnedCommands.push(new PinnedCommandNode(label, x, true));
                    }
                });
                await this.updateSettings();
            }
        }
        this.isInitialized = true;
    }

    async doConfigureSettingsChange() {
        await this.initialize();
        await this.refresh();
    }

    async addCommand(chosen: PinnedCommandsQuickPickItem) {
        // first check if it is already in the list of pinned commands.
        if (this.findNode(chosen.label) === -1) {
            const node = new PinnedCommandNode(chosen.label, chosen.command, true);
            this.pinnedCommands.push(node);
            await this.refresh();
            await this.updateSettings();
        }
    }

    findNode(nodeLabel: string) {
        for (let i = 0; i < this.pinnedCommands.length; i++) {
            if (this.pinnedCommands[i].label === nodeLabel) {
                return i;
            }
        }
        return -1;
    }

    async removeCommand(node: PinnedCommandNode) {
        const index = this.findNode(node.label as string);
        if (index !== -1) {
            this.pinnedCommands.splice(index, 1);
            await this.refresh();
        }
        if (this.pinDefaultTasks && defaultTaskCommands.includes(node.commandName)) {
            await this.extensionContext.globalState.update(mementoKey, false);
            this.pinDefaultTasks = false;
        }
        await this.updateSettings();
    }

    async runCommand(node: PinnedCommandNode) {
        await node.runThisCommand();
    }

    getTreeItem(node: PinnedCommandNode): vscode.TreeItem {
        return node.getTreeItem();
    }

    async updateSettings() {
        if (this.config) {
            const newValue: string[] = this.pinnedCommands.map(x => x.commandName);
            await this.config.update(this.pinnedCommandsKey, newValue, true); // update global
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
        if (!this.isInitialized) {
            await this.initialize();
        }
        return this.pinnedCommands.filter(x => x.isVisible)!;
    }
}
