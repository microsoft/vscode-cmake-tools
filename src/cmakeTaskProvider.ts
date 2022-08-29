/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { CMakeDriver } from './drivers/cmakeDriver';
import * as proc from './proc';
import * as nls from 'vscode-nls';
import { Environment, EnvironmentUtils } from './environmentVariables';
import * as logging from './logging';
import { getCMakeToolsForActiveFolder } from './extension';
import { CMakeTools, ConfigureTrigger } from './cmakeTools';
import * as preset from '@cmt/preset';
import { UseCMakePresets } from './config';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
const log = logging.createLogger('TaskProvider');

const endOfLine: string = "\r\n";

interface CMakeTaskDefinition extends vscode.TaskDefinition {
    type: string;
    label: string;
    command: string; // Command is either "build", "configure", "install", or "test".
    targets?: string[]; // only in "build" command
    preset?: string;
    options?: { cwd?: string ; environment?: Environment };
}

enum CommandType {
    build = "build",
    config = "configure",
    install = "install",
    test = "test",
    clean = "clean",
    cleanRebuild = "cleanRebuild"
}

const localizeCommandType = (cmd: CommandType): string => {
    switch (cmd) {
        case CommandType.build: {
            return localize("build", "build");
        }
        case CommandType.install: {
            return localize("install", "install");
        }
        case CommandType.test: {
            return localize("test", "test");
        }
        case CommandType.config: {
            return localize("configure", "configure");
        }
        case CommandType.clean: {
            return localize("clean", "clean");
        }
        case CommandType.cleanRebuild: {
            return localize("clean.rebuild", "clean rebuild");
        }
        default: {
            return "";
        }
    };
};
export class CMakeTask extends vscode.Task {
    detail?: string;
}

async function getDefaultPresetName(commandType: CommandType, resolve: boolean = false): Promise<string | undefined> {
    let result: string | undefined;
    switch (commandType) {
        case CommandType.config:
            result = resolve ? await vscode.commands.executeCommand("cmake.activeConfigurePresetName", []) as string :
                "${command:cmake.activeConfigurePresetName}";
            break;
        case CommandType.build:
            result = resolve ? await vscode.commands.executeCommand("cmake.activeBuildPresetName", []) as string :
                "${command:cmake.activeBuildPresetName}";
            break;
        case CommandType.cleanRebuild:
            result = resolve ? await vscode.commands.executeCommand("cmake.activeBuildPresetName", []) as string :
                "${command:cmake.activeBuildPresetName}";
            break;
        case CommandType.test:
            result = resolve ? await vscode.commands.executeCommand("cmake.activeTestPresetName", []) as string :
                "${command:cmake.activeTestPresetName}";
            break;
        default:
            return undefined;
    }
    return result;
}

export class CMakeTaskProvider implements vscode.TaskProvider {
    static CMakeScriptType: string = 'cmake';
    static CMakeSourceStr: string = "CMake";

    constructor() {
    }

    public async provideTasks(): Promise<CMakeTask[]> {
        const result: CMakeTask[] = [];
        const cmakeTools: CMakeTools | undefined = getCMakeToolsForActiveFolder();
        const targets: string[] | undefined = await cmakeTools?.getDefaultBuildTargets() || ["all"];
        result.push(await this.provideTask(CommandType.config, cmakeTools?.useCMakePresets));
        result.push(await this.provideTask(CommandType.build, cmakeTools?.useCMakePresets, targets));
        result.push(await this.provideTask(CommandType.install, cmakeTools?.useCMakePresets));
        result.push(await this.provideTask(CommandType.test, cmakeTools?.useCMakePresets));
        result.push(await this.provideTask(CommandType.clean, cmakeTools?.useCMakePresets));
        result.push(await this.provideTask(CommandType.cleanRebuild, cmakeTools?.useCMakePresets, targets));
        return result;
    }

    public async provideTask(commandType: CommandType, useCMakePresets?: boolean, targets?: string[]): Promise<CMakeTask> {
        const taskName: string = localizeCommandType(commandType);
        let buildTargets: string[] | undefined;
        let preset: string | undefined;
        if (commandType === CommandType.build || commandType === CommandType.cleanRebuild) {
            buildTargets = targets;
        }
        if (useCMakePresets) {
            preset = await getDefaultPresetName(commandType);
        }

        const definition: CMakeTaskDefinition = {
            type: CMakeTaskProvider.CMakeScriptType,
            label: CMakeTaskProvider.CMakeSourceStr + ": " + taskName,
            command: commandType,
            targets: buildTargets,
            preset: preset
        };
        const task = new vscode.Task(definition, vscode.TaskScope.Workspace, taskName, CMakeTaskProvider.CMakeSourceStr,
            new vscode.CustomExecution(async (resolvedDefinition: vscode.TaskDefinition): Promise<vscode.Pseudoterminal> =>
                // When the task is executed, this callback will run. Here, we setup for running the task.
                new CustomBuildTaskTerminal(resolvedDefinition.command, resolvedDefinition.targets, resolvedDefinition.preset, {})
            ), []);
        task.group = (commandType === CommandType.build || commandType === CommandType.cleanRebuild) ? vscode.TaskGroup.Build : undefined;
        task.detail = localize('cmake.template.task', 'CMake template {0} task', taskName);
        return task;
    }

    public async resolveTask(task: CMakeTask): Promise<CMakeTask | undefined> {
        const execution: any = task.execution;
        if (!execution) {
            const definition: CMakeTaskDefinition = <any>task.definition;
            const scope: vscode.WorkspaceFolder | vscode.TaskScope = vscode.TaskScope.Workspace;
            const resolvedTask: CMakeTask = new vscode.Task(definition, scope, definition.label, CMakeTaskProvider.CMakeSourceStr,
                new vscode.CustomExecution(async (resolvedDefinition: vscode.TaskDefinition): Promise<vscode.Pseudoterminal> =>
                    new CustomBuildTaskTerminal(resolvedDefinition.command, resolvedDefinition.targets, resolvedDefinition.preset, resolvedDefinition.options)
                ), []);
            return resolvedTask;
        }
        return undefined;
    }
}

export class CustomBuildTaskTerminal implements vscode.Pseudoterminal, proc.OutputConsumer {
    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<number>();
    public get onDidWrite(): vscode.Event<string> {
        return this.writeEmitter.event;
    }
    public get onDidClose(): vscode.Event<number> {
        return this.closeEmitter.event;
    }

    constructor(private command: string, private targets: string[], private preset?: string, private options?: { cwd?: string ; environment?: Environment }) {
    }

    output(line: string): void {
        this.writeEmitter.fire(line + endOfLine);
    }

    error(error: string): void {
        this.writeEmitter.fire(error + endOfLine);
    }

    async open(_initialDimensions: vscode.TerminalDimensions | undefined): Promise<void> {
        // At this point we can start using the terminal.
        switch (this.command) {
            case CommandType.config:
                await this.runConfigTask();
                break;
            case CommandType.build:
                await this.runBuildTask(CommandType.build);
                break;
            case CommandType.install:
                await this.runBuildTask(CommandType.install);
                break;
            case CommandType.test:
                await this.runTestTask();
                break;
            case CommandType.clean:
                await this.runBuildTask(CommandType.clean);
                break;
            case CommandType.cleanRebuild:
                await this.runCleanRebuildTask();
                break;
            default:
                this.writeEmitter.fire(localize("command.not.recognized", '{0} is not a recognized command.', `"${this.command}"`) + endOfLine);
                this.closeEmitter.fire(-1);
                return;
        }
    }

    close(): void {
        // The terminal has been closed. Shutdown the build.
    }

    private checkTargets(shouldIgnore: boolean): void {
        if (shouldIgnore && this.targets && this.targets.length > 0) {
            this.writeEmitter.fire(localize("target.is.ignored", "The defined targets in this task are being ignored.") + endOfLine);
        }
    }
    private async isTaskCompatibleWithPresets(cmakeTools: CMakeTools): Promise<boolean> {
        const useCMakePresets: boolean = cmakeTools.useCMakePresets;
        const presetDefined: boolean = this.preset !== undefined && this.preset !== null;
        const isNotCompatible = !useCMakePresets && presetDefined;
        if (!isNotCompatible) {
            return true;
        }
        const change: string = localize('enable.cmake.presets', "Enable CMakePresets");
        const ignore: string = localize('dismiss', "Dismiss");
        /** We don't want to await on this error message,
         * because if the user decides to change the settings, the task needs to re-run for the new settings to be effective.
         * */
        void vscode.window.showErrorMessage(
            localize('task.not.compatible.with.preset.setting', 'The selected task requests a CMakePreset, but the workspace is not configured for CMakePresets'),
            change, ignore).then((selection) => {
            if (selection === change) {
                const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration();
                if (config) {
                    const newValue: UseCMakePresets = (presetDefined) ? 'always' : 'never';
                    void config.update("cmake.useCMakePresets", newValue);
                }
            }
        });
        this.writeEmitter.fire(localize('task.not.compatible.with.preset.setting', 'The selected task is not compatible with preset setting.') + endOfLine);
        this.closeEmitter.fire(-1);
        return false;
    }

    private async resolvePresetName(preset: string | undefined, useCMakePresets: boolean, commandType: CommandType): Promise<string | undefined> {
        if (preset !== undefined) {
            return preset;
        }
        return useCMakePresets ? getDefaultPresetName(commandType, true) : undefined;
    }

    private getCMakeTools(): CMakeTools | undefined {
        const cmakeTools: CMakeTools | undefined = getCMakeToolsForActiveFolder();
        if (!cmakeTools) {
            log.debug(localize("cmake.tools.not.found", 'CMake Tools not found.'));
            this.writeEmitter.fire(localize("task.failed", "Task failed.") + endOfLine);
            this.closeEmitter.fire(-1);
        }
        return cmakeTools;
    }

    private async runConfigTask(): Promise<any> {
        this.writeEmitter.fire(localize("config.started", "Config task started...") + endOfLine);
        this.checkTargets(true);
        const cmakeTools: CMakeTools | undefined = this.getCMakeTools();
        if (!cmakeTools || !await this.isTaskCompatibleWithPresets(cmakeTools)) {
            return;
        }
        const cmakeDriver: CMakeDriver | undefined = (await cmakeTools?.getCMakeDriverInstance()) || undefined;
        if (cmakeDriver) {
            if (cmakeTools.useCMakePresets && cmakeDriver.config.configureOnEdit) {
                log.debug(localize("configure.on.edit", 'When running configure tasks using presets, setting configureOnEdit to true can potentially overwrite the task configurations.'));
            }

            this.preset = await this.resolvePresetName(this.preset, cmakeTools.useCMakePresets, CommandType.config);
            const configPreset: preset.ConfigurePreset | undefined = await cmakeTools?.expandConfigPresetbyName(this.preset);
            const result = await cmakeDriver.configure(ConfigureTrigger.taskProvider, [], this, false, false, configPreset, this.options);
            if (result === undefined || result === null) {
                this.writeEmitter.fire(localize('configure.terminated', 'Configure was terminated') + endOfLine);
                this.closeEmitter.fire(-1);
            } else {
                this.writeEmitter.fire(localize('configure.finished.with.code', 'Configure finished with return code {0}', result) + endOfLine);
                this.closeEmitter.fire(result);
            }
        } else {
            log.debug(localize("cmake.driver.not.found", 'CMake driver not found.'));
            this.writeEmitter.fire(localize("configure.failed", "Configure failed.") + endOfLine);
            this.closeEmitter.fire(-1);
        }
    }

    private async runBuildTask(commandType: CommandType): Promise<any> {
        let targets = this.targets;
        const taskName: string = localizeCommandType(commandType);
        if (commandType === CommandType.install) {
            this.checkTargets(true);
            targets = ['install'];
        } else if (commandType === CommandType.clean) {
            this.checkTargets(true);
            targets = ['clean'];
        }
        let fullCommand: proc.BuildCommand | null;
        let args: string[] = [];
        const cmakeTools: CMakeTools | undefined = this.getCMakeTools();
        if (!cmakeTools || !await this.isTaskCompatibleWithPresets(cmakeTools)) {
            return;
        }
        const cmakeDriver: CMakeDriver | undefined = (await cmakeTools?.getCMakeDriverInstance()) || undefined;
        let cmakePath: string;
        if (cmakeDriver) {
            cmakePath = cmakeDriver.getCMakeCommand();
            if (!this.options) {
                this.options = {};
            }
            this.preset = await this.resolvePresetName(this.preset, cmakeTools.useCMakePresets, CommandType.build);
            if (this.preset) {
                const buildPreset: preset.BuildPreset | undefined = await cmakeTools?.expandBuildPresetbyName(this.preset);
                if (!buildPreset) {
                    log.debug(localize("build.preset.not.found", 'Build preset not found.'));
                    this.writeEmitter.fire(localize("build.failed", "Build preset {0} not found. Build failed.", this.preset) + endOfLine);
                    this.closeEmitter.fire(-1);
                    return;
                }
                fullCommand = await cmakeDriver.generateBuildCommandFromPreset(buildPreset, targets);
                if (fullCommand) {
                    cmakePath = fullCommand.command;
                    args = fullCommand.args || [];
                    this.options.environment = EnvironmentUtils.merge([ fullCommand.build_env, this.options.environment], {preserveNull: true});
                }
            } else {
                fullCommand = await cmakeDriver.generateBuildCommandFromSettings(targets);
                if (fullCommand) {
                    cmakePath = fullCommand.command;
                    args = fullCommand.args ? fullCommand.args : [];
                    this.options.environment = EnvironmentUtils.merge([ fullCommand.build_env, this.options.environment]);
                }
            }
        } else {
            log.debug(localize("cmake.driver.not.found", 'CMake driver not found.'));
            this.writeEmitter.fire(localize("task.failed", "{0} failed.", taskName) + endOfLine);
            this.closeEmitter.fire(-1);
            return;
        }
        this.writeEmitter.fire(localize("task.started", "{0} task started....", taskName) + endOfLine);
        this.writeEmitter.fire(proc.buildCmdStr(cmakePath, args) + endOfLine);
        try {
            const result: proc.ExecutionResult = await proc.execute(cmakePath, args, this, this.options).result;
            if (result.retc) {
                this.writeEmitter.fire(localize("task.finished.with.error", "{0} finished with error(s).", taskName) + endOfLine);
            } else if (result.stderr && !result.stdout) {
                this.writeEmitter.fire(localize("task.finished.with.warnings", "{0} finished with warning(s).", taskName) + endOfLine);
            } else if (result.stdout && result.stdout.includes("warning")) {
                this.writeEmitter.fire(localize("task.finished.with.warnings", "{0} finished with warning(s).", taskName) + endOfLine);
            } else {
                this.writeEmitter.fire(localize("task.finished.successfully", "{0} finished successfully.", taskName) + endOfLine);
            }
            this.closeEmitter.fire(0);
        } catch {
            this.writeEmitter.fire(localize("task.finished.with.error", "{0} finished with error(s).", taskName) + endOfLine);
            this.closeEmitter.fire(-1);
        }
    }

    private async runTestTask(): Promise<any> {
        this.writeEmitter.fire(localize("test.started", "Test task started...") + endOfLine);
        this.checkTargets(true);
        const cmakeTools: CMakeTools | undefined = this.getCMakeTools();
        if (!cmakeTools || !await this.isTaskCompatibleWithPresets(cmakeTools)) {
            return;
        }
        const cmakeDriver: CMakeDriver | undefined = (await cmakeTools?.getCMakeDriverInstance()) || undefined;
        if (cmakeDriver) {
            let testPreset: preset.TestPreset | undefined;
            this.preset = await this.resolvePresetName(this.preset, cmakeTools.useCMakePresets, CommandType.test);
            if (this.preset) {
                testPreset = await cmakeTools?.expandTestPresetbyName(this.preset);
                if (!testPreset) {
                    log.debug(localize("test.preset.not.found", 'Test preset not found.'));
                    this.writeEmitter.fire(localize("ctest.failed", "Test preset {0} not found. Test failed.", this.preset) + endOfLine);
                    this.closeEmitter.fire(-1);
                    return;
                }
            }
            const result: number | null | undefined = cmakeDriver ? await cmakeTools?.runCTestCustomized(cmakeDriver, testPreset, this) : undefined;
            if (result === undefined || result === null) {
                this.writeEmitter.fire(localize('ctest.run.terminated', 'CTest run was terminated') + endOfLine);
                this.closeEmitter.fire(-1);
            } else {
                this.writeEmitter.fire(localize('ctest.finished.with.code', 'CTest finished with return code {0}', result) + endOfLine);
                this.closeEmitter.fire(result);
            }
        }  else {
            log.debug(localize("cmake.driver.not.found", 'CMake driver not found.'));
            this.writeEmitter.fire(localize("test.failed", "CTest run failed.") + endOfLine);
            this.closeEmitter.fire(-1);
        }
    }

    private async runCleanRebuildTask(): Promise<any> {
        const cleanResult = await this.runBuildTask(CommandType.clean);
        if (cleanResult === 0) {
            await this.runBuildTask(CommandType.build);
        }
    }
}

export const cmakeTaskProvider: CMakeTaskProvider = new CMakeTaskProvider();
