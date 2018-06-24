import * as cms from '@cmt/cms-client';
import {thisExtension} from '@cmt/util';
import * as path from 'path';
import * as vscode from 'vscode';

import rollbar from './rollbar';

abstract class BaseNode {
  abstract getChildren(): BaseNode[];
  abstract getTreeItem(): vscode.TreeItem;
}

type UpdateList = (BaseNode|null)[];

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
    item.id = this._filepath;
    item.resourceUri = vscode.Uri.file(this._filepath);
    return item;
  }
}

export class TargetNode extends BaseNode {
  constructor(private readonly _project: string, private _name: string) { super(); }

  private _fsPath: string = '';
  private _fullName: string = '';
  private _type: cms.TargetTypeString = 'UTILITY';
  private _isDefault: boolean = false;
  private _isLaunch: boolean = false;
  private _sourceDir = '';

  private _sources = new Set<SourceFileNode>();

  /**
   * The name of the target
   */
  get name(): string { return this._name; }

  get type() { return this._type; }

  getChildren() { return [...this._sources]; }

  getTreeItem() {
    try {
      const item = new vscode.TreeItem(this.name, vscode.TreeItemCollapsibleState.Collapsed);
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
        `isTarget=true`,
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

  get id() { return path.join(this._project, this._sourceDir, this._name); }

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

    this._sources.clear();
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
    for (const src of new_sources) {
      this._sources.add(new SourceFileNode(this, src));
    }

    did_update = did_update || old_fspath !== this._fsPath;
    if (did_update && updates) {
      updates.push(this);
    }
  }
}

class ProjectNode extends BaseNode {
  constructor(private _name: string) { super(); }

  /**
   * The name of the project
   */
  get name(): string { return this._name; }

  private _targets = new Map<string, TargetNode>();

  getChildren() {
    const items = [...this._targets.values()];
    return items.sort((a, b) => {
      // The lexical order of the type strings is actually pretty useful as the
      // primary sort.
      const type_rel = sortIndexForType(a.type) - sortIndexForType(b.type);
      if (type_rel != 0) {
        return type_rel;
      }
      // Otherwise sort by name
      return a.name.localeCompare(b.name);
    });
  }

  getTreeItem() {
    const item = new vscode.TreeItem(this.name, vscode.TreeItemCollapsibleState.Expanded);
    if (this._targets.size === 0) {
      item.label += ' — (Empty project)';
    }
    return item;
  }

  update(pr: cms.CodeModelProject, ctx: ExternalContext, updates?: UpdateList) {
    if (pr.name !== this.name) {
      rollbar.error(`Update project with mismatching name property`, {newName: pr.name, oldName: this.name});
    }

    let update_self = false;
    for (const target of pr.targets) {
      let existing = this._targets.get(target.name);
      if (!existing) {
        existing = new TargetNode(pr.name, target.name);
        update_self = true;
      }
      this._targets.set(target.name, existing);
      existing.update(target, ctx, updates);
    }

    if (updates && update_self) {
      updates.push(this);
    }
  }
}

export class ProjectOutlineProvider implements vscode.TreeDataProvider<BaseNode> {
  private readonly _changeEvent = new vscode.EventEmitter<BaseNode|null>();
  get onDidChangeTreeData() { return this._changeEvent.event; }

  private _projects = new Map<string, ProjectNode>();

  private _codeModel: cms.CodeModelContent = {configurations: []};

  get codeModel() { return this._codeModel; }

  updateCodeModel(model: cms.CodeModelContent|null, ctx: ExternalContext) {
    if (!model || model.configurations.length < 1) {
      this._projects.clear();
      this._changeEvent.fire(null);
      return;
    }
    this._codeModel = model;
    const config = model.configurations[0];
    let update_root = false;
    const to_update: UpdateList = [];
    for (const pr of config.projects) {
      let existing = this._projects.get(pr.name);
      if (!existing) {
        update_root = true;
        existing = new ProjectNode(pr.name);
      }
      this._projects.set(pr.name, existing);
      existing.update(pr, ctx, to_update);
    }

    if (update_root) {
      to_update.push(null);
    }
    for (const node of to_update.reverse()) {
      this._changeEvent.fire(node);
    }
  }

  getChildren(node?: BaseNode): BaseNode[] {
    try {
      if (!node) {
        // Request for root node
        return [...this._projects.values()];
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
