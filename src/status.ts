import * as vscode from 'vscode';

import {Maybe} from './util';

export class StatusBar implements vscode.Disposable {
  private readonly _cmakeToolsStatusItem =
      vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.5);
  private readonly _buildButton =
      vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.4);
  private readonly _targetButton =
      vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.3);
  private readonly _debugButton =
      vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.2);
  private readonly _debugTargetButton =
      vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.1);
  private readonly _testStatusButton =
      vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.05);
  private readonly _warningMessage =
      vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3);
  private readonly _environmentSelectionButton =
      vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 200);

  public dispose() {
    for (const item of [
      this._cmakeToolsStatusItem,
      this._buildButton,
      this._targetButton,
      this._debugButton,
      this._debugTargetButton,
      this._testStatusButton,
      this._warningMessage,
      this._environmentSelectionButton,
    ]) {
      item.dispose();
    }
  }

  constructor() {
    this._cmakeToolsStatusItem.command = 'cmake.setBuildType';
    this._cmakeToolsStatusItem.tooltip =
        'Click to select the current build type';
    this._testStatusButton.command = 'cmake.ctest';
    this._testStatusButton.tooltip = 'Click to execute CTest tests';
    this._buildButton.command = 'cmake.build';
    this._targetButton.command = 'cmake.setDefaultTarget';
    this._targetButton.tooltip = 'Click to change the active build target';
    this._debugButton.command = 'cmake.debugTarget';
    this._debugButton.tooltip =
        'Click to launch the debugger for the selected target';
    this._debugTargetButton.command = 'cmake.selectDebugTarget';
    this._debugTargetButton.tooltip = 'Click to select a target for debugging';
    this._environmentSelectionButton.command = 'cmake.selectEnvironments';
    this._environmentSelectionButton.tooltip =
        'Click to change the active build environments';
  }

  private _reloadVisibility() {
    const hide = (i: vscode.StatusBarItem) => i.hide();
    const show = (i: vscode.StatusBarItem) => i.show();
    for (const item
             of [this._cmakeToolsStatusItem, this._buildButton,
                 this._targetButton, this._testStatusButton, this._debugButton,
                 this._debugTargetButton, this._environmentSelectionButton]) {
      this.visible ? show(item) : hide(item);
    }
  }

  /**
   * Whether the status bar items are visible
   */
  private _visible: boolean = true;
  public get visible(): boolean {
    return this._visible;
  }
  public set visible(v: boolean) {
    this._visible = v;
    this._reloadVisibility();
  }

  private _reloadStatusButton() {
    this._cmakeToolsStatusItem.text =
        `CMake: ${this.projectName}: ${this.buildTypeLabel
    }: ${this.statusMessage}`;
  }

  /**
   * The name of the open project
   */
  private _projectName: string = 'Unconfigured Project';
  public get projectName(): string {
    return this._projectName;
  }
  public set projectName(v: string) {
    this._projectName = v;
    this._reloadStatusButton();
  }

  /**
   * The build type label. Determined by the active build variant
   */
  private _buildTypeLabel: string = 'Unconfigured';
  public get buildTypeLabel(): string {
    return this._buildTypeLabel;
  }
  public set buildTypeLabel(v: string) {
    this._buildTypeLabel = v;
    this._reloadStatusButton();
  }

  /**
   * The message shown in the primary status button. Tells the user what the
   * extension is currently up to.
   */
  private _statusMessage: string = 'Loading...';
  public get statusMessage(): string {
    return this._statusMessage;
  }
  public set statusMessage(v: string) {
    this._statusMessage = v;
    this._reloadStatusButton();
  }

  /** Reloads the content of the build button */
  private _reloadBuildButton() {
    this._buildButton.text = ``
    let progress_bar = '';
    const prog = this.progress;
    if (prog !== null) {
      const bars = prog * 0.4 | 0;
      progress_bar =
          ` [${Array(bars).join('█')}${Array(40 - bars).join('░')}] ${prog}%`;
    }
    this._buildButton.text =
        this.isBusy ? `$(x) Stop${progress_bar}` : `$(gear) Build:`;
    this._buildButton.command = this.isBusy ? 'cmake.stop' : 'cmake.build';
  }

  /**
   * Whether or not to show a 'Build' or 'Stop' button. Changes the content
   * of the button and the command that is executed when the button is pressed
   */
  private _isBusy: boolean = false;
  public get isBusy(): boolean {
    return this._isBusy;
  }
  public set isBusy(v: boolean) {
    this._isBusy = v;
    this._reloadBuildButton();
  }

  private _reloadTargetButton() {
    this._targetButton.text = this.targetName;
  }

  private _targetName: string;
  public get targetName(): string {
    return this._targetName;
  }
  public set targetName(v: string) {
    this._targetName = v;
    this._reloadTargetButton();
  }

  /**
   * The progress of the currently executing task. Updates a primitive progress
   * bar.
   */
  private _progress: Maybe<number> = null;
  public get progress(): Maybe<number> {
    return this._progress;
  }
  public set progress(v: Maybe<number>) {
    this._progress = v;
    this._reloadBuildButton();
  }

  private _reloadDebugButton() {
    if (!this.debugTargetName) {
      this._debugButton.text = '$(bug)';
      this._debugTargetButton.hide();
    } else {
      this._debugButton.text = '$(bug) Debug';
      this._debugTargetButton.text = this.debugTargetName;
      if (this.visible) {
        this._debugTargetButton.show();
      }
    }
  }

  /**
   * The name of the target that will be debugged
   */
  private _debugTargetName: string = '';
  public get debugTargetName(): string {
    return this._debugTargetName;
  }
  public set debugTargetName(v: string) {
    this._debugTargetName = v;
    this._reloadDebugButton();
  }

  public _reloadTestButton() {
    if (!this.ctestEnabled) {
      this._testStatusButton.hide();
      return;
    }

    if (this.visible) {
      this._testStatusButton.show();
    }

    if (!this.haveTestResults) {
      this._testStatusButton.text = 'Run CTest';
      this._testStatusButton.color = '';
      return;
    }

    const passing = this.testResults.passing;
    const total = this.testResults.total;
    const good = passing == total;
    const icon = good ? 'check' : 'x';
    this._testStatusButton.text = `$(${icon}) ${passing}/${total} ` +
        (total == 1 ? 'test' : 'tests') + ' passing';
    this._testStatusButton.color = good ? 'lightgreen' : 'yellow';
  }

  private _testResults: {passing: number,
                         total: number} = {passing: 0, total: 0};
  public get testResults(): {passing: number, total: number} {
    return this._testResults;
  }
  public set testResults(v: {passing: number, total: number}) {
    this._testResults = v;
    this._reloadTestButton();
  }

  private _ctestEnabled: boolean = false;
  public get ctestEnabled(): boolean {
    return this._ctestEnabled;
  }
  public set ctestEnabled(v: boolean) {
    this._ctestEnabled = v;
    this._reloadTestButton();
  }

  private _haveTestResults: boolean = false;
  public get haveTestResults(): boolean {
    return this._haveTestResults;
  }
  public set haveTestResults(v: boolean) {
    this._haveTestResults = v;
    this._reloadTestButton();
  }

  private _reloadEnvironmentsButton() {
    if (this.environmentsAvailable) {
      if (this.activeEnvironments.length) {
        this._environmentSelectionButton.text =
            `Working in ${this.activeEnvironments.join(', ')}`;
      } else {
        this._environmentSelectionButton.text = 'Select a build environment...';
      }
    } else {
      this._environmentSelectionButton.hide();
    }
    this._environmentSelectionButton.text
  }

  private _environmentsAvailable: boolean = false;
  public get environmentsAvailable(): boolean {
    return this._environmentsAvailable;
  }
  public set environmentsAvailable(v: boolean) {
    this._environmentsAvailable = v;
    this._reloadEnvironmentsButton();
  }

  private _activeEnvironments: string[] = [];
  public get activeEnvironments(): string[] {
    return this._activeEnvironments;
  }
  public set activeEnvironments(v: string[]) {
    this._activeEnvironments = v;
    this._reloadEnvironmentsButton();
  }

  public showWarningMessage(msg: string) {
    this._warningMessage.color = 'yellow';
    this._warningMessage.text = `$(alert) ${msg}`;
    this._warningMessage.show();
    setTimeout(() => this._warningMessage.hide(), 5000);
  }
}