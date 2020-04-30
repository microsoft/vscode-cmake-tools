import * as vscode from 'vscode';
import {BasicTestResults} from '@cmt/ctest';
import * as nls from 'vscode-nls';
import {SpecialKits} from '@cmt/kit';
import {StatusBarButtonType as ButtonType, ConfigurationReader } from '@cmt/config';

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
  readonly settingsName : string|null = null;

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
    if (visible && !this._forceHidden) {
      this._button.text = this.getText();
      this._button.tooltip = this.getTooltip() || undefined;
      this._button.show();
    } else {
      this._button.hide();
    }
  }

  private _isVisible():boolean {
    return this.isVisible() && this._getType() !== "hidden" && this.getText() != '';
  }

  protected isVisible():boolean {
    return true;
  }
  private _getType():ButtonType | null {
    if (this.settingsName) {
      return Object(this._config.statusbar.advanced)[this.settingsName]?.type || this._config.statusbar.type || null;
    }
    return this._config.statusbar.type || null;
  }

  getTooltip():string|null {
    const type = this._getType();
    switch (type) {
      case "hidden":
        return null;
      case "icon":
        return this.getTooltipIcon();
      case "short":
        return this.getTooltipShort();
      default:
        return this.getTooltipNormal();
    }
  }
  getText():string {
    const type = this._getType();
    switch (type) {
      case "icon":
        return this.getTextIcon();
      case "short":
        return this.getTextShort();
      default:
        return this.getTextNormal();
    }
  }

  protected getTooltipNormal():string|null {
    return this._tooltip;
  }
  protected getTooltipShort():string|null {
    return this.getTooltipNormal();
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
    return this.getTextShort();
  }
}

class ActiveFolderButton extends Button {
  settingsName = 'workspace';
  command = "cmake.selectActiveFolder";

  private static readonly _autoSelectToolTip = localize('active.folder.auto.select.tooltip', 'Active folder');
  private static readonly _toolTip = localize('active.folder.tooltip', 'Select Active folder');
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
  protected getTextIcon():string {
    return '$(folder-active)';
  }
  protected getTooltipIcon():string {
    return `CMake: ${this.getTooltipNormal()}\n${this.getTextNormal()}`;
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
  settingsName = 'kit';
  command = 'cmake.selectKit';
  tooltip = localize('click.to.change.kit.tooltip', 'Click to change the active kit');

  protected getTextNormal():string {
    const text = this.text;
    if (text === SpecialKits.Unspecified) {
      return `[${localize('no.active.kit', 'No active kit')}]`;
    }
    if (text.length === 0) {
      return localize('no.kit.selected', 'No Kit Selected');
    }
    return text;
  }
  protected getTextIcon(): string {
    return `$(tools)`;
  }
  protected getTextShort() {
    const len = this._config.statusbar.advanced?.kit?.length || 20;
    let text = this.getTextNormal();
    if (len + 3 < text.length) {
      text = `${text.substr(0, len)}...`;
    }
    return text;
  }
  protected getTooltipShort(): string {
    return `${this.getTooltipNormal()}\n${this.getTextNormal()}`;
  }
  protected getTooltipIcon(): string {
    return `${this.getTooltipNormal()}\n${this.getTextNormal()}`;
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
}
class CheckCPPToolsButton extends Button {
  protected isVisible() {
    return vscode.extensions.getExtension('ms-vscode.cpptools') !== undefined;
  }
}
class DebugButton extends CheckCPPToolsButton {
  settingsName = 'debug';
  command = 'cmake.debugTarget';
  text = '$(bug)';
  tooltip = localize('launch.debugger.tooltip', 'Launch the debugger for the selected target');
  private _hidden: boolean = false;
  set hidden(v:boolean) {
    this._hidden = v;
    this.update();
  }
  isVisible() {
    return super.isVisible() && !this._hidden;
  }
}
class LaunchButton extends Button {
  settingsName = 'launch';
  command = 'cmake.launchTarget';
  text = '$(play)';
  tooltip = localize('launch.tooltip', 'Launch');
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
  private static readonly _default = localize('run.ctest', 'Run CTest');

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
    return this._config.statusbar.advanced?.ctest?.color===false;
  }

  update() {
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
      return CTestButton._default;
    }
    const {passing, total} = this._results;
    const good = passing == total;
    let testPassingText: string;
    if (total == 1) {
      testPassingText = localize('test.passing', '{0}/{1} test passing', passing, total);
    } else {
      testPassingText = localize('tests.passing', '{0}/{1} tests passing', passing, total);
    }
    const icon = good ? 'check' : 'x';
    return `$(${icon}) ${testPassingText}`;
  }
}
class BuildButton extends Button {
  private static readonly _build = localize('build', 'Build');
  private static readonly _stop = localize('stop', 'Stop');

  settingsName = 'build';
  command = 'cmake.build';

  private _isBusy:boolean = false;

  set isBusy(v: boolean) {
    this._isBusy = v;
    this._button.command = v ? 'cmake.stop' : 'cmake.build';
    this.update();
  }

  private _getCurrentText():string {
    return this._isBusy?BuildButton._stop:BuildButton._build;
  }
  private _getCurrentIcon():string {
    return this._isBusy?'$(x)':'$(gear)';
  }

  getTextIcon():string {
    return this._getCurrentIcon();
  }
  getTextNormal():string {
    return `${this._getCurrentIcon()} ${this._getCurrentText()}`;
  }
  getTooltipIcon():string {
    return this._getCurrentText();
  }
  isVisible():boolean {
    return this._isBusy || true;
  }
}

export class StatusBar implements vscode.Disposable {
  private readonly _kitSelectionButton = new KitSelection(this._config, 3.45); //3.6
  private readonly _cmakeToolsStatusItem = new CMakeStatus(this._config, 3.5); //3.55

  private readonly _activeFolderButton = new ActiveFolderButton(this._config, 3.6); // 3.5
  private readonly _buildTargetNameButton = new BuildTargetSelectionButton(this._config, 3.45); // 3.45
  private readonly _buildButton:BuildButton = new BuildButton(this._config, 3.4); //3.4

  private readonly _launchTargetNameButton = new LaunchTargetSelectionButton(this._config, 3.3); //3.35
  private readonly _debugButton:DebugButton = new DebugButton(this._config, 3.25); //3.3
  private readonly _launchButton = new LaunchButton(this._config, 3.2); //3.25

  private readonly _testButton = new CTestButton(this._config, 3.1); //3.2

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
  setBuildTargetName = (v: string) => this._buildTargetNameButton.text = v;
  setLaunchTargetName = (v: string) => this._launchTargetNameButton.text = v;
  setCTestEnabled = (v: boolean) => this._testButton.enabled = v;
  setTestResults = (v: BasicTestResults|null) => this._testButton.results = v;
  setIsBusy = (v:boolean) => this._buildButton.isBusy = v;
  setActiveKitName = (v:string) => this._kitSelectionButton.text = v;

  hideLaunchButton = (shouldHide: boolean = true) => this._launchButton.hidden = shouldHide;
  hideDebugButton = (shouldHide: boolean = true) => this._debugButton.hidden = shouldHide;
}