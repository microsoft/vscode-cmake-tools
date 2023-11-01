import { ConfigurationReader, StatusBarButtonVisibility, StatusBarTextButtonVisibility, StatusBarStaticButtonVisibility, StatusBarIconButtonVisibility } from '@cmt/config';
import { SpecialKits } from '@cmt/kit';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

// Helper functions
function hasCPPTools(): boolean {
    return vscode.extensions.getExtension('ms-vscode.cpptools') !== undefined;
}

// Button class
abstract class Button {
    readonly settingsName: string | null = null;
    protected readonly button: vscode.StatusBarItem;
    private _forceHidden: boolean = false;
    private _hidden: boolean = false;
    private _text: string = '';
    private _tooltip: string | null = null;
    private _icon: string | null = null;

    constructor(protected readonly config: ConfigurationReader, protected readonly priority: number) {
        this.button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, this.priority);
    }

    /**
     * Only used in StatusBar class
     */
    set forceHidden(v: boolean) {
        this._forceHidden = v;
        this.update();
    }

    get hidden() {
        return this._hidden;
    }
    set hidden(v: boolean) {
        this._hidden = v;
        this.update();
    }

    get text(): string {
        return this._text;
    }
    set text(v: string) {
        this._text = v;
        this.update();
    }

    get bracketText(): string {
        return `[${this._text}]`;
    }

    get tooltip(): string | null {
        return this._tooltip;
    }
    set tooltip(v: string | null) {
        this._tooltip = v;
        this.update();
    }

    protected set icon(v: string | null) {
        this._icon = v ? `$(${v})` : null;
    }

    protected set command(v: string | null) {
        this.button.command = v || undefined;
    }

    dispose(): void {
        this.button.dispose();
    }
    update(): void {
        if (!this._isVisible() || this._forceHidden) {
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
    protected getTextShort(): string {
        return this.getTextNormal();
    }
    protected getTextIcon(): string {
        return '';
    }

    protected getTooltipNormal(): string | null {
        return this._tooltip;
    }
    protected getTooltipShort(): string | null {
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
    protected getTooltipIcon(): string | null {
        return this.getTooltipShort();
    }

    protected isVisible(): boolean {
        return !this.hidden;
    }
    protected prependCMake(text: string | null): any {
        if (!!text) {
            return `CMake: ${text}`;
        }
        return text;
    }

    private _isVisible(): boolean {
        return this.isVisible() && this._getVisibilitySetting() !== 'hidden';
    }
    private _getVisibilitySetting(): StatusBarButtonVisibility | StatusBarTextButtonVisibility | StatusBarStaticButtonVisibility | StatusBarIconButtonVisibility | null {
        if (this.settingsName) {
            let setting = Object(this.config.status.advanced)[this.settingsName]?.statusBarVisibility;
            if (setting === undefined) {
                setting = this.config.status.statusBarVisibility;
            }
            return setting || null;
        }
        return null;
    }

    private _getTooltip(): string | null {
        const visibility = this._getVisibilitySetting();
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
        const type = this._getVisibilitySetting();
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
        if (text === '') {
            return this._icon || '';
        }
        return `${this._icon} ${text}`;
    }
}

class FolderButton extends Button {
    // private static readonly _autoSelectToolTip = localize('active.folder.auto.select.tooltip', 'Active folder');
    // private static readonly _toolTip = localize('active.folder.tooltip', 'Select Active folder');
    // private static readonly _autoSelectToolTip = localize('active.folder.auto.tooltip', 'auto');

    settingsName = 'folder';
    constructor(protected readonly config: ConfigurationReader, protected readonly priority: number) {
        super(config, priority);
        this.command = 'cmake.selectActiveFolder';
        this.icon = 'folder-active';
        this.tooltip = localize('click.to.select.workspace.tooltip', 'Click to select the active folder');
    }

    // private _autoSelect: boolean = false;
    set autoSelect(v: boolean) {
        if (v) {}
        // this._autoSelect = v;
        // this.update();
    }

    protected getTooltipNormal(): string | null {
        // if (this._autoSelect) {
        //  return `${this.tooltip} (${WorkspaceButton._autoSelectToolTip})`;
        // }
        return this.tooltip;
    }
    protected getTextShort(): string {
        let len = this.config.status.advanced?.folder?.statusBarLength || 0;
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
    protected getTooltipShort(): string | null {
        return this.prependCMake(this.getTooltipNormal());
    }
    protected getTooltipIcon(): string | null {
        return super.getTooltipShort();
    }

    public isMultiProject: boolean = false;
    protected isVisible(): boolean {
        return super.isVisible() && vscode.workspace.workspaceFolders !== undefined && (vscode.workspace.workspaceFolders.length > 1 || this.isMultiProject);
    }
}

class VariantStatus extends Button {
    private _statusMessage: string = localize('loading.status', 'Loading...');

    settingsName = 'variantStatus';
    constructor(protected readonly config: ConfigurationReader, protected readonly priority: number) {
        super(config, priority);
        this.hidden = true;
        this.command = 'cmake.setVariant';
        this.icon = 'info';
        this.text = localize('unconfigured', 'Unconfigured');
        this.tooltip = localize('click.to.select.variant.tooltip', 'Click to select the current build variant');
    }

    set statusMessage(v: string) {
        this._statusMessage = v;
        this.update();
    }

    protected getTextNormal(): string {
        return this.prependCMake(`${this.bracketText}: ${this._statusMessage}`);
    }
    protected getTextShort(): string {
        return this.bracketText;
    }

    protected getTooltipShort(): string | null {
        return this.prependCMake(`${this.bracketText} - ${this._statusMessage}\n${this.tooltip}`);
    }
}

class KitSelection extends Button {
    private static readonly _noActiveKit = localize('no.active.kit', 'No active kit');
    private static readonly _noKitSelected = localize('no.kit.selected', 'No Kit Selected');

    settingsName = 'kit';
    constructor(protected readonly config: ConfigurationReader, protected readonly priority: number) {
        super(config, priority);
        this.hidden = true;
        this.command = 'cmake.selectKit';
        this.icon = 'tools';
        this.tooltip = localize('click.to.change.kit.tooltip', 'Click to change the active kit');
    }

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
        let len = this.config.status.advanced?.kit?.statusBarLength || 0;
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

    protected getTooltipShort(): string | null {
        if (this.getTextNormal() === this.getTextShort()) {
            return this.prependCMake(this.getTooltipNormal());
        }
        return super.getTooltipShort();
    }
}

class BuildTargetSelectionButton extends Button {
    settingsName = 'buildTarget';
    constructor(protected readonly config: ConfigurationReader, protected readonly priority: number) {
        super(config, priority);
        this.hidden = false;
        this.command = 'cmake.setDefaultTarget';
        this.tooltip = localize('set.active.target.tooltip', 'Set the default build target');
    }

    protected getTextShort(): string {
        let len = this.config.status.advanced?.buildTarget?.statusBarLength || 0;
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

    protected getTooltipShort(): string | null {
        return this.prependCMake(this.tooltip);
    }
}

class LaunchTargetSelectionButton extends Button {
    settingsName = 'launchTarget';
    constructor(protected readonly config: ConfigurationReader, protected readonly priority: number) {
        super(config, priority);
        this.command = 'cmake.selectLaunchTarget';
        this.tooltip = localize('select.target.tooltip', 'Select the target to launch');
    }

    protected getTooltipShort(): string | null {
        return this.prependCMake(this.tooltip);
    }

    protected getTextShort(): string {
        let len = this.config.status.advanced?.launchTarget?.statusBarLength || 0;
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
}

class DebugButton extends Button {
    settingsName = 'debug';
    constructor(protected readonly config: ConfigurationReader, protected readonly priority: number) {
        super(config, priority);
        this.command = 'cmake.debugTarget';
        this.icon = 'bug';
        this.tooltip = localize('launch.debugger.tooltip', 'Launch the debugger for the selected target');
    }

    private _target: string | null = null;

    set target(v: string | null) {
        this._target = v;
        this.update();
    }

    protected getTooltipNormal(): string | null {
        if (!!this._target) {
            return `${this.tooltip}: [${this._target}]`;
        }
        return this.tooltip;
    }

    protected isVisible(): boolean {
        return super.isVisible() && hasCPPTools();
    }
}

class LaunchButton extends Button {
    settingsName = 'launch';
    constructor(protected readonly config: ConfigurationReader, protected readonly priority: number) {
        super(config, priority);
        this.command = 'cmake.launchTarget';
        this.icon = 'play';
        this.tooltip = localize('launch.tooltip', 'Launch the selected target in the terminal window');
    }

    private _target: string | null = null;

    set target(v: string | null) {
        this._target = v;
        this.update();
    }

    protected getTooltipNormal(): string | null {
        if (!!this._target) {
            return `${this.tooltip}: [${this._target}]`;
        }
        return this.tooltip;
    }
}

class CTestButton extends Button {
    settingsName = 'ctest';
    constructor(protected readonly config: ConfigurationReader, protected readonly priority: number) {
        super(config, priority);
        this.command = 'cmake.ctest';
        this.tooltip = localize('run.ctest.tests.tooltip', 'Run CTest tests');
    }

    private _enabled: boolean = false;
    private _color: string = '';

    set enabled(v: boolean) {
        this._enabled = v;
        this.update();
    }

    update(): void {
        this.icon = 'beaker';
        if (this.config.status.advanced?.ctest?.color === true) {
            this.button.color = this._color;
        } else {
            this.button.color = '';
        }
        super.update();
    }

    protected isVisible(): boolean {
        return super.isVisible() && this._enabled;
    }

    protected getTextNormal(): string {
        this.button.color = '';
        return localize('run.ctest', 'Run CTest');
    }

    protected getTextShort(): string {
        let len = this.config.status.advanced?.ctest?.statusBarLength || 0;
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

    protected getTooltipShort(): string | null {
        return this.prependCMake(this.getTooltipNormal());
    }
    protected getTooltipIcon() {
        return this.getTooltipShort();
    }
}

class BuildButton extends Button {
    private static readonly _build = localize('build', 'Build');
    private static readonly _stop = localize('stop', 'Stop');

    settingsName = 'build';
    constructor(protected readonly config: ConfigurationReader, protected readonly priority: number) {
        super(config, priority);
        this.command = 'cmake.build';
        this.tooltip = localize('build.tooltip', 'Build the selected target');
    }

    private _isBusy: boolean = false;
    private _target: string | null = null;

    set isBusy(v: boolean) {
        this._isBusy = v;
        this.button.command = v ? 'cmake.stop' : 'cmake.build';
        this.icon = this._isBusy ? 'x' : 'gear';
        this.text = this._isBusy ? BuildButton._stop : BuildButton._build;
        // update implicitly called in set text.
        // this.update();
    }
    set target(v: string | null) {
        this._target = v;
        this.update();
    }

    protected getTextNormal(): string {
        return this.text;
    }
    protected getTextShort(): string {
        return '';
    }

    protected getTooltipNormal(): string | null {
        if (!!this._target) {
            return `${this.tooltip}: [${this._target}]`;
        }
        return this.tooltip;
    }
    protected getTooltipShort(): string | null {
        return this.prependCMake(this.getTooltipNormal());
    }

    protected isVisible(): boolean {
        return super.isVisible() && (this._isBusy || true);
    }
}

export class ConfigurePresetSelection extends Button {
    private static readonly _noPresetSelected = localize('no.configure.preset.selected', 'No Configure Preset Selected');

    settingsName = 'configurePreset';
    constructor(protected readonly config: ConfigurationReader, protected readonly priority: number) {
        super(config, priority);
        this.hidden = false;
        this.command = 'cmake.selectConfigurePreset';
        this.icon = 'tools';
        this.tooltip = localize('click.to.change.configure.preset.tooltip', 'Click to change the active configure preset');
    }

    protected getTextNormal(): string {
        const text = this.text;
        if (text.length === 0) {
            return ConfigurePresetSelection._noPresetSelected;
        }
        return this.bracketText;
    }

    protected getTextShort(): string {
        let len = this.config.status.advanced?.configurePreset?.statusBarLength || 0;
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

    protected getTooltipShort(): string | null {
        if (this.getTextNormal() === this.getTextShort()) {
            return this.prependCMake(this.getTooltipNormal());
        }
        return super.getTooltipShort();
    }
}

export class BuildPresetSelection extends Button {
    private static readonly _noPresetSelected = localize('no.build.preset.selected', 'No Build Preset Selected');

    settingsName = 'buildPreset';
    constructor(protected readonly config: ConfigurationReader, protected readonly priority: number) {
        super(config, priority);
        this.hidden = false;
        this.command = 'cmake.selectBuildPreset';
        this.icon = 'tools';
        this.tooltip = localize('click.to.change.build.preset.tooltip', 'Click to change the active build preset');
    }

    protected getTextNormal(): string {
        const text = this.text;
        if (text.length === 0) {
            return BuildPresetSelection._noPresetSelected;
        }
        return this.bracketText;
    }

    protected getTextShort(): string {
        let len = this.config.status.advanced?.buildPreset?.statusBarLength || 0;
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

    protected getTooltipShort(): string | null {
        if (this.getTextNormal() === this.getTextShort()) {
            return this.prependCMake(this.getTooltipNormal());
        }
        return super.getTooltipShort();
    }
}

export class TestPresetSelection extends Button {
    private static readonly _noPresetSelected = localize('no.test.preset.selected', 'No Test Preset Selected');

    settingsName = 'testPreset';
    constructor(protected readonly config: ConfigurationReader, protected readonly priority: number) {
        super(config, priority);
        this.hidden = false;
        this.command = 'cmake.selectTestPreset';
        this.icon = 'tools';
        this.tooltip = localize('click.to.change.test.preset.tooltip', 'Click to change the active test preset');
    }

    protected getTextNormal(): string {
        const text = this.text;
        if (text.length === 0) {
            return TestPresetSelection._noPresetSelected;
        }
        return this.bracketText;
    }

    protected getTextShort(): string {
        let len = this.config.status.advanced?.testPreset?.statusBarLength || 0;
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

    protected getTooltipShort(): string | null {
        if (this.getTextNormal() === this.getTextShort()) {
            return this.prependCMake(this.getTooltipNormal());
        }
        return super.getTooltipShort();
    }
}

export class StatusBar implements vscode.Disposable {
    private readonly _folderButton = new FolderButton(this._config, 3.6);

    private readonly _configurePresetButton = new ConfigurePresetSelection(this._config, 3.55);
    private readonly _variantStatusButton = new VariantStatus(this._config, 3.5);
    private readonly _kitSelectionButton = new KitSelection(this._config, 3.4);

    private readonly _buildButton: BuildButton = new BuildButton(this._config, 3.35);
    private readonly _buildPresetButton = new BuildPresetSelection(this._config, 3.33);
    private readonly _buildTargetNameButton = new BuildTargetSelectionButton(this._config, 3.3);

    private readonly _debugButton: DebugButton = new DebugButton(this._config, 3.22);
    private readonly _launchButton = new LaunchButton(this._config, 3.21);
    private readonly _launchTargetNameButton = new LaunchTargetSelectionButton(this._config, 3.2);

    private readonly _testPresetButton = new TestPresetSelection(this._config, 3.15);
    private readonly _testButton = new CTestButton(this._config, 3.1);

    private readonly _buttons: Button[];

    constructor(private readonly _config: ConfigurationReader) {
        this._buttons = [
            this._folderButton,
            this._variantStatusButton,
            this._kitSelectionButton,
            this._buildTargetNameButton,
            this._launchTargetNameButton,
            this._debugButton,
            this._buildButton,
            this._testButton,
            this._launchButton,
            this._configurePresetButton,
            this._buildPresetButton,
            this._testPresetButton
        ];
        this._config.onChange('status', () => this.update());
        this.update();
    }

    dispose(): void {
        this._buttons.forEach(btn => btn.dispose());
    }
    update(): void {
        this._buttons.forEach(btn => btn.update());
    }

    setVisible(v: boolean): void {
        this._buttons.forEach(btn => btn.forceHidden = !v);
    }

    setActiveProjectName(v: string, isMultiProject: boolean): void {
        this._folderButton.text = v;
        this._folderButton.isMultiProject = isMultiProject;
    }
    setAutoSelectActiveProject(autoSelectActiveProject: boolean): void {
        this._folderButton.autoSelect = autoSelectActiveProject;
    }
    setVariantLabel(v: string): void {
        this._variantStatusButton.text = v;
    }
    setStatusMessage(v: string): void {
        this._variantStatusButton.statusMessage = v;
    }
    setBuildTargetName(v: string): void {
        this._buildTargetNameButton.text = v;
        this._buildButton.target = v;
    }
    setLaunchTargetName(v: string): void {
        this._launchTargetNameButton.text = v;
        this._launchButton.target = v;
        this._debugButton.target = v;
    }
    setCTestEnabled(v: boolean): void {
        this._testButton.enabled = v;
    }
    setIsBusy(v: boolean): void {
        this._buildButton.isBusy = v;
    }
    setActiveKitName(v: string): void {
        this._kitSelectionButton.text = v;
    }
    setConfigurePresetName(v: string): void {
        this._configurePresetButton.text = v;
    }
    setBuildPresetName(v: string): void {
        this._buildPresetButton.text = v;
    }
    setTestPresetName(v: string): void {
        this._testPresetButton.text = v; this.setCTestEnabled(true);
    }

    hideLaunchButton(shouldHide: boolean = true): void {
        this._launchButton.hidden = shouldHide;
    }
    hideDebugButton(shouldHide: boolean = true): void {
        this._debugButton.hidden = shouldHide;
    }
    hideBuildButton(shouldHide: boolean = true): void {
        this._buildButton.hidden = shouldHide;
    }

    useCMakePresets(isUsing: boolean = true): void {
        this._variantStatusButton.hidden = isUsing;
        this._kitSelectionButton.hidden = isUsing;
        this._configurePresetButton.hidden = !isUsing;
        this._buildPresetButton.hidden = !isUsing;
        this._testPresetButton.hidden = !isUsing;
    }
}
