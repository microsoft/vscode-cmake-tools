import {ConfigurationReader} from '@cmt/config';
import {StateManager} from '@cmt/state';
import {DirectoryContext} from '@cmt/workspace';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

import {ProjectRootHelper} from '../cmake/project-root-helper';
import {TestProgramResult} from '../testprogram/test-program-result';
import {FakeContextDefinition} from '../vscodefake/extensioncontext';
import {QuickPickerHandleStrategy, SelectKitPickerHandle} from '../vscodefake/quick-picker';

export class DefaultEnvironment {
  sandbox: sinon.SinonSandbox = sinon.sandbox.create();
  projectFolder: ProjectRootHelper;
  kitSelection: SelectKitPickerHandle;
  result: TestProgramResult;
  public vsContext: FakeContextDefinition = new FakeContextDefinition();
  public config = ConfigurationReader.createForDirectory(vscode.workspace.rootPath!);
  public wsContext = new DirectoryContext(this.config, new StateManager(this.vsContext));
  errorMessagesQueue: string[] = [];

  public constructor(projectRoot: string,
                     buildLocation: string,
                     executableResult: string,
                     defaultKitLabel?: RegExp,
                     excludeKitLabel?: RegExp) {
    this.projectFolder = new ProjectRootHelper(projectRoot, buildLocation);
    this.result = new TestProgramResult(this.projectFolder.buildDirectory.location, executableResult);

    if (!defaultKitLabel) {
      defaultKitLabel = process.platform === 'win32' ? /^Visual/ : /\s\S/;
    }

    this.kitSelection = new SelectKitPickerHandle(defaultKitLabel, excludeKitLabel);
    this.setupShowQuickPickerStub([this.kitSelection]);

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
  }
}
