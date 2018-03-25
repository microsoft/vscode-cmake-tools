import * as sinon from 'sinon';
import * as vscode from 'vscode';

import {ProjectRootHelper} from '../cmake/project-root-helper';
import {TestProgramResult} from '../testprogram/test-program-result';
import {FakeContextDefinition} from '../vscodefake/extensioncontext';
import {QuickPickerHandleStrategy, SelectKitPickerHandle} from '../vscodefake/quick-picker';
import {CMakeToolsSettingFile} from '../vscodefake/workspace-configuration';

export class DefaultEnvironment {
  sandbox: sinon.SinonSandbox = sinon.sandbox.create();
  projectFolder: ProjectRootHelper;
  kitSelection: SelectKitPickerHandle;
  result: TestProgramResult;
  public vsContext: FakeContextDefinition = new FakeContextDefinition();
  setting: CMakeToolsSettingFile;
  errorMessagesQueue: string[] = [];

  public constructor(projectRoot: string, buildLocation: string, executableResult: string, defaultkitRegExp?: string) {
    this.projectFolder = new ProjectRootHelper(projectRoot, buildLocation);
    this.result = new TestProgramResult(this.projectFolder.buildDirectory.location, executableResult);

    if (!defaultkitRegExp) {
      if (process.platform == 'win32') {
        defaultkitRegExp = '^Visual ?Studio';
      } else {
        defaultkitRegExp = '.';
      }
    }
    this.kitSelection = new SelectKitPickerHandle(defaultkitRegExp);
    this.setupShowQuickPickerStub([this.kitSelection]);

    this.setting = new CMakeToolsSettingFile(this.sandbox);

    const errorQueue = this.errorMessagesQueue;
    this.sandbox.stub(vscode.window, 'showErrorMessage').callsFake((message: string): Thenable<string|undefined> => {
      errorQueue.push(message);

      return Promise.resolve(undefined);
    });
    this.sandbox.stub(vscode.window, 'showInformationMessage').callsFake(() => ({doOpen: false}));
  }

  private setupShowQuickPickerStub(selections: QuickPickerHandleStrategy[]) {
    this.sandbox.stub(vscode.window, 'showQuickPick').callsFake((items, options): Thenable<string|undefined> => {
      if (options.placeHolder == selections[0].identifier) {
        return Promise.resolve(selections[0].handleQuickPick(items));
      }
      return Promise.reject(`Unknown quick pick "${options.placeHolder}"`);
    });
  }

  public teardown(): void { this.sandbox.verifyAndRestore(); }

  public clean(): void {
    this.errorMessagesQueue.length = 0;
    this.vsContext.clean();
    this.setting.restore();
  }
}