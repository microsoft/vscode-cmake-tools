import * as cms from '@cmt/cms-client';
import {thisExtension} from '@cmt/util';
import * as path from 'path';
import * as vscode from 'vscode';

import rollbar from './rollbar';
import {splitPath} from './util';

abstract class BaseNode {
  abstract getChildren(): BaseNode[];
  abstract getTreeItem(): vscode.TreeItem;
}

type UpdateList = (BaseNode|null)[];

interface SimpleTree<T> {
  pathPart: string;
  items: T[];
  children: SimpleTree<T>[];
}

function addToTree<T>(tree: SimpleTree<T>, itemPath: string, item: T) {
  const elems = splitPath(itemPath);
  for (const el of elems) {
    let subtree = tree.children.find(n => n.pathPart === el);
    if (!subtree) {
      subtree = {
        pathPart: el,
        children: [],
        items: [],
      };
      tree.children.push(subtree);
    }
    tree = subtree;
  }
  tree.items.push(item);
}

function collapseTreeInplace<T>(tree: SimpleTree<T>): void {
  const new_children: SimpleTree<T>[] = [];
  for (let child of tree.children) {
    while (child.children.length === 1 && child.items.length === 0) {
      const subchild = child.children[0];
      child = {
        pathPart: path.join(child.pathPart, subchild.pathPart),
        items: subchild.items,
        children: subchild.children,
      };
    }
    collapseTreeInplace(child);
    new_children.push(child);
  }
  tree.children = new_children;
}

function mapTreeItems<T, U>(tree: SimpleTree<T>, map: (item: T) => U): SimpleTree<U> {
  return {
    pathPart: tree.pathPart,
    items: tree.items.map(map),
    children: tree.children.map(c => mapTreeItems(c, map)),
  };
}

function iconForTargetType(type: cms.TargetTypeString): string {
  switch (type) {
  case 'EXECUTABLE':
    return 'res/exe.svg';
  case 'MODULE_LIBRARY':
  case 'SHARED_LIBRARY':
  case 'OBJECT_LIBRARY':
  case 'INTERFACE_LIBRARY':
  case 'STATIC_LIBRARY':
    return 'res/lib.svg';
  case 'UTILITY':
    return 'res/build-icon.svg';
  }
}

function sortIndexForType(type: cms.TargetTypeString): number {
  switch (type) {
  case 'EXECUTABLE':
    return 0;
  case 'MODULE_LIBRARY':
  case 'SHARED_LIBRARY':
  case 'STATIC_LIBRARY':
    return 1;
  case 'UTILITY':
    return 2;
  case 'OBJECT_LIBRARY':
    return 3;
  case 'INTERFACE_LIBRARY':
    return 4;
  }
}

interface ExternalContext {
  defaultTargetName: string;
  launchTargetName: string|null;
}

export class SourceFileNode extends BaseNode {
  constructor(private readonly _target: TargetNode, private _filepath: string) { super(); }

  getChildren() { return []; }

  getTreeItem() {
    const item = new vscode.TreeItem(path.basename(this._filepath));
    item.id = `${this._target.id}::${this._filepath}`;
    item.resourceUri = vscode.Uri.file(this._filepath);
    item.command = {
      title: 'Open file',
      command: 'vscode.open',
      arguments: [item.resourceUri],
    };
    return item;
  }
}

export class TargetNode extends BaseNode {
  private constructor(readonly projectName: string, cm: cms.CodeModelTarget) {
    super();
    if (cm.artifacts && cm.artifacts.length > 0) {
      this._fsPath = path.normalize(cm.artifacts[0]);
    } else {
      this._fsPath = cm.fullName || '';
    }
    this._name = cm.name;
    this._fullName = cm.fullName || '';
    this._type = cm.type;
    this._sourceDir = cm.sourceDirectory || '';

    const tree: SimpleTree<SourceFileNode> = {
      pathPart: this._sourceDir,
      items: [],
      children: [],
    };

    for (const grp of cm.fileGroups || []) {
      for (let src of grp.sources) {
        if (!path.isAbsolute(src)) {
          src = path.join(this._sourceDir, src);
        }
        const src_dir = path.dirname(src);
        const relpath = path.relative(this._sourceDir, src_dir);
        addToTree(tree, relpath, new SourceFileNode(this, src));
      }
    }

    collapseTreeInplace(tree);

    this._children = ([] as BaseNode[])
                         .concat(tree.children.map(c => DirectoryNode.fromSimpleTree(this.id, this._sourceDir, c)))
                         .concat(tree.items);
  }

  private _name: string;
  private _fsPath: string;
  private _fullName: string;
  private _type: cms.TargetTypeString;
  private _sourceDir: string;
  private _isDefault: boolean = false;
  private _isLaunch: boolean = false;

  private _children: BaseNode[] = [];

  /**
   * The name of the target
   */
  get name(): string { return this._name; }

  get type() { return this._type; }

  getChildren() { return this._children; }

  getTreeItem() {
    try {
      const item = new vscode.TreeItem(this.name);
      if (this._children.length) {
        item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      }
      if (this._isDefault) {
        item.label += ' 🔨';
      }
      if (this._isLaunch) {
        item.label += ' 🚀';
      }
      if (this._fullName != this.name && this._fullName) {
        item.label += ` [${this._fullName}]`;
      }
      if (this.type === 'INTERFACE_LIBRARY') {
        item.label += ' — Interface library';
      } else if (this.type === 'UTILITY') {
        item.label += ' — Utility';
      } else if (this.type === 'OBJECT_LIBRARY') {
        item.label += ' — Object library';
      }
      item.resourceUri = vscode.Uri.file(this._fsPath);
      item.tooltip = `Target ${this.name}`;
      if (this._isLaunch) {
        item.tooltip += ' [launch]';
      }
      if (this._isDefault) {
        item.tooltip += ' [default]';
      }
      const icon = iconForTargetType(this._type);
      item.iconPath = path.join(thisExtension().extensionPath, icon);
      item.id = this.id;
      const canBuild = this.type !== 'INTERFACE_LIBRARY' && this.type !== 'UTILITY' && this.type !== 'OBJECT_LIBRARY';
      const canRun = this.type === 'UTILITY';
      item.contextValue = [
        `nodeType=target`,
        `isDefault=${this._isDefault}`,
        `isLaunch=${this._isLaunch}`,
        `type=${this.type}`,
        `canBuild=${canBuild}`,
        `canRun=${canRun}`,
      ].join(',');
      return item;
    } catch (e) {
      debugger;
      return new vscode.TreeItem(`${this.name} (there was an issue rendering this item. This is a bug)`);
    }
  }

  get id() { return `${this.projectName}::${path.join(this._sourceDir, this._name)}`; }

  update(target: cms.CodeModelTarget, ctx: ExternalContext, updates?: UpdateList) {
    let did_update = this._name != target.name;
    this._name = target.name;
    this._sourceDir = target.sourceDirectory || '';
    const old_fspath = this._fsPath;
    if (target.artifacts && target.artifacts.length) {
      this._fsPath = path.normalize(target.artifacts[0]);
    } else {
      this._fsPath = target.fullName || '';
    }
    this._fullName = target.fullName || '';
    this._type = target.type;
    const new_is_default = this.name === ctx.defaultTargetName;
    if (new_is_default !== this._isDefault) {
      did_update = true;
    }
    const new_is_launch = this.name === ctx.launchTargetName;
    if (new_is_launch !== this._isLaunch) {
      did_update = true;
    }
    this._isLaunch = new_is_launch;
    this._isDefault = new_is_default;

    const new_sources = new Set<string>();
    for (const grp of target.fileGroups || []) {
      for (const item of grp.sources) {
        if (path.isAbsolute(item)) {
          new_sources.add(item);
        } else {
          new_sources.add(path.join(target.sourceDirectory || '', item));
        }
      }
    }

    did_update = did_update || old_fspath !== this._fsPath;
    if (did_update && updates) {
      updates.push(this);
    }
  }

  static fromCodeModel(projectName: string, cm: cms.CodeModelTarget): TargetNode {
    return new TargetNode(projectName, cm);
  }
}


export class DirectoryNode extends BaseNode {
  constructor(readonly prefix: string,
              readonly parent: string,
              readonly pathPart: string,
              private _children: BaseNode[]) {
    super();
  }

  get fsPath(): string { return path.join(this.parent, this.pathPart); }

  getChildren() { return this._children; }

  getTreeItem() {
    const item = new vscode.TreeItem(this.pathPart, vscode.TreeItemCollapsibleState.Collapsed);
    item.resourceUri = vscode.Uri.file(this.fsPath);
    item.id = `${this.prefix}::${this.fsPath}`;
    return item;
  }

  static fromSimpleTree<NodeType extends BaseNode>(prefix: string, parent: string, tree: SimpleTree<NodeType>):
      DirectoryNode {
    const abs_path = path.join(parent, tree.pathPart);
    const child_dirs: BaseNode[] = tree.children.map(n => DirectoryNode.fromSimpleTree(prefix, abs_path, n));
    return new DirectoryNode(prefix, parent, tree.pathPart, child_dirs.concat(tree.items));
  }
}

type TargetTree = SimpleTree<cms.CodeModelTarget>;

class ProjectNode extends BaseNode {
  constructor(private _name: string) { super(); }

  /**
   * The name of the project
   */
  get name(): string { return this._name; }

  private _rootDir: DirectoryNode = new DirectoryNode('', '', '', []);

  getChildren() {
    return this._rootDir.getChildren();
    // const items = this._children;
    // return items.sort((a, b) => {
    //   // The lexical order of the type strings is actually pretty useful as the
    //   // primary sort.
    //   const type_rel = sortIndexForType(a.type) - sortIndexForType(b.type);
    //   if (type_rel != 0) {
    //     return type_rel;
    //   }
    //   // Otherwise sort by name
    //   return a.name.localeCompare(b.name);
    // });
  }

  getTreeItem() {
    const item = new vscode.TreeItem(this.name, vscode.TreeItemCollapsibleState.Expanded);
    if (this.getChildren().length === 0) {
      item.label += ' — (Empty project)';
    }
    return item;
  }

  update(pr: cms.CodeModelProject, ctx: ExternalContext) {
    if (pr.name !== this.name) {
      rollbar.error(`Update project with mismatching name property`, {newName: pr.name, oldName: this.name});
    }

    const tree: TargetTree = {
      pathPart: '',
      children: [],
      items: [],
    };

    for (const target of pr.targets) {
      const srcdir = target.sourceDirectory || '';
      const relpath = path.relative(pr.sourceDirectory, srcdir);
      addToTree(tree, relpath, target);
    }

    collapseTreeInplace(tree);

    const target_tree = mapTreeItems(tree, target => TargetNode.fromCodeModel(pr.name, target));
    this._rootDir = DirectoryNode.fromSimpleTree(pr.name, pr.sourceDirectory, target_tree);
  }
}

export class ProjectOutlineProvider implements vscode.TreeDataProvider<BaseNode> {
  private readonly _changeEvent = new vscode.EventEmitter<BaseNode|null>();
  get onDidChangeTreeData() { return this._changeEvent.event; }

  private _children: BaseNode[] = [];

  private _codeModel: cms.CodeModelContent = {configurations: []};

  get codeModel() { return this._codeModel; }

  updateCodeModel(model: cms.CodeModelContent|null, ctx: ExternalContext) {
    if (!model || model.configurations.length < 1) {
      return;
    }
    this._codeModel = model;
    const config = model.configurations[0];
    const new_children: BaseNode[] = [];
    for (const pr of config.projects) {
      const item = new ProjectNode(pr.name);
      item.update(pr, ctx);
      new_children.push(item);
    }
    this._children = new_children;

    this._changeEvent.fire(null);
  }

  getChildren(node?: BaseNode): BaseNode[] {
    try {
      if (!node) {
        // Request for root node
        return this._children;
      } else {
        return node.getChildren();
      }
    } catch (e) {
      rollbar.error('Error while rendering children nodes');
      return [];
    }
  }

  async getTreeItem(node: BaseNode) { return node.getTreeItem(); }
}
