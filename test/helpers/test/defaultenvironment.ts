import * as sinon from 'sinon';
import * as vscode from 'vscode';

import {ProjectRootHelper} from '../cmake/projectroothekper';
import {TestProgramResult} from '../testprogram/testprogramresult';
import {FakeContextDefinition} from '../vscodefake/extensioncontext';
import {QuickPickerHandleStrategy, SelectKitPickerHandle} from '../vscodefake/quickpicker';
import {CMakeToolsSettingFile} from '../vscodefake/workspaceconfiguration';

export class DefaultEnvironment {

  sandbox: sinon.SinonSandbox;
  projectFolder: ProjectRootHelper;
  kitSelection: SelectKitPickerHandle;
  result: TestProgramResult;
  public vsContext: FakeContextDefinition = new FakeContextDefinition();
  setting: CMakeToolsSettingFile;


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

  private SetupShowQuickPickerStub(selections: QuickPickerHandleStrategy[]) {
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