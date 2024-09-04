import * as path from 'path';
import * as vscode from 'vscode';
import { TestMemento, StateMemento } from './memento';
const notImplementedErr: string = 'Method not implemented.';
export class DefaultExtensionContext implements vscode.ExtensionContext {
    get subscriptions(): { dispose(): any }[] {
        return [];
    }
    workspaceState: vscode.Memento = new TestMemento();
    globalState: vscode.Memento & { setKeysForSync(keys: string[]): void } = new StateMemento();
    get secrets(): vscode.SecretStorage {
        throw new Error(notImplementedErr);
    }
    get extensionUri(): vscode.Uri {
        throw new Error(notImplementedErr);
    }
    get extensionPath(): string {
        throw new Error(notImplementedErr);
    }
    get environmentVariableCollection(): vscode.GlobalEnvironmentVariableCollection {
        throw new Error(notImplementedErr);
    }
    asAbsolutePath(relativePath: string): string {
        return relativePath;
    }
    storageUri: vscode.Uri | undefined;
    storagePath: string | undefined;
    get globalStorageUri(): vscode.Uri {
        throw new Error(notImplementedErr);
    }
    get globalStoragePath(): string {
        throw new Error(notImplementedErr);
    }
    get logUri(): vscode.Uri {
        throw new Error(notImplementedErr);
    }
    logPath: string = "";
    get extensionMode(): vscode.ExtensionMode {
        throw new Error(notImplementedErr);
    }
    extension: vscode.Extension<any>;

    constructor() {
        this.extension = vscode.extensions.getExtension("ms-vscode.cmake-tools")!;
    }
    public clean() {
        (this.workspaceState as TestMemento).clear();
        (this.globalState as StateMemento).clear();
    }
}

export class SmokeTestExtensionContext implements vscode.ExtensionContext {
    get subscriptions(): { dispose(): any }[] {
        return [];
    }
    workspaceState: vscode.Memento = new TestMemento();
    globalState: vscode.Memento & { setKeysForSync(keys: string[]): void } = new StateMemento();
    get secrets(): vscode.SecretStorage {
        throw new Error(notImplementedErr);
    }
    get extensionUri(): vscode.Uri {
        throw new Error(notImplementedErr);
    }
    get environmentVariableCollection(): vscode.GlobalEnvironmentVariableCollection {
        throw new Error(notImplementedErr);
    }
    asAbsolutePath(sub: string): string {
        return path.join(this.extensionPath, sub);
    }
    storageUri: vscode.Uri | undefined;
    get storagePath() {
        return path.join(this.extensionPath, '.smoke-storage');
    }
    get globalStorageUri(): vscode.Uri {
        throw new Error(notImplementedErr);
    }
    get globalStoragePath(): string {
        throw new Error(notImplementedErr);
    }
    get logUri(): vscode.Uri {
        throw new Error(notImplementedErr);
    }
    get logPath() {
        return path.join(this.extensionPath, '.smoke-logs');
    }
    get extensionMode(): vscode.ExtensionMode {
        throw new Error(notImplementedErr);
    }
    extension: vscode.Extension<any>;

    constructor(public readonly extensionPath: string) {
        this.extension = vscode.extensions.getExtension("ms-vscode.cmake-tools")!;
    }
    public clean() {
        (this.workspaceState as TestMemento).clear();
        (this.globalState as StateMemento).clear();
    }
}
