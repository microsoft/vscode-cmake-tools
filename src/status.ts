import * as vscode from 'vscode';
import {BasicTestResults} from './ctest';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

interface Hideable {
  show(): void;
  hide(): void;
}

function setVisible(i: Hideable, v: boolean) {
  if (v) {
    i.show();
  } else {
    i.hide();
  }
}

export class StatusBar implements vscode.Disposable {
  private readonly _activeFolderButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.6);
  private readonly _cmakeToolsStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.5);
  private readonly _kitSelectionButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.45);
  private readonly _buildButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.4);
  private readonly _targetButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.3);
  private readonly _debugButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.25);
  private readonly _launchTargetNameButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.2);
  private readonly _testButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.1);
  private readonly _warningMessage = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3);

  dispose() {
    const items = [
      this._activeFolderButton,
      this._cmakeToolsStatusItem,
      this._kitSelectionButton,
      this._buildButton,
      this._targetButton,
      this._launchTargetNameButton,
      this._testButton,
      this._warningMessage,
    ];
    for (const item of items) {
      item.dispose();
    }
  }

  constructor() {
    this._activeFolderButton.command = 'cmake.selectActiveFolder';
    this._activeFolderButton.tooltip = localize('set.active.folder.tooltip', 'Click to set the active folder');
    this._activeFolderButton.text = this._activeFolder;
    this._cmakeToolsStatusItem.command = 'cmake.setVariant';
    this._cmakeToolsStatusItem.tooltip = localize('click.to.select.variant.tooltip', 'Click to select the current build variant');
    this._buildButton.command = 'cmake.build';
    this._kitSelectionButton.command = 'cmake.selectKit';
    this._kitSelectionButton.tooltip = localize('click.to.change.kit.tooltip', 'Click to change the active kit');
    this._targetButton.command = 'cmake.setDefaultTarget';
    this._targetButton.tooltip = localize('set.active.target.tooltip', 'Set the active target to build');
    this._testButton.command = 'cmake.ctest';
    this._testButton.tooltip = localize('run.ctest.tests.tooltip', 'Run CTest tests');
    this._debugButton.tooltip = localize('launch.debugger.tooltip', 'Launch the debugger for the selected target');
    this._debugButton.command = 'cmake.debugTarget';
    this._launchTargetNameButton.command = 'cmake.selectLaunchTarget';
    this._launchTargetNameButton.tooltip = localize('select.target.tooltip', 'Select the target to launch');
    this._reloadBuildButton();
    this.reloadVisibility();
  }

  reloadVisibility() {
    setVisible(this._activeFolderButton, this._visible && !!this._activeFolderButton.text);
    const autovis_items = [
      this._cmakeToolsStatusItem,
      this._buildButton,
      this._kitSelectionButton,
      this._targetButton,
      this._debugButton,
      this._launchTargetNameButton,
    ];
    for (const item of autovis_items) {
      setVisible(item, this._visible && !!item.text);
    }
    setVisible(this._debugButton,
               this._visible && vscode.extensions.getExtension('ms-vscode.cpptools') !== undefined
                   && !!this._debugButton.text);
  }

  /**
   * Whether the status bar items are visible
   */
  setVisible(v: boolean) {
    this._visible = v;
    this.reloadVisibility();
  }
  private _visible: boolean = true;

  private _reloadStatusButton() {
    this._cmakeToolsStatusItem.text = `CMake: ${this._buildTypeLabel}: ${this._statusMessage}`;
    this.reloadVisibility();
  }

  private _reloadDebugButton() {
    if (!this._launchTargetNameButton.text) {
      this._debugButton.text = '$(bug)';
      this._launchTargetNameButton.hide();
    } else {
      this._debugButton.text = '$(bug) Debug';
      if (this._visible) {
        this._launchTargetNameButton.show();
      }
    }
    this.reloadVisibility();
  }

  private _reloadActiveFolderButton() {
    this._activeFolderButton.text = this._activeFolder;
    this.reloadVisibility();
  }

  /**
   * The active folder relative to the root folder
   */
  private _activeFolder: string = '';
  setActiveFolderName(v: string) {
    this._activeFolder = v;
    this._reloadActiveFolderButton();
  }

  /**
   * The build type label. Determined by the active build variant
   */
  private _buildTypeLabel: string = 'Unconfigured';
  setBuildTypeLabel(v: string) {
    this._buildTypeLabel = v;
    this._reloadStatusButton();
  }

  /**
   * The message shown in the primary status button. Tells the user what the
   * extension is currently up to.
   */
  private _statusMessage: string = localize('loading.status', 'Loading...');
  setStatusMessage(v: string) {
    this._statusMessage = v;
    this._reloadStatusButton();
  }

  /**
   * The name of the currently active target to build
   */
  private _targetName: string = '';
  public get targetName(): string { return this._targetName; }
  public set targetName(v: string) {
    this._targetName = v;
    this._targetButton.text = `[${v}]`;
    this.reloadVisibility();
  }

  setLaunchTargetName(v: string) {
    this._launchTargetNameButton.text = v;
    this._reloadDebugButton();
  }

  private _ctestEnabled: boolean = false;
  public get ctestEnabled(): boolean { return this._ctestEnabled; }
  public set ctestEnabled(v: boolean) {
    this._ctestEnabled = v;
    setVisible(this._testButton, v);
  }


  private _testResults: BasicTestResults|null = null;
  public get testResults(): BasicTestResults|null { return this._testResults; }
  public set testResults(v: BasicTestResults|null) {
    this._testResults = v;

    if (!v) {
      this._testButton.text = localize('run.ctest', 'Run CTest');
      this._testButton.color = '';
      return;
    }

    const passing = v.passing;
    const total = v.total;
    const good = passing == total;
    const icon = good ? 'check' : 'x';
    let testPassingTest: string;
    if (total == 1) {
      testPassingTest = localize('test.passing', '{0}/{1} test passing', passing, total);
    } else {
      testPassingTest = localize('tests.passing', '{0}/{1} tests passing', passing, total);
    }
    this._testButton.text = `$(${icon}) ${testPassingTest}', passing, total)}`;
    this._testButton.color = good ? 'lightgreen' : 'yellow';
  }

  /** Reloads the content of the build button */
  private _reloadBuildButton() {
    this._buildButton.text = ``;
    this._buildButton.text = this._isBusy ? `$(x) ${localize('stop', 'Stop')}` : `$(gear) ${localize('build', 'Build')}:`;
    this._buildButton.command = this._isBusy ? 'cmake.stop' : 'cmake.build';
    if (this._isBusy) {
      this._buildButton.show();
    }
  }

  /**
   * Whether or not to show a 'Build' or 'Stop' button. Changes the content
   * of the button and the command that is executed when the button is pressed
   */
  private _isBusy: boolean = false;
  setIsBusy(v: boolean) {
    this._isBusy = v;
    this._reloadBuildButton();
  }

  private _reloadKitsButton() {
    if (this._visible) {
      if (this._activeKitName.length) {
        this._kitSelectionButton.text = this._activeKitName;
      } else {
        this._kitSelectionButton.text = localize('no.kit.selected', 'No Kit Selected');
      }
      this.reloadVisibility();
    } else {
      this._kitSelectionButton.hide();
    }
  }

  setActiveKitName(v: string) {
    if (v === '__unspec__') {
      this._activeKitName = `[${localize('no.active.kit', 'No active kit')}]`;
    } else {
      this._activeKitName = v;
    }
    this._reloadKitsButton();
  }
  private _activeKitName: string = '';

  showWarningMessage(msg: string) {
    this._warningMessage.color = 'yellow';
    this._warningMessage.text = `$(alert) ${msg}`;
    this._warningMessage.show();
    setTimeout(() => this._warningMessage.hide(), 5000);
  }
}