import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);

import {expect} from 'chai';
import sinon = require('sinon');
import * as vscode from 'vscode';
import * as path from 'path';

import {clearExistingKitConfigurationFile} from '../../../test_helpers';
import {CMakeTools} from '../../../../src/cmake-tools';
import {fs} from '../../../../src/pr';
import {normalizePath} from '../../../../src/util';

class BuildDirectory {

  private readonly location: string;

  private readonly locationOfThisClassFile: string = __dirname;

  private getProjectRootDirectory(): string {
    return path.normalize(
        path.join(this.locationOfThisClassFile, '../../../../../test/extension_tests/successful_build/project_folder'));
  }

  public constructor(relative_location_to_root: string = 'build') {
    this.location = path.join(this.getProjectRootDirectory(), relative_location_to_root);
  }

  public async Clear() {
    if (await fs.exists(this.location)) {
      return fs.rmdir(this.location);
    }
  }

  public get Location(): string { return this.location; }

  public get IsCMakeCachePresent(): Promise<boolean> { return fs.exists(path.join(this.Location, 'CMakeCache.txt')); }
}

class TestProgramResult {

  private readonly result_file_location: string;

  public constructor(location: string, filename: string = 'output.txt') {
    this.result_file_location = normalizePath(path.join(location, filename));
  }

  public get IsPresent(): Promise<boolean> { return fs.exists(this.result_file_location); }

  public async GetResultAsJson(): Promise<any> {
    expect(await this.IsPresent).to.eq(true, 'Test programm result file was not found');
    const content = await fs.readFile(this.result_file_location);
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

class DefaultEnvironment {

  sandbox: sinon.SinonSandbox;
  buildDir: BuildDirectory;
  kitSelection: SelectKitPickerHandle;
  result: TestProgramResult;
  public vsContext: FakeContextDefinition = new FakeContextDefinition();

  public constructor(build_location: string = 'build',
                     executableResult: string = 'output.txt',
                     defaultkitRegExp = '^VisualStudio') {
    this.buildDir = new BuildDirectory(build_location);
    this.result = new TestProgramResult(this.buildDir.Location, executableResult);
    this.kitSelection = new SelectKitPickerHandle(defaultkitRegExp);

    // clean build folder
    this.sandbox = sinon.sandbox.create();

    this.SetupShowQuickPickerStub([this.kitSelection]);
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

  public teardown(): void { this.sandbox.restore(); }
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

    await testEnv.buildDir.Clear();
  });

  teardown(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(30000);
    await cmt.asyncDispose();
    testEnv.teardown();
  });

  test('Configure ', async() => {
    expect(await cmt.configure()).to.be.eq(0);

    expect(await testEnv.buildDir.IsCMakeCachePresent).to.eql(true,'no expected cache presetruent');
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
});
