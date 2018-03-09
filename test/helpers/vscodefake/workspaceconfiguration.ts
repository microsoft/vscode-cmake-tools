import * as vscode from 'vscode';

class CMakeToolsWorkspaceConfiguration implements vscode.WorkspaceConfiguration {

  readonly [key: string]: any;
  get<T>(section: string): T|undefined;
  get<T>(section: string, defaultValue: T): T;
  get(section: any, defaultValue?: any): any {
    if (this.values.hasOwnProperty(section)) {
      return this.values[section];
    } else {
      if (this.original.has(section)) {
        return this.original[section];
      } else {
        return defaultValue;
      }
    }
  }
  has(section: string): boolean {
    const fakeHasSection: boolean = this.values.has(section);
    const origHasSection: boolean = this.original.has(section);
    return fakeHasSection || origHasSection;
  }
  inspect<T>(): {
    key: string; defaultValue?: T | undefined; globalValue?: T | undefined; workspaceValue?: T | undefined;
    workspaceFolderValue?: T | undefined;
  }|undefined {
    throw new Error('Method not implemented.');
  }
  update(section: string, value: any): Thenable<void> {
    this.values[section] = value;
    return Promise.resolve();
  }


  private values: {[section: string]: any;} = {};
  protected original: vscode.WorkspaceConfiguration;

  public clear() { this.values = {}; }

  constructor(original: vscode.WorkspaceConfiguration) { this.original = original; }
}

export class CMakeToolsSettingFile {

  readonly originalValues: vscode.WorkspaceConfiguration;
  readonly filepath: string;
  readonly fakeValues: CMakeToolsWorkspaceConfiguration;
  readonly originalFunction: any;

  constructor(sandbox: sinon.SinonSandbox) {
    this.originalValues = vscode.workspace.getConfiguration('cmake');
    this.originalFunction = vscode.workspace.getConfiguration;
    this.fakeValues = new CMakeToolsWorkspaceConfiguration(this.originalValues);
    sandbox.stub(vscode.workspace, 'getConfiguration').callsFake(((section?: string, resource?: vscode.Uri) => {
      return this.getConfiguration(section, resource);
    }));
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