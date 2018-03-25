import * as vscode from 'vscode';

class CMakeToolsWorkspaceConfiguration implements vscode.WorkspaceConfiguration {
  private _values: {[section: string]: any;} = {};

  constructor(protected _original: vscode.WorkspaceConfiguration) {}

  readonly [key: string]: any;
  get<T>(section: string): T|undefined;
  get<T>(section: string, defaultValue: T): T;
  get(section: any, defaultValue?: any): any {
    if (this._values.hasOwnProperty(section)) {
      return this._values[section];
    } else {
      if (this._original.has(section)) {
        return this._original[section];
      } else {
        return defaultValue;
      }
    }
  }
  has(section: string): boolean {
    const fakeHasSection: boolean = this._values.has(section);
    const origHasSection: boolean = this._original.has(section);
    return fakeHasSection || origHasSection;
  }
  inspect<T>(): {
    key: string;
    defaultValue?: T | undefined;
    globalValue?: T | undefined;
    workspaceValue?: T | undefined;
    workspaceFolderValue?: T | undefined;
  }|undefined {
    throw new Error('Method not implemented.');
  }
  update(section: string, value: any): Thenable<void> {
    this._values[section] = value;
    return Promise.resolve();
  }
  public clear() { this._values = {}; }
}

export class CMakeToolsSettingFile {

  readonly originalValues: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('cmake');
  readonly filepath: string;
  readonly fakeValues: CMakeToolsWorkspaceConfiguration = new CMakeToolsWorkspaceConfiguration(this.originalValues);
  readonly originalFunction: any = vscode.workspace.getConfiguration;

  constructor(sandbox: sinon.SinonSandbox) {
    sandbox.stub(vscode.workspace, 'getConfiguration')
        .callsFake(((section?: string, resource?: vscode.Uri) => this.getConfiguration(section, resource)));
  }

  public changeSetting(key: string, element: any): Thenable<void> { return this.fakeValues.update(key, element); }

  public getConfiguration(section?: string, resource?: vscode.Uri): vscode.WorkspaceConfiguration {
    if (section == 'cmake') {
      return this.fakeValues;
    } else {
      return this.originalFunction(section, resource);
    }
  }

  public restore() { this.fakeValues.clear(); }
}