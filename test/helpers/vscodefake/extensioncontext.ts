import * as vscode from 'vscode';
import {TestMemento} from './memento';

export class FakeContextDefinition implements vscode.ExtensionContext {
  get extensionPath(): string { throw new Error('Method not implemented.'); }

  get storagePath(): string|undefined { throw new Error('Method not implemented.'); }

  get subscriptions(): {dispose(): any;}[] { throw new Error('Method not implemented.'); }

  workspaceState: vscode.Memento = new TestMemento();
  globalState: vscode.Memento = new TestMemento();

  asAbsolutePath(relativePath: string): string { return relativePath; }

  constructor() {}

  public clean() {
    (this.workspaceState as TestMemento).clear();
    (this.globalState as TestMemento).clear();
  }
}