import * as vscode from 'vscode';
import { TestMemento } from './memento';

export class FakeContextDefinition implements vscode.ExtensionContext {

    subscriptions: {dispose(): any;}[];
    workspaceState: vscode.Memento;
    globalState: vscode.Memento;
    extensionPath: string;

    asAbsolutePath(relativePath: string): string { return relativePath; }
    storagePath: string|undefined;

    constructor() {
      this.globalState = new TestMemento();
      this.workspaceState = new TestMemento();
    }
  }