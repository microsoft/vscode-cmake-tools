import * as sinon from 'sinon';
import * as vscode from 'vscode';

import {ProjectRootHelper} from '../cmake/project-root-helper';
import {TestProgramResult} from '../testprogram/test-program-result';
import {FakeContextDefinition} from '../vscodefake/extensioncontext';
import {QuickPickerHandleStrategy, SelectKitPickerHandle, SelectProjectTypePickerHandle} from '../vscodefake/quick-picker';
import {CMakeToolsSettingFile} from '../vscodefake/workspace-configuration';
import { QuickStartProjectNameInputBox, InputBoxPromt } from '@test/helpers/vscodefake/input-box';

export class DefaultEnvironment {
  sandbox: sinon.SinonSandbox = sinon.sandbox.create();
  projectFolder: ProjectRootHelper;
  kitSelection: SelectKitPickerHandle;
  quickStartProjectTypeSelection: SelectProjectTypePickerHandle = new SelectProjectTypePickerHandle();
  quickStartProjectNameInput: QuickStartProjectNameInputBox = new QuickStartProjectNameInputBox();

  result: TestProgramResult;
  public vsContext: FakeContextDefinition = new FakeContextDefinition();
  setting: CMakeToolsSettingFile;
  errorMessagesQueue: string[] = [];

  public constructor(projectRoot: string,
                     buildLocation: string,
                     executableResult: string,
                     defaultKitLabel?: string,
                     excludeKitLabel?: string) {
    this.projectFolder = new ProjectRootHelper(projectRoot, buildLocation);
    this.result = new TestProgramResult(this.projectFolder.buildDirectory.location, executableResult);

    if (!defaultKitLabel) {
      defaultKitLabel = process.platform === 'win32' ? 'Visual' : '';
    }

    this.kitSelection = new SelectKitPickerHandle(defaultKitLabel, excludeKitLabel);
    this.setupShowQuickPickerStub([this.kitSelection, this.quickStartProjectTypeSelection]);
    this.setupShowInputBoxStub([this.quickStartProjectNameInput]);

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
      for( const selector of selections) {
        if (options.placeHolder == selector.identifier) {
          return Promise.resolve(selector.handleQuickPick(items));
        }
      }

      return Promise.reject(`Unknown quick pick "${options.placeHolder}"`);
    });
  }

  private setupShowInputBoxStub(selections: InputBoxPromt[]) {
    this.sandbox.stub(vscode.window, 'showInputBox').callsFake((options: vscode.InputBoxOptions): Thenable<string | undefined> => {
      for( const selector of selections) {
        if (options.prompt == selector.identifier) {
          return Promise.resolve(selector.provideResponse());
        }
      }

      return Promise.reject(`Unknown input box prompt: "${options.prompt}"`);
    });
  }


  public teardown(): void { this.sandbox.verifyAndRestore(); }

  public clean(): void {
    this.errorMessagesQueue.length = 0;
    this.vsContext.clean();
    this.setting.restore();
  }
}
