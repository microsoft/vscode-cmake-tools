import {ConfigurationReader, StatusBarButtonVisibility as ButtonVisibility} from '@cmt/config';
import {BasicTestResults} from '@cmt/ctest';
import {SpecialKits} from '@cmt/kit';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';

nls.config({messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone})();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

//---------------------------------------------
//-------------- Helper Functions -------------
//---------------------------------------------

function hasCPPTools(): boolean { return vscode.extensions.getExtension('ms-vscode.cpptools') !== undefined; }
//---------------------------------------------
//---------------- Button Class ---------------
//---------------------------------------------

abstract class Button {
  readonly settingsName: string|null = null;
  protected readonly button: vscode.StatusBarItem;
  private _forceHidden: boolean = false;
  private _text: string = '';
  private _tooltip: string|null = null;
  private _icon: string|null = null;

  constructor(protected readonly config: ConfigurationReader, private readonly _priority: number) {
    this.button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, this._priority);
  }

  set forceHidden(v: boolean) {
    this._forceHidden = v;
    this.update();
  }

  get text(): string { return this._text; }
  set text(v: string) {
    this._text = v;
    this.update();
  }

  get bracketText(): string { return `[${this._text}]`; }

  get tooltip(): string|null { return this._tooltip; }
  set tooltip(v: string|null) {
    this._tooltip = v;
    this.update();
  }

  protected set icon(v: string|null) { this._icon = v ? `$(${v})` : null; }

  protected set command(v: string|null) { this.button.command = v || undefined; }

  dispose(): void { this.button.dispose(); }
  update(): void {
    const visible = this._isVisible();
    if (!visible || this._forceHidden) {
      this.button.hide();
      return;
    }
    const text = this._getText(true);
    if (text === '') {
      this.button.hide();
      return;
    }
    this.button.text = text;
    this.button.tooltip = this._getTooltip() || undefined;
    this.button.show();
  }

  protected getTextNormal(): string {
    if (this._text.length > 0) {
      return this.bracketText;
    }
    return '';
  }
  protected getTextShort(): string { return this.getTextNormal(); }
  protected getTextIcon(): string { return ''; }

  protected getTooltipNormal(): string|null { return this._tooltip; }
  protected getTooltipShort(): string|null {
    const tooltip = this.getTooltipNormal();
    const text = this.getTextNormal();
    if (!tooltip && !text) {
      return null;
    }
    if (!tooltip || !text) {
      return this.prependCMake(`${tooltip || text}`);
    }
    return this.prependCMake(`${text}\n${tooltip}`);
  }
  protected getTooltipIcon(): string|null { return this.getTooltipShort(); }

  protected isVisible(): boolean { return true; }
  protected prependCMake(text: string|null): any {
    if (!!text) {
      return `CMake: ${text}`;
    }
    return text;
  }

  private _isVisible(): boolean { return this.isVisible() && this._getVisibility() !== 'hidden'; }
  private _getVisibility(): ButtonVisibility|null {
    if (this.settingsName) {
      const setting = Object(this.config.statusbar.advanced)[this.settingsName]?.visibility;
      return setting || this.config.statusbar.visibility || null;
    }
    return this.config.statusbar.visibility || null;
  }

  private _getTooltip(): string|null {
    const visibility = this._getVisibility();
    switch (visibility) {
    case 'hidden':
      return null;
    case 'icon':
      return this.getTooltipIcon();
    case 'compact':
      return this.getTooltipShort();
    default:
      return this.getTooltipNormal();
    }
  }
  private _getText(icon: boolean = false): string {
    const type = this._getVisibility();
    let text: string;
    switch (type) {
    case 'icon':
      text = this.getTextIcon();
      break;
    case 'compact':
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
    if (text == '') {
      return this._icon || '';
    }
    return `${this._icon} ${text}`;
  }
}

class WorkspaceButton extends Button {
  // private static readonly _autoSelectToolTip = localize('active.folder.auto.select.tooltip', 'Active folder');
  // private static readonly _toolTip = localize('active.folder.tooltip', 'Select Active folder');
  // private static readonly _autoSelectToolTip = localize('active.folder.auto.tooltip', 'auto');

  settingsName = 'workspace';
  command = 'cmake.selectActiveFolder';
  icon = 'folder-active';
  tooltip = localize('click.to.select.workspace.tooltip', 'Click to select the active folder');

  // private _autoSelect: boolean = false;
  set autoSelect(v: boolean) {
    if (v) {}
    // this._autoSelect = v;
    // this.update();
  }

  protected getTooltipNormal(): string|null {
    // if (this._autoSelect) {
    //  return `${this.tooltip} (${WorkspaceButton._autoSelectToolTip})`;
    //}
    return this.tooltip;
  }
  protected getTooltipShort(): string|null { return this.prependCMake(this.getTooltipNormal()); }
  protected getTooltipIcon(): string|null { return super.getTooltipShort(); }

  protected isVisible(): boolean {
    return Boolean(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1);
  }
}

class CMakeStatus extends Button {
  settingsName = 'status';
  command = 'cmake.setVariant';
  icon = 'info';
  text: string = localize('unconfigured', 'Unconfigured');
  tooltip = localize('click.to.select.variant.tooltip', 'Click to select the current build variant');

  private _statusMessage: string = localize('loading.status', 'Loading...');

  set statusMessage(v: string) {
    this._statusMessage = v;
    this.update();
  }

  protected getTextNormal(): string { return this.prependCMake(`${this.bracketText}: ${this._statusMessage}`); }
  protected getTextShort(): string { return this.bracketText; }

  protected getTooltipShort(): string|null {
    return this.prependCMake(`${this.bracketText} - ${this._statusMessage}\n${this.tooltip}`);
  }
}

class KitSelection extends Button {
  private static readonly _noActiveKit = localize('no.active.kit', 'No active kit');
  private static readonly _noKitSelected = localize('no.kit.selected', 'No Kit Selected');

  settingsName = 'kit';
  command = 'cmake.selectKit';
  icon = 'tools';
  tooltip = localize('click.to.change.kit.tooltip', 'Click to change the active kit');

  protected getTextNormal(): string {
    const text = this.text;
    if (text === SpecialKits.Unspecified) {
      return KitSelection._noActiveKit;
    }
    if (text.length === 0) {
      return KitSelection._noKitSelected;
    }
    return this.bracketText;
  }
  protected getTextShort(): string {
    let len = this.config.statusbar.advanced?.kit?.length || 0;
    if (!Number.isInteger(len) || len <= 0) {
      len = 20;
    }
    let text = this.getTextNormal();
    if (len + 3 < text.length) {
      text = `${text.substr(0, len)}...`;
      if (text.startsWith('[')) {
        text = `${text}]`;
      }
    }
    return text;
  }

  protected getTooltipShort(): string|null {
    if (this.getTextNormal() == this.getTextShort()) {
      return this.prependCMake(this.getTooltipNormal());
    }
    return super.getTooltipShort();
  }
}

class BuildTargetSelectionButton extends Button {
  settingsName = 'buildTarget';
  command = 'cmake.setDefaultTarget';
  tooltip = localize('set.active.target.tooltip', 'Set the active target to build');

  protected getTooltipShort(): string|null { return this.prependCMake(this.tooltip); }
}
class LaunchTargetSelectionButton extends Button {
  settingsName = 'launchTarget';
  command = 'cmake.selectLaunchTarget';
  tooltip = localize('select.target.tooltip', 'Select the target to launch');

  protected getTooltipShort(): string|null { return this.prependCMake(this.tooltip); }
}

class DebugButton extends Button {
  settingsName = 'debug';
  command = 'cmake.debugTarget';
  icon = 'bug';
  tooltip = localize('launch.debugger.tooltip', 'Launch the debugger for the selected target');

  private _hidden: boolean = false;
  private _target: string|null = null;

  set hidden(v: boolean) {
    this._hidden = v;
    this.update();
  }
  set target(v: string|null) {
    this._target = v;
    this.update();
  }

  protected getTooltipNormal(): string|null {
    if (!!this._target) {
      return `${this.tooltip}: [${this._target}]`;
    }
    return this.tooltip;
  }

  protected isVisible(): boolean { return !this._hidden && hasCPPTools(); }
}
class LaunchButton extends Button {
  settingsName = 'launch';
  command = 'cmake.launchTarget';
  icon = 'play';
  tooltip = localize('launch.tooltip', 'Launch the selected target in the terminal window');

  private _hidden: boolean = false;
  private _target: string|null = null;

  set hidden(v: boolean) {
    this._hidden = v;
    this.update();
  }
  set target(v: string|null) {
    this._target = v;
    this.update();
  }

  protected getTooltipNormal(): string|null {
    if (!!this._target) {
      return `${this.tooltip}: [${this._target}]`;
    }
    return this.tooltip;
  }

  protected isVisible(): boolean { return super.isVisible() && !this._hidden; }
}

class CTestButton extends Button {
  settingsName = 'ctest';
  command = 'cmake.ctest';
  tooltip = localize('run.ctest.tests.tooltip', 'Run CTest tests');

  private _enabled: boolean = false;
  private _results: BasicTestResults|null = null;
  private _color: string = '';

  set enabled(v: boolean) {
    this._enabled = v;
    this.update();
  }
  set results(v: BasicTestResults|null) {
    this._results = v;
    if (!v) {
      this._color = '';
    } else {
      this._color = v.passing === v.total ? 'lightgreen' : 'yellow';
    }
    this.update();
  }

  update(): void {
    if (this._results) {
      const {passing, total} = this._results;
      this.icon = passing == total ? 'check' : 'x';
    } else {
      this.icon = 'beaker';
    }
    if (this.config.statusbar.advanced?.ctest?.color === true) {
      this.button.color = this._color;
    } else {
      this.button.color = '';
    }
    super.update();
  }

  protected isVisible(): boolean { return this._enabled; }

  protected getTextNormal(): string {
    if (!this._results) {
      this.button.color = '';
      return localize('run.ctest', 'Run CTest');
    }
    const {passing, total} = this._results;
    if (total == 1) {
      return localize('test.passing', '{0}/{1} test passing', passing, total);
    }
    return localize('tests.passing', '{0}/{1} tests passing', passing, total);
  }

  protected getTextShort(): string {
    if (!this._results) {
      return '';
    }
    const {passing, total} = this._results;
    return `${passing}/${total}`;
  }

  protected getTooltipShort(): string|null { return this.prependCMake(this.getTooltipNormal()); }
  protected getTooltipIcon() {
    if (!!this._results) {
      return this.prependCMake(`${this.getTextNormal()}\n${this.getTooltipNormal()}`);
    }
    return this.getTooltipShort();
  }
}

class BuildButton extends Button {
  private static readonly _build = localize('build', 'Build');
  private static readonly _stop = localize('stop', 'Stop');

  settingsName = 'build';
  command = 'cmake.build';
  tooltip = localize('build.tooltip', 'Build the selected target');

  private _isBusy: boolean = false;
  private _target: string|null = null;

  set isBusy(v: boolean) {
    this._isBusy = v;
    this.button.command = v ? 'cmake.stop' : 'cmake.build';
    this.icon = this._isBusy ? 'x' : 'gear';
    this.text = this._isBusy ? BuildButton._stop : BuildButton._build;
    // update implicitly called in set text.
    // this.update();
  }
  set target(v: string|null) {
    this._target = v;
    this.update();
  }

  protected getTextNormal(): string { return this.text; }
  protected getTextShort(): string { return ''; }

  protected getTooltipNormal(): string|null {
    if (!!this._target) {
      return `${this.tooltip}: [${this._target}]`;
    }
    return this.tooltip;
  }
  protected getTooltipShort(): string|null { return this.prependCMake(this.getTooltipNormal()); }

  protected isVisible(): boolean { return this._isBusy || true; }
}

export class StatusBar implements vscode.Disposable {
  private readonly _workspaceButton = new WorkspaceButton(this._config, 3.6);

  private readonly _cmakeToolsStatusItem = new CMakeStatus(this._config, 3.5);
  private readonly _kitSelectionButton = new KitSelection(this._config, 3.4);

  private readonly _buildButton: BuildButton = new BuildButton(this._config, 3.35);
  private readonly _buildTargetNameButton = new BuildTargetSelectionButton(this._config, 3.3);

  private readonly _debugButton: DebugButton = new DebugButton(this._config, 3.22);
  private readonly _launchButton = new LaunchButton(this._config, 3.21);
  private readonly _launchTargetNameButton = new LaunchTargetSelectionButton(this._config, 3.2);

  private readonly _testButton = new CTestButton(this._config, 3.1);

  private readonly _buttons: Button[];

  constructor(private readonly _config: ConfigurationReader) {
    this._buttons = [
      this._workspaceButton,
      this._cmakeToolsStatusItem,
      this._kitSelectionButton,
      this._buildTargetNameButton,
      this._launchTargetNameButton,
      this._debugButton,
      this._buildButton,
      this._testButton,
      this._launchButton
    ];
    this._config.onChange('statusbar', () => this.update());
    this.update();
  }

  dispose(): void { this._buttons.forEach(btn => btn.dispose()); }
  update(): void { this._buttons.forEach(btn => btn.update()); }

  setVisible(v: boolean): void { this._buttons.forEach(btn => btn.forceHidden = !v); }

  setActiveFolderName(v: string): void { this._workspaceButton.text = v; }
  setAutoSelectActiveFolder(autoSelectActiveFolder: boolean): void {
    this._workspaceButton.autoSelect = autoSelectActiveFolder;
  }
  setBuildTypeLabel(v: string): void { this._cmakeToolsStatusItem.text = v; }
  setStatusMessage(v: string): void { this._cmakeToolsStatusItem.statusMessage = v; }
  setBuildTargetName(v: string): void {
    this._buildTargetNameButton.text = v;
    this._buildButton.target = v;
  }
  setLaunchTargetName(v: string): void {
    this._launchTargetNameButton.text = v;
    this._launchButton.target = v;
    this._debugButton.target = v;
  }
  setCTestEnabled(v: boolean): void { this._testButton.enabled = v; }
  setTestResults(v: BasicTestResults|null): void { this._testButton.results = v; }
  setIsBusy(v: boolean): void { this._buildButton.isBusy = v; }
  setActiveKitName(v: string): void { this._kitSelectionButton.text = v; }

  hideLaunchButton(shouldHide: boolean = true): void { this._launchButton.hidden = shouldHide; }
  hideDebugButton(shouldHide: boolean = true): void { this._debugButton.hidden = shouldHide; }
}