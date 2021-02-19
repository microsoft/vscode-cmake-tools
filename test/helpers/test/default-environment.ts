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

  public constructor(readonly projectRoot: string,
                     readonly buildLocation: string,
                     readonly executableResult: string,
                     private readonly _defaultKitLabelIn?: RegExp,
                     readonly excludeKitLabel?: RegExp) {
    this.setupShowQuickPickerStub([this.kitSelection]);

    const errorQueue = this.errorMessagesQueue;
    const fakeShowErrorMessage = <T>(message: string, _options: vscode.MessageOptions, ..._items: T[]): Thenable<T | undefined> => {
      errorQueue.push(message);
      return Promise.resolve(undefined);
    };
    this.sandbox.stub(vscode.window, 'showErrorMessage').callsFake(fakeShowErrorMessage);
    const fakeShowInformationMessage = <T>(_message: string, _options: vscode.MessageOptions, ..._items: T[]): Thenable<T | undefined> => {
      return Promise.resolve(undefined);
    };
    this.sandbox.stub(vscode.window, 'showInformationMessage').callsFake(fakeShowInformationMessage);
    if (process.env.CMAKE_EXECUTABLE) {
      this.config.updatePartial( {cmakePath: process.env.CMAKE_EXECUTABLE});
    }
  }

  readonly sandbox = sinon.createSandbox();
  readonly projectFolder = new ProjectRootHelper(this.projectRoot, this.buildLocation);
  readonly result: TestProgramResult
      = new TestProgramResult(this.projectFolder.buildDirectory.location, this.executableResult);
  readonly defaultKitLabel
      = this._defaultKitLabelIn ? this._defaultKitLabelIn : (process.platform === 'win32' ? /^Visual/ : /\s\S/);
  readonly vsContext: FakeContextDefinition = new FakeContextDefinition();
  private _config = ConfigurationReader.create(vscode.workspace.workspaceFolders![0]);
  public get config() { return this._config; }
  private _wsContext = new DirectoryContext(vscode.workspace.workspaceFolders![0], this.config, new StateManager(this.vsContext, vscode.workspace.workspaceFolders![0]));
  public get wsContext() { return this._wsContext; }

  readonly errorMessagesQueue: string[] = [];
  readonly vs_debug_start_debugging: sinon.SinonStub = this.sandbox.stub(vscode.debug, 'startDebugging');
  readonly kitSelection = new SelectKitPickerHandle(this.defaultKitLabel, this.excludeKitLabel);

  private setupShowQuickPickerStub(selections: QuickPickerHandleStrategy[]) {
    const fakeShowQuickPick = <T>(items: T[] | Thenable<T[]>, options?: vscode.QuickPickOptions, _token?: vscode.CancellationToken): Thenable<T | undefined> => {
      if (options?.placeHolder == selections[0].identifier) {
        return Promise.resolve(selections[0].handleQuickPick(items));
      }
      return Promise.reject(`Unknown quick pick "${options?.placeHolder}"`);
    };
    this.sandbox.stub(vscode.window, 'showQuickPick').callsFake(fakeShowQuickPick);
  }

  public teardown(): void { this.sandbox.verifyAndRestore(); }

  public clean(): void {
    this.errorMessagesQueue.length = 0;
    this.vsContext.clean();
    this._config = ConfigurationReader.create(vscode.workspace.workspaceFolders![0]);
    this._wsContext = new DirectoryContext(vscode.workspace.workspaceFolders![0], this._config, new StateManager(this.vsContext, vscode.workspace.workspaceFolders![0]));
  }
}
