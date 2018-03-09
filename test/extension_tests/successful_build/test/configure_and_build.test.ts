import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);

import {expect} from 'chai';
import sinon = require('sinon');
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as rimraf from 'rimraf';

import {clearExistingKitConfigurationFile} from '../../../test_helpers';
import {CMakeTools} from '../../../../src/cmake-tools';
import {normalizePath} from '../../../../src/util';

import config from '../../../../src/config';
import { WorkspaceConfiguration } from 'vscode';

class ProjectRootHelper {
  private readonly locationOfThisClassFile: string = __dirname;
  private readonly buildFolder : BuildDirectoryHelper;
  constructor(buildDir : string = 'build') {
    this.buildFolder = new BuildDirectoryHelper(path.join(this.getProjectRootDirectory(), buildDir));
  }

  private getProjectRootDirectory(): string {
    return path.normalize(
        path.join(this.locationOfThisClassFile, '../../../../../test/extension_tests/successful_build/project_folder'));
  }

  public get BuildDirectory() : BuildDirectoryHelper  { return this.buildFolder; }

  public get Location(): string { return this.getProjectRootDirectory(); }
}

class BuildDirectoryHelper {

  private readonly location: string;

  public constructor(location : string) {
    this.location = location;
  }

  public Clear() {
    if (fs.existsSync(this.location)) {
      return rimraf.sync(this.location);
    }
  }

  public get Location(): string { return this.location; }

  public get IsCMakeCachePresent(): boolean { return fs.existsSync(path.join(this.Location, 'CMakeCache.txt')); }
}

class TestProgramResult {

  private readonly result_file_location: string;

  public constructor(location: string, filename: string = 'output.txt') {
    this.result_file_location = normalizePath(path.join(location, filename));
  }

  public get IsPresent(): boolean { return fs.existsSync(this.result_file_location); }

  public async GetResultAsJson(): Promise<any> {
    expect(await this.IsPresent).to.eq(true, 'Test programm result file was not found');
    const content = fs.readFileSync(this.result_file_location);
    expect(content.toLocaleString()).to.not.eq('');

    return JSON.parse(content.toString());
  }
}

export interface KitPickerHandle {
  Identifier: string;

  handleQuickPick(items: any): any;
}

class SelectKitPickerHandle implements KitPickerHandle {

  constructor(readonly defaultKitLabelRegEx: string) {}

  public get Identifier(): string { return 'Select a Kit'; }

  public handleQuickPick(items: any): any {
    const defaultKit: string[] = items.filter((item: any) => {
      const name: string = item.label;
      if (name) {
        if (new RegExp(this.defaultKitLabelRegEx).test(name)) {
          return item;
        }
      } else {
        return;
      }
    });
    if (defaultKit && defaultKit.length != 0) {
      return Promise.resolve(defaultKit[0]);
    } else {
      expect.fail('Unable to find compatible kit');
    }
  }
}

class TestMemento implements vscode.Memento {

  public get<T>(key: string): T|undefined;
  public get<T>(key: string, defaultValue: T): T;
  public get(key: any, defaultValue?: any) {
    if (this.ContainsKey(key)) {
      return this.storage[key];
    } else {
      return defaultValue;
    }
  }
  public update(key: string, value: any): Thenable<void> { return this.storage[key] = value; }
  private readonly storage: {[key: string]: any} = {};

  public ContainsKey(key: string): boolean { return this.storage.hasOwnProperty(key); }
}

class FakeContextDefinition implements vscode.ExtensionContext {

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

class CMakeToolsWorkspaceConfiguration implements vscode.WorkspaceConfiguration {

  readonly [key: string]: any;
  get<T>(section: string): T | undefined;
  get<T>(section: string, defaultValue: T): T;
  get(section: any, defaultValue?: any) : any {
    if( this.values.hasOwnProperty(section)) {
      return this.values[section];
    } else {
      if(this.original.has(section)) {
        return this.original[section];
      } else {
        return defaultValue;
      }
    }
  }
  has(section: string): boolean {
    const fakeHasSection :boolean = this.values.has(section);
    const origHasSection :boolean = this.original.has(section);
    return fakeHasSection || origHasSection;
  }
  inspect<T>(): { key: string; defaultValue?: T | undefined; globalValue?: T | undefined; workspaceValue?: T | undefined; workspaceFolderValue?: T | undefined; } | undefined {
    throw new Error("Method not implemented.");
  }
  update(section: string, value: any): Thenable<void> {
    this.values[section] = value;
    return Promise.resolve();
  }


  private values : { [section: string] : any; } = {};
  protected original: vscode.WorkspaceConfiguration;

  public clear() {
    this.values = {};
  }

  constructor( original: vscode.WorkspaceConfiguration) {
    this.original = original;
  }
}

class CMakeToolsSettingFile {

  readonly originalValues: vscode.WorkspaceConfiguration;
  readonly filepath : string;
  private fakeValues : CMakeToolsWorkspaceConfiguration;
  private originalFunction : any;

  constructor(sandbox : sinon.SinonSandbox) {
    this.originalValues = vscode.workspace.getConfiguration('cmake');
    this.originalFunction = vscode.workspace.getConfiguration;
    this.fakeValues = new CMakeToolsWorkspaceConfiguration(this.originalValues);
    sandbox.stub(vscode.workspace, 'getConfiguration').callsFake(((section?: string, resource?: vscode.Uri) => {
      return this.getConfiguration(section,resource);
    }));
  }

  public changeSetting( key: string, element : any) : Thenable<void> {
    return this.fakeValues.update(key, element);
  }

  public getConfiguration(section?: string, resource?: vscode.Uri) : WorkspaceConfiguration {
    if( section == 'cmake') {
      return this.fakeValues;
    } else {
      return this.originalFunction(section, resource);
    }
  }

  public restore() {
    this.fakeValues.clear();
  }
}

class DefaultEnvironment {

  sandbox: sinon.SinonSandbox;
  projectFolder: ProjectRootHelper;
  kitSelection: SelectKitPickerHandle;
  result: TestProgramResult;
  public vsContext: FakeContextDefinition = new FakeContextDefinition();
  setting : CMakeToolsSettingFile;


  public constructor(build_location: string = 'build',
                     executableResult: string = 'output.txt',
                     defaultkitRegExp = '^VisualStudio') {
    this.projectFolder = new ProjectRootHelper(build_location);
    this.result = new TestProgramResult(this.projectFolder.BuildDirectory.Location, executableResult);
    this.kitSelection = new SelectKitPickerHandle(defaultkitRegExp);


    // clean build folder
    this.sandbox = sinon.sandbox.create();

    this.SetupShowQuickPickerStub([this.kitSelection]);
    this.setting = new CMakeToolsSettingFile(this.sandbox);
    this.sandbox.stub(vscode.window, 'showInformationMessage').callsFake(() => ({doOpen: false}));

  }



  private SetupShowQuickPickerStub(selections: KitPickerHandle[]) {
    this.sandbox.stub(vscode.window, 'showQuickPick').callsFake((items, options): Thenable<string|undefined> => {
      if (options.placeHolder == selections[0].Identifier) {
        return Promise.resolve(selections[0].handleQuickPick(items));
      }
      return Promise.reject(`Unknown quick pick "${options.placeHolder}"`);
    });
  }

  public teardown(): void {
    this.setting.restore();
    this.sandbox.restore();
  }
}

suite('Build', async() => {
  let cmt: CMakeTools;
  let testEnv: DefaultEnvironment;

  setup(async function(this: Mocha.IBeforeAndAfterContext) {
    if (process.env.HasVs != 'true') {
      this.skip();
    }
    this.timeout(100000);

    testEnv = new DefaultEnvironment();
    cmt = await CMakeTools.create(testEnv.vsContext);

    // This test will use all on the same kit.
    // No rescan of the tools is needed
    // No new kit selection is needed
    await clearExistingKitConfigurationFile();
    await cmt.scanForKits();
    await cmt.selectKit();

    await testEnv.projectFolder.BuildDirectory.Clear();
  });

  teardown(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(30000);
    await cmt.asyncDispose();
    testEnv.teardown();
  });

  test('Configure ', async() => {
    expect(await cmt.configure()).to.be.eq(0);

    expect(await testEnv.projectFolder.BuildDirectory.IsCMakeCachePresent).to.eql(true,'no expected cache presetruent');
  }).timeout(60000);

  test('Build', async() => {
    expect(await cmt.build()).to.be.eq(0);

    const result = await testEnv.result.GetResultAsJson();
    expect(result['compiler']).to.eq('Microsoft Visual Studio');
  }).timeout(60000);


  test('Configure and Build', async() => {
    expect(await cmt.configure()).to.be.eq(0);
    expect(await cmt.build()).to.be.eq(0);

    const result = await testEnv.result.GetResultAsJson();
    expect(result['compiler']).to.eq('Microsoft Visual Studio');
  }).timeout(60000);

  test('Configure and Build', async() => {
    expect(await cmt.configure()).to.be.eq(0);
    expect(await cmt.build()).to.be.eq(0);

    const result = await testEnv.result.GetResultAsJson();
    expect(result['compiler']).to.eq('Microsoft Visual Studio');
  }).timeout(60000);

  test('Test setting watcher', async() => {

    expect(config.buildDirectory).to.be.eq('${workspaceRoot}/build');
    await testEnv.setting.changeSetting('buildDirectory', 'Hallo');
    expect(config.buildDirectory).to.be.eq('Hallo');
    testEnv.setting.restore();
    expect(config.buildDirectory).to.be.eq('${workspaceRoot}/build');

  });
});


