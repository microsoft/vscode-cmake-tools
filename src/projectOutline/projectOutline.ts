import * as path from 'path';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as codeModel from '@cmt/drivers/codeModel';
import rollbar from '@cmt/rollbar';
import { lexicographicalCompare, splitPath } from '@cmt/util';
import CMakeProject from '@cmt/cmakeProject';
import { populateViewCodeModel } from './targetsViewCodeModel';
import { fs } from '@cmt/pr';
import { CodeModelKind } from '@cmt/drivers/cmakeFileApi';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

interface NamedItem {
    name: string;
}

/**
 * Base class of nodes in all tree nodes
 */
abstract class BaseNode {
    constructor(public readonly id: string) {}

    /**
     * Get the child nodes of this node
     */
    abstract getChildren(): BaseNode[];

    /**
     * Get the vscode.TreeItem associated with this node
     */
    abstract getTreeItem(): vscode.TreeItem;

    abstract getOrderTuple(): string[];
}

/**
 * Context to use while updating the tree
 */
interface TreeUpdateContext {
    defaultTarget?: string;
    launchTargetName: string | null;
    nodesToUpdate: BaseNode[];
    folder: vscode.WorkspaceFolder;
}

/**
 * A simple data structure that holds the intermediate data while we build the
 * directory tree using filepaths.
 */
interface PathedTree<T> {
    pathPart: string;
    items: T[];
    children: PathedTree<T>[];
}

/**
 * Add an item to a PathedTree at the given path. Updates intermediate branches
 * as necessary.
 * @param tree The tree to update
 * @param itemPath The path to the item to add
 * @param item The item which will be added
 */
function addToTree<T>(tree: PathedTree<T>, itemPath: string, item: T) {
    const elems = splitPath(itemPath);
    for (const el of elems) {
        let subtree = tree.children.find(n => n.pathPart === el);
        if (!subtree) {
            subtree = {
                pathPart: el,
                children: [],
                items: []
            };
            tree.children.push(subtree);
        }
        tree = subtree;
    }
    tree.items.push(item);
}

/**
 * Collapse elements in the tree which contain only one child tree.
 * @param tree The tree to collapse
 */
function collapseTreeInplace<T>(tree: PathedTree<T>): void {
    const new_children: PathedTree<T>[] = [];
    for (let child of tree.children) {
        while (child.children.length === 1 && child.items.length === 0) {
            const subchild = child.children[0];
            child = {
                pathPart: path.join(child.pathPart, subchild.pathPart),
                items: subchild.items,
                children: subchild.children
            };
        }
        collapseTreeInplace(child);
        new_children.push(child);
    }
    tree.children = new_children;
}

/**
 * Get the path to an icon for the given type of CMake target.
 * @param type The type of target
 */
function iconForTargetType(type: codeModel.TargetTypeString): string {
    switch (type) {
        case 'EXECUTABLE':
            return 'file-binary';
        case 'MODULE_LIBRARY':
        case 'SHARED_LIBRARY':
        case 'OBJECT_LIBRARY':
        case 'INTERFACE_LIBRARY':
        case 'STATIC_LIBRARY':
            return 'library';
        case 'UTILITY':
            return 'tools';
    }
}

export class DirectoryNode<Node extends BaseNode> extends BaseNode {
    constructor(readonly prefix: string, readonly parent: string, readonly pathPart: string) {
        super(`${prefix}${path.sep}${path.normalize(pathPart)}`);
    }

    private _subdirs = new Map<string, DirectoryNode<Node>>();
    private _leaves = new Map<string, Node>();

    getOrderTuple() {
        return [this.id];
    }

    get fsPath(): string {
        return path.join(this.parent, this.pathPart);
    }

    getChildren() {
        const ret: BaseNode[] = [];
        const subdirs = [...this._subdirs.values()].sort((a, b) => a.pathPart.localeCompare(b.pathPart));
        ret.push(...subdirs);
        const leaves = [...this._leaves.values()].sort((a, b) => lexicographicalCompare(a.getOrderTuple(), b.getOrderTuple()));
        ret.push(...leaves);
        return ret;
    }

    getTreeItem() {
        const item = new vscode.TreeItem(this.pathPart, vscode.TreeItemCollapsibleState.Collapsed);
        item.resourceUri = vscode.Uri.file(this.fsPath);
        item.id = this.id;
        return item;
    }

    update<InputItem extends NamedItem>(opts: {
        tree: PathedTree<InputItem>;
        context: TreeUpdateContext;
        create(input: InputItem): Node;
        update(existingNode: Node, input: InputItem): void;
    }) {
        const new_subdirs = new Map<string, DirectoryNode<Node>>();
        const new_leaves = new Map<string, Node>();
        let did_update = false;
        for (const new_subdir of opts.tree.children) {
            let existing = this._subdirs.get(new_subdir.pathPart);
            if (!existing) {
                existing = new DirectoryNode<Node>(this.id, this.fsPath, new_subdir.pathPart);
                did_update = true;
            }
            existing.update({
                ...opts,
                tree: new_subdir
            });
            new_subdirs.set(new_subdir.pathPart, existing);
        }
        for (const new_leaf of opts.tree.items) {
            let existing = this._leaves.get(new_leaf.name);
            if (!existing) {
                existing = opts.create(new_leaf);
                did_update = true;
            } else {
                opts.update(existing, new_leaf);
            }
            new_leaves.set(new_leaf.name, existing);
        }
        if (new_subdirs.size !== this._subdirs.size) {
            // We added/removed nodes
            did_update = true;
        }
        if (new_leaves.size !== this._leaves.size) {
            // We added/removed leaves
            did_update = true;
        }
        this._subdirs = new_subdirs;
        this._leaves = new_leaves;
        if (did_update) {
            opts.context.nodesToUpdate.push(this);
        }
    }
}

export class SourceFileNode extends BaseNode {
    constructor(readonly prefix: string, readonly folder: vscode.WorkspaceFolder, readonly sourcePath: string, readonly filePath: string, private readonly _language?: string) {
        // id: {prefix}::filename:directory of file relative to Target
        super(`${prefix}::${path.basename(filePath)}:${path.relative(sourcePath, path.dirname(filePath))}`);
    }

    get name() {
        return path.basename(this.filePath);
    }

    getChildren() {
        return [];
    }

    getOrderTuple() {
        return [this.name];
    }

    getTreeItem() {
        const item = new vscode.TreeItem(path.basename(this.filePath));
        item.id = this.id;
        item.resourceUri = vscode.Uri.file(this.filePath);
        const name = this.name.toLowerCase();
        const cml = name === "cmakelists.txt";
        const is_compilable = ['CXX', 'C'].indexOf(this._language || '') !== -1;
        item.contextValue = ['nodeType=file', `compilable=${is_compilable}`, `cmakelists=${cml}`].join(',');
        item.command = {
            title: localize('open.file', 'Open file'),
            command: 'vscode.open',
            arguments: [item.resourceUri]
        };
        return item;
    }
}

export class ReferencesNode extends BaseNode {
    constructor(targetId: string) {
        super(`${targetId}-references`);
    }

    get name() {
        return this.id;
    }

    private _references = new Map<string, ReferenceNode>();

    getChildren(): BaseNode[] {
        return [...this._references.values()];
    }
    getTreeItem(): vscode.TreeItem {
        const item = new vscode.TreeItem(this.id);
        item.id = this.id;
        if (this.getChildren().length) {
            item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        }
        item.label = localize('references', 'References');
        item.contextValue = ['nodeType=references', `compilable=${false}`, `cmakelists=${false}`].join(',');
        item.iconPath = new vscode.ThemeIcon('references');
        return item;
    }
    getOrderTuple(): string[] {
        return [this.id];
    }

    update(dependencies: CodeModelKind.Dependency[], targetId: string) {
        const new_refs = new Map<string, ReferenceNode>();
        for (const ref of dependencies) {
            // filter out dependecies that are found and don't have a defined backtrace
            if (ref.backtrace !== undefined) {
                new_refs.set(ref.id, new ReferenceNode(ref.id, targetId));
            }
        }
        this._references = new_refs;
    }
}

export class ReferenceNode extends BaseNode {
    constructor(id: string = "", parentTargetId: string) {
        const name = id.split("::")[0];
        super(`${name}-${parentTargetId}`);
        this.name = name;
    }

    readonly name: string;

    getChildren(): BaseNode[] {
        return [];
    }
    getTreeItem(): vscode.TreeItem {
        const item = new vscode.TreeItem(this.id);
        item.id = this.id;
        item.label = this.name;
        item.contextValue = [
            "nodeType=reference",
            `compilable=${false}`,
            `cmakelists=${false}`
        ].join(",");
        item.iconPath = new vscode.ThemeIcon("references");
        return item;
    }
    getOrderTuple(): string[] {
        return [this.id];
    }
}

export class TargetNode extends BaseNode {
    constructor(readonly prefix: string, readonly projectName: string, cm: codeModel.CodeModelTarget, readonly folder: vscode.WorkspaceFolder) {
        // id: {prefix}::target_name:artifact_name:target_path
        super(`${prefix}::${cm.name || ''}:${cm.fullName || ''}:${cm.sourceDirectory || ''}`);
        this.name = cm.name;
        this.sourceDir = cm.sourceDirectory || '';
        this._rootDir = new DirectoryNode<SourceFileNode>(this.id, this.sourceDir, '');
    }

    readonly name: string;
    readonly sourceDir: string;
    private _fullName = '';
    private _type: codeModel.TargetTypeString = 'UTILITY';
    private _isDefault = false;
    private _isLaunch = false;
    private _fsPath: string = '';

    getOrderTuple() {
        return [this.name];
    }

    private readonly _rootDir: DirectoryNode<SourceFileNode>;
    private readonly _referencesNode = new ReferencesNode(this.id);

    getChildren() {
        return [this._referencesNode, ...this._rootDir.getChildren()];
    }
    getTreeItem() {
        try {
            const item = new vscode.TreeItem(this.name);
            if (this.getChildren().length) {
                item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
            }
            if (this._isDefault) {
                item.label += ' 🔨';
            }
            if (this._isLaunch) {
                item.label += ' 🚀';
            }

            if (this._type === "STATIC_LIBRARY") {
                item.label += ` (${localize('static.library', 'Static library')})`;
            } else if (this._type === "MODULE_LIBRARY") {
                item.label += ` (${localize('module.library', 'Module library')})`;
            }  else if (this._type === "SHARED_LIBRARY") {
                item.label += ` (${localize('shared.library', 'Shared library')})`;
            } else if (this._type === 'OBJECT_LIBRARY') {
                item.label += ` (${localize('object.library', 'Object library')})`;
            } else if (this._type === "EXECUTABLE") {
                item.label += ` (${localize('executable', 'Executable')})`;
            } else if (this._type === 'UTILITY') {
                item.label += ` (${localize('utility', 'Utility')})`;
            } else if (this._type === 'INTERFACE_LIBRARY') {
                item.label += ` (${localize('interface.library', 'Interface library')})`;
            }

            item.resourceUri = vscode.Uri.file(this._fsPath);
            item.tooltip = localize('target.tooltip', 'Target {0}', this.name);
            if (this._isLaunch) {
                item.tooltip += ` [${localize('launch.tooltip', 'launch')}]`;
            }
            if (this._isDefault) {
                item.tooltip += ` [${localize('default.tooltip', 'default')}]`;
            }
            item.iconPath = new vscode.ThemeIcon(iconForTargetType(this._type));
            item.id = this.id;
            const canBuild = this._type !== 'INTERFACE_LIBRARY' && this._type !== 'UTILITY' && this._type !== 'OBJECT_LIBRARY';
            const canRun = this._type === 'UTILITY';
            item.contextValue = [
                `nodeType=target`,
                `isDefault=${this._isDefault}`,
                `isLaunch=${this._isLaunch}`,
                `type=${this._type}`,
                `canBuild=${canBuild}`,
                `canRun=${canRun}`
            ].join(',');
            return item;
        } catch (e) {
            debugger;
            return new vscode.TreeItem(`${this.name} (${localize('item.render.issue', 'There was an issue rendering this item. This is a bug')})`);
        }
    }

    update(cm: codeModel.CodeModelTarget, ctx: TreeUpdateContext) {
        console.assert(this.name === cm.name);
        console.assert(this.sourceDir === (cm.sourceDirectory || ''));

        let did_update = this._fullName !== (cm.fullName || '');
        this._fullName = cm.fullName || '';

        const old_fspath = this._fsPath;
        if (cm.artifacts && cm.artifacts.length) {
            this._fsPath = path.normalize(cm.artifacts[0]);
        } else {
            this._fsPath = cm.fullName || '';
        }
        did_update = did_update || old_fspath !== this._fsPath;

        did_update = did_update || (this._type !== cm.type);
        this._type = cm.type;

        const new_is_default = !!ctx.defaultTarget && this.name === ctx.defaultTarget;
        did_update = did_update || new_is_default !== this._isDefault;
        this._isDefault = new_is_default;

        const new_is_launch = this.name === ctx.launchTargetName;
        did_update = did_update || new_is_launch !== this._isLaunch;
        this._isLaunch = new_is_launch;

        const tree: PathedTree<SourceFileNode> = {
            pathPart: this.sourceDir,
            items: [],
            children: []
        };

        for (const grp of cm.fileGroups || []) {
            if (!grp.isGenerated) {
                for (let src of grp.sources) {
                    if (!path.isAbsolute(src)) {
                        src = path.join(this.sourceDir, src);
                    }
                    const src_dir = path.dirname(src);
                    const relpath = path.relative(this.sourceDir, src_dir);
                    addToTree(tree, relpath, new SourceFileNode(this.id, this.folder, this.sourceDir, src, grp.language));
                }
            }
        }

        addToTree(tree, '', new SourceFileNode(this.id, this.folder, this.sourceDir, path.join(this.sourceDir, 'CMakeLists.txt')));

        collapseTreeInplace(tree);

        this._rootDir.update({
            tree,
            context: ctx,
            update: (_src, _cm) => {},
            create: newNode => newNode
        });

        this._referencesNode.update(cm.dependencies || [], this.id);
    }

    async openInCMakeLists() {
        const cml_path = path.join(this.sourceDir, 'CMakeLists.txt');
        const doc = await vscode.workspace.openTextDocument(cml_path);
        const editor = await vscode.window.showTextDocument(doc);
        const doc_text = doc.getText();
        const regex = new RegExp(`(add_|ADD_)\\w+\\([\\s\\n]*?${this.name}[\\s\\n\\)]`, 'g');
        const offset = doc_text.search(regex);
        if (offset >= 0) {
            const pos = doc.positionAt(offset);
            editor.revealRange(new vscode.Range(pos, pos.translate(2)));
            editor.selection = new vscode.Selection(pos, pos);
        }
    }
}

export class ProjectNode extends BaseNode {
    constructor(
        readonly name: string,
        readonly folder: vscode.WorkspaceFolder,
        readonly sourceDirectory: string
    ) {
        // id: project_name:project_directory
        super(`${name}:${sourceDirectory}`);
    }

    private readonly _rootDir = new DirectoryNode<TargetNode>(this.id, '', '');

    private sortProjectChildren(children: BaseNode[]): BaseNode[] {
        return children.sort((a, b) => {
            if (a instanceof TargetNode && b instanceof TargetNode) {
                return lexicographicalCompare(a.getOrderTuple(), b.getOrderTuple());
            } else if (a instanceof TargetNode && b instanceof DirectoryNode) {
                return -1;
            } else if (a instanceof DirectoryNode && b instanceof TargetNode) {
                return 1;
            }

            return 0;
        });
    }

    getOrderTuple() {
        return [this.sourceDirectory, this.name];
    }

    getChildren() {
        const children: BaseNode[] = this.sortProjectChildren(this._rootDir.getChildren());

        const cmakelists = new SourceFileNode(this.id, this.folder, this.sourceDirectory, path.join(this.sourceDirectory, 'CMakeLists.txt'));
        children.push(cmakelists);

        const possiblePreset = path.join(this.sourceDirectory, 'CMakePresets.json');
        if (fs.existsSync(possiblePreset)) {
            children.push(new SourceFileNode(this.id, this.folder, this.sourceDirectory, possiblePreset));
        }

        const possibleUserPreset = path.join(this.sourceDirectory, 'CMakeUserPresets.json');
        if (fs.existsSync(possibleUserPreset)) {
            children.push(new SourceFileNode(this.id, this.folder, this.sourceDirectory, possibleUserPreset));
        }

        return children;
    }

    getTreeItem() {
        const item = new vscode.TreeItem(
            this.name,
            vscode.TreeItemCollapsibleState.Expanded
        );
        if (this.getChildren().length === 0) {
            item.label += ` — (${localize("empty.project", "Empty project")})`;
        }
        item.tooltip = `${this.name}\n${this.sourceDirectory}`;
        item.contextValue = "nodeType=project";
        return item;
    }

    update(pr: codeModel.CodeModelProject, ctx: TreeUpdateContext) {
        // TODO: Update. We need to

        if (pr.name !== this.name) {
            rollbar.error(
                localize(
                    "update.project.with.mismatch",
                    "Update project with mismatching name property"
                ),
                { newName: pr.name, oldName: this.name }
            );
        }

        const tree: PathedTree<codeModel.CodeModelTarget> = {
            pathPart: '',
            items: [],
            children: []
        };

        for (const t of pr.targets) {
            const target = t as codeModel.CodeModelTarget;

            // Skip targets that the generator auto-created.
            if (target.isGeneratorProvided) {
                continue;
            }

            if (target.folder) {
                addToTree(tree, target.folder.name, target);
            } else {
                addToTree(tree, '', target);
            }
        }

        this._rootDir.update({
            tree,
            context: ctx,
            update: (tgt, cm) => tgt.update(cm, ctx),
            create: newTgt => {
                const node = new TargetNode(this.id, this.name, newTgt, this.folder);
                node.update(newTgt, ctx);
                return node;
            }
        });

        // const target_tree = mapTreeItems(tree, target => TargetNode.fromCodeModel(pr.name, target));
        // this._rootDir = DirectoryNode.fromSimpleTree(pr.name, pr.sourceDirectory, target_tree);
    }
}

export class WorkspaceFolderNode extends BaseNode {
    constructor(readonly wsFolder: vscode.WorkspaceFolder) {
        super(`wsf/${wsFolder.uri.fsPath}`);
    }

    private _active: boolean = false;
    setActive(active: boolean) {
        this._active = active;
    }

    getOrderTuple() {
        return [this.id];
    }

    getTreeItem() {
        const item = new vscode.TreeItem(this.wsFolder.uri.fsPath, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = vscode.ThemeIcon.Folder;
        item.id = this.wsFolder.uri.fsPath;
        let description: string;
        if (this._active) {
            description = localize('workspace.active', 'Active Workspace');
        } else {
            description = localize('workspace', 'Workspace');
        }
        item.description = `[${description}]`;
        item.contextValue = ['nodeType=workspace', `selected=${this._active}`].join(',');
        return item;
    }

    private readonly _projects = new Map<string, Map<string, ProjectNode>>();

    private getNode(cmakeProject: CMakeProject, modelProjectName: string) {
        return this._projects.get(cmakeProject.folderPath)?.get(modelProjectName);
    }

    private setNode(cmakeProject: CMakeProject, modelProjectName: string, node: ProjectNode) {
        let sub_map = this._projects.get(cmakeProject.folderPath);
        if (!sub_map) {
            sub_map = new Map<string, ProjectNode>();
            this._projects.set(cmakeProject.folderPath, sub_map);
        }
        return sub_map.set(modelProjectName, node);
    }

    private removeNodes(cmakeProject: CMakeProject) {
        this._projects.delete(cmakeProject.folderPath);
    }

    updateCodeModel(cmakeProject: CMakeProject, model: codeModel.CodeModelContent | null, ctx: TreeUpdateContext) {
        if (!model || model.configurations.length < 1) {
            this.removeNodes(cmakeProject);
            ctx.nodesToUpdate.push(this);
            return;
        }

        if (model.configurations[0].projects.length === 0) {
            this.removeNodes(cmakeProject);
            ctx.nodesToUpdate.push(this);
            return;
        }

        const projectOutlineModel = populateViewCodeModel(model);
        const rootProject = projectOutlineModel.project;
        let item = this.getNode(cmakeProject, rootProject.name);
        if (!item) {
            item = new ProjectNode(rootProject.name, this.wsFolder, cmakeProject.folderPath);
            this.setNode(cmakeProject, rootProject.name, item);
        }
        item.update(rootProject, ctx);
    }

    getChildren() {
        const children: BaseNode[] = [];
        for (const sub_map of this._projects.values()) {
            children.push(...sub_map.values());
        }
        return children.sort((a, b) => lexicographicalCompare(a.getOrderTuple(), b.getOrderTuple()));
    }
}

export class ProjectOutline implements vscode.TreeDataProvider<BaseNode> {
    private readonly _changeEvent = new vscode.EventEmitter<BaseNode | null>();
    get onDidChangeTreeData() {
        return this._changeEvent.event;
    }

    private readonly _folders = new Map<string, WorkspaceFolderNode>();
    private _selected_workspace?: WorkspaceFolderNode;

    addAllCurrentFolders() {
        for (const wsf of vscode.workspace.workspaceFolders || []) {
            this._folders.set(wsf.uri.fsPath, new WorkspaceFolderNode(wsf));
        }
    }

    addFolder(folder: vscode.WorkspaceFolder) {
        this._folders.set(folder.uri.fsPath, new WorkspaceFolderNode(folder));
        this._changeEvent.fire(null);
    }

    removeFolder(folder: vscode.WorkspaceFolder) {
        this._folders.delete(folder.uri.fsPath);
        this._changeEvent.fire(null);
    }

    updateCodeModel(cmakeProject: CMakeProject, model: codeModel.CodeModelContent | null) {
        const folder = cmakeProject.workspaceContext.folder;
        let existing = this._folders.get(folder.uri.fsPath);
        if (!existing) {
            rollbar.error(localize('error.update.code.model.on.nonexist.folder', 'Updating code model on folder that has not yet been loaded.'));
            // That's an error, but we can keep going otherwise.
            existing = new WorkspaceFolderNode(folder);
            this._folders.set(folder.uri.fsPath, existing);
        }

        const updates: BaseNode[] = [];
        existing.updateCodeModel(
            cmakeProject,
            model,
            {
                defaultTarget: cmakeProject.defaultBuildTarget || undefined,
                launchTargetName: cmakeProject.launchTargetName,
                nodesToUpdate: updates,
                folder
            });

        this._changeEvent.fire(null);
    }

    getChildren(node?: BaseNode): BaseNode[] {
        try {
            if (node) {
                return node.getChildren();
            }
            // Request for root nodes
            if (this._folders.size === 1) {
                for (const folder of this._folders.values()) {
                    return folder.getChildren();
                }
            }
            return [...this._folders.values()];
        } catch (e) {
            rollbar.error(localize('error.rendering.children.nodes', 'Error while rendering children nodes'));
            return [];
        }
    }

    // TODO: project outline needs to be able to select a project in a multi-project folder. #2823
    setActiveFolder(folderPath: string | undefined): void {
        if (!folderPath) {
            return;
        }
        const current_node = this._selected_workspace;
        const new_node = this._folders.get(folderPath);
        if (current_node) {
            current_node.setActive(false);
            this._changeEvent.fire(current_node);
        }
        if (new_node) {
            new_node.setActive(true);
            this._changeEvent.fire(new_node);
        }
        this._selected_workspace = new_node;
    }

    async getTreeItem(node: BaseNode) {
        return node.getTreeItem();
    }
}
