import * as vscode from 'vscode';
import {BasicTestResults} from '@cmt/ctest';
import * as nls from 'vscode-nls';
import {SpecialKits} from '@cmt/kit';
import {StatusBarButtonVisibility as ButtonVisibility, ConfigurationReader } from '@cmt/config';

// FIXME: Show workspace selection if a folder is added to workspace

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

abstract class Button {
  constructor(protected readonly _config: ConfigurationReader, protected readonly priority: number) {
    this._button.command = this._button.command;
  }
  protected readonly _button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, this.priority);
  private _forceHidden:boolean = false;
  private _text: string = '';
  private _tooltip: string|null = null;
  private _icon: string|null = null;
  readonly settingsName : string|null = null;

  set icon(v:string|null) {
    this._icon = v?`$(${v})`: null;
  }

  set command(v:string|null) {
    this._button.command = v || undefined;
  }

  set forceHidden(v:boolean) {
    this._forceHidden = v;
    this.update();
  }

  get tooltip():string|null { return this._tooltip; }
  set tooltip(v:string|null) {
    this._tooltip = v;
    this.update();
  }

  get text():string { return this._text; }
  set text(v:string) {
    this._text = v;
    this.update();
  }

  dispose():void {
    this._button.dispose();
  }
  update():void {
    const visible = this._isVisible();
    if (!visible || this._forceHidden) {
      this._button.hide();
      return;
    }
    const text = this.getText(true);
    if (text==='') {
      this._button.hide();
      return;
    }
    this._button.text = text;
    this._button.tooltip = this.getTooltip() || undefined;
    this._button.show();
  }

  private _isVisible():boolean {
    return this.isVisible() && this._getVisibility() !== "hidden";
  }

  protected isVisible():boolean {
    return true;
  }
  private _getVisibility():ButtonVisibility | null {
    if (this.settingsName) {
      return Object(this._config.statusbar.advanced)[this.settingsName]?.visibility || this._config.statusbar.visibility || null;
    }
    return this._config.statusbar.visibility || null;
  }

  getTooltip():string|null {
    const visibility = this._getVisibility();
    switch (visibility) {
      case "hidden":
        return null;
      case "icon":
        return this.getTooltipIcon();
      case "compact":
        return this.getTooltipShort();
      default:
        return this.getTooltipNormal();
    }
  }
  getText(icon:boolean=false):string {
    const type = this._getVisibility();
    let text:string;
    switch (type) {
      case "icon":
        text = this.getTextIcon();
        break;
      case "compact":
        text = this.getTextShort();
        break;
      default:
        text = this.getTextNormal();
        break;
    }
    if (!icon) {
      return text;
    }
    if (!this._icon) {
      return text;
    }
    if (text=='') {
      return this._icon || '';
    }
    return `${this._icon} ${text}`;
  }

  protected getTooltipNormal():string|null {
    return this._tooltip;
  }
  protected getTooltipShort():string|null {
    const tooltip = this.getTooltipNormal();
    const text = this.getTextNormal();
    if (!tooltip && !text) {
      return null;
    }
    if (!tooltip || !text) {
      return `CMake: ${tooltip||text}`;
    }
    return `CMake: ${tooltip}\n${text}`;
  }
  protected getTooltipIcon():string|null {
    return this.getTooltipShort();
  }

  protected getTextNormal():string {
    return this._text;
  }
  protected getTextShort():string {
    return this.getTextNormal();
  }
  protected getTextIcon():string {
    return '';
  }
}

//---------------------------------------------
//---------------- Helper Class ---------------
//---------------------------------------------

class TargetTooltipButton extends Button {
  private _target: string|null = null;
  set target(v: string|null) {
    this._target = v?`[${v}]`:null;
    this.update();
  }
  getTooltipNormal() {
    if (this.tooltip && this._target) {
      return `${this.tooltip}\n${this._target}`;
    }
    return this._target || this.tooltip || null;
  }
}

//---------------------------------------------
//---------------- Button Class ---------------
//---------------------------------------------
class ActiveFolderButton extends Button {
  private static readonly _autoSelectToolTip = localize('active.folder.auto.select.tooltip', 'Active folder');
  private static readonly _toolTip = localize('active.folder.tooltip', 'Select Active folder');

  settingsName = 'workspace';
  command = "cmake.selectActiveFolder";
  icon = 'folder-active';

  private _autoSelect: boolean = false;
  set autoSelect(v:boolean) {
    this._autoSelect = v;
    this.update();
  }

  protected getTooltipNormal():string|null {
    if (this._autoSelect) {
      return ActiveFolderButton._autoSelectToolTip;
    }
    return ActiveFolderButton._toolTip;
  }
  protected isVisible():boolean {
    return Boolean(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1 && !!this.getText());
  }
}

class CMakeStatus extends Button {
  settingsName = 'status';
  command = "cmake.setVariant";
  tooltip = localize('click.to.select.variant.tooltip', 'Click to select the current build variant');

  private _buildTypeLabel: string = localize('unconfigured', 'Unconfigured');
  private _statusMessage: string = localize('loading.status', 'Loading...');
  set buildTypeLabel(v: string) {
    this._buildTypeLabel = v;
    this.update();
  }
  set statusMessage(v: string) {
    this._statusMessage = v;
    this.update();
  }
  protected getTextNormal() {
    return `CMake: ${this._buildTypeLabel}: ${this._statusMessage}`;
  }
  protected getTextShort() {
    return `${this._buildTypeLabel}: ${this._statusMessage}`;
  }
}

class KitSelection extends Button {
  private static readonly _noActiveKit = localize('no.active.kit', 'No active kit');
  private static readonly _noKitSelected = localize('no.kit.selected', 'No Kit Selected');

  settingsName = 'kit';
  command = 'cmake.selectKit';
  icon = 'tools';
  tooltip = localize('click.to.change.kit.tooltip', 'Click to change the active kit');

  protected getTextNormal():string {
    const text = this.text;
    if (text === SpecialKits.Unspecified) {
      return KitSelection._noActiveKit;
    }
    if (text.length === 0) {
      return KitSelection._noKitSelected;
    }
    return text;
  }

  protected getTextShort() {
    let len = this._config.statusbar.advanced?.kit?.length || 0;
    if (!Number.isInteger(len) || len <= 0) {
      len = 20;
    }
    let text = this.getTextNormal();
    if (len + 3 < text.length) {
      text = `${text.substr(0, len)}...`;
    }
    return text;
  }
}

class BuildTargetSelectionButton extends Button {
  settingsName = 'buildTarget';
  command = 'cmake.setDefaultTarget';
  tooltip = localize('set.active.target.tooltip', 'Set the active target to build');

  protected getTextNormal():string {
    return `[${this.text}]`;
  }
}
class LaunchTargetSelectionButton extends Button {
  settingsName = 'launchTarget';
  command = 'cmake.selectLaunchTarget';
  tooltip = localize('select.target.tooltip', 'Select the target to launch');

  protected getTextNormal():string {
    return `[${this.text}]`;
  }
}
class DebugButton extends TargetTooltipButton {
  settingsName = 'debug';
  command = 'cmake.debugTarget';
  icon = 'bug';
  tooltip = localize('launch.debugger.tooltip', 'Launch the debugger for the selected target');

  private _hidden: boolean = false;
  set hidden(v:boolean) {
    this._hidden = v;
    this.update();
  }

  isVisible() {
    return !this._hidden && vscode.extensions.getExtension('ms-vscode.cpptools') !== undefined;
  }
}
class LaunchButton extends TargetTooltipButton {
  settingsName = 'launch';
  command = 'cmake.launchTarget';
  icon = 'play';
  tooltip = localize('launch.tooltip', 'Launch the selected target in the terminal window');

  private _hidden: boolean = false;
  set hidden(v:boolean) {
    this._hidden = v;
    this.update();
  }

  isVisible() {
    return super.isVisible() && !this._hidden;
  }
}

class CTestButton extends Button {
  settingsName = 'ctest';
  command = 'cmake.ctest';
  tooltip = localize('run.ctest.tests.tooltip', 'Run CTest tests');

  private _enabled:boolean = false;
  private _results: BasicTestResults|null = null;
  private _color: string = '';

  set enabled(v:boolean) {
    this._enabled = v;
    this.update();
  }
  set results(v:BasicTestResults|null) {
    this._results = v;
    if (!v) {
      this._color = '';
    } else {
      this._color = v.passing===v.total?'lightgreen' : 'yellow';
    }
    this.update();
  }

  private _isUseColor():boolean {
    return this._config.statusbar.advanced?.ctest?.color===true;
  }

  update() {
    if (this._results) {
      const {passing, total} = this._results;
      this.icon = passing == total? 'check' : 'x';
    } else {
      this.icon = 'beaker';
    }
    super.update();
    if (this._isUseColor()) {
      this._button.color = this._color;
    } else {
      this._button.color = '';
    }
  }
  isVisible() {
    return this._enabled;
  }

  protected getTextNormal():string {
    if (!this._results) {
      this._button.color = '';
      return localize('run.ctest', 'Run CTest');
    }
    const {passing, total} = this._results;
    if (total == 1) {
      return localize('test.passing', '{0}/{1} test passing', passing, total);
    }
    return localize('tests.passing', '{0}/{1} tests passing', passing, total);
  }
}
class BuildButton extends TargetTooltipButton {
  private static readonly _build = localize('build', 'Build');
  private static readonly _stop = localize('stop', 'Stop');

  settingsName = 'build';
  command = 'cmake.build';
  tooltip = localize('build.tooltip', 'Build the selected target');

  private _isBusy:boolean = false;
  set isBusy(v: boolean) {
    this._isBusy = v;
    this._button.command = v ? 'cmake.stop' : 'cmake.build';
    this.text = this._isBusy? BuildButton._stop:BuildButton._build;
    // update implicitly called in set text.
    // this.update();
  }

  update():void {
    this.icon = this._isBusy?'x':'gear';
    super.update();
  }
  isVisible():boolean {
    return this._isBusy || true;
  }
}

export class StatusBar implements vscode.Disposable {
  private readonly _activeFolderButton = new ActiveFolderButton(this._config, 3.6);

  private readonly _cmakeToolsStatusItem = new CMakeStatus(this._config, 3.5);
  private readonly _kitSelectionButton = new KitSelection(this._config, 3.4);

  private readonly _buildButton:BuildButton = new BuildButton(this._config, 3.35);
  private readonly _buildTargetNameButton = new BuildTargetSelectionButton(this._config, 3.3);

  private readonly _debugButton:DebugButton = new DebugButton(this._config, 3.22);
  private readonly _launchButton = new LaunchButton(this._config, 3.21);
  private readonly _launchTargetNameButton = new LaunchTargetSelectionButton(this._config, 3.2);

  private readonly _testButton = new CTestButton(this._config, 3.1);

  private readonly _buttons: Button[];

  constructor(private readonly _config: ConfigurationReader) {
    this._buttons = [
      this._activeFolderButton,
      this._cmakeToolsStatusItem,
      this._kitSelectionButton,
      this._buildTargetNameButton,
      this._launchTargetNameButton,
      this._debugButton,
      this._buildButton,
      this._testButton,
      this._launchButton
    ];
    this._config.onChange('statusbar', ()=>this.update());
    this.update();
  }

  dispose = () => this._buttons.forEach(btn => btn.dispose());
  update = () => this._buttons.forEach(btn => btn.update());
  setVisible= (v: boolean) => this._buttons.forEach(btn => btn.forceHidden = !v);

  setActiveFolderName = (v: string) => this._activeFolderButton.text = v;
  setAutoSelectActiveFolder = (autoSelectActiveFolder: boolean) => this._activeFolderButton.autoSelect = autoSelectActiveFolder;
  setBuildTypeLabel = (v: string) => this._cmakeToolsStatusItem.buildTypeLabel = v;
  setStatusMessage = (v: string) => this._cmakeToolsStatusItem.statusMessage = v;
  setBuildTargetName = (v: string) => {
    this._buildTargetNameButton.text = v;
    this._buildButton.target = v;
  }
  setLaunchTargetName = (v: string) => {
    this._launchTargetNameButton.text = v;
    this._launchButton.target = v;
    this._debugButton.target = v;
  }
  setCTestEnabled = (v: boolean) => this._testButton.enabled = v;
  setTestResults = (v: BasicTestResults|null) => this._testButton.results = v;
  setIsBusy = (v:boolean) => this._buildButton.isBusy = v;
  setActiveKitName = (v:string) => this._kitSelectionButton.text = v;

  hideLaunchButton = (shouldHide: boolean = true) => this._launchButton.hidden = shouldHide;
  hideDebugButton = (shouldHide: boolean = true) => this._debugButton.hidden = shouldHide;
}