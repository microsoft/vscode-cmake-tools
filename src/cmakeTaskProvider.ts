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
import CMakeTools from './cmakeTools';
import * as preset from '@cmt/preset';

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
        result.push(await this.provideTask(CommandType.cleanRebuild, cmakeTools?.useCMakePresets));
        return result;
    }

    public async provideTask(commandType: CommandType, useCMakePresets?: boolean, targets?: string[]): Promise<CMakeTask> {
        const taskName: string = localizeCommandType(commandType);
        let buildTargets: string[] | undefined;
        let preset: string | undefined;
        const options: { cwd?: string ; environment?: Environment } = {};
        if (commandType === CommandType.build) {
            buildTargets = targets;
        }
        if (useCMakePresets) {
            switch (commandType) {
                case CommandType.config:
                    preset = "${command:cmake.activeConfigurePresetName}";
                    break;
                case CommandType.build:
                    preset = "${command:cmake.activeBuildPresetName}";
                    break;
                case CommandType.test:
                    preset = "${command:cmake.activeTestPresetName}";
                    break;
                default:
                    preset = undefined;
            }
        }

        const definition: CMakeTaskDefinition = {
            type: CMakeTaskProvider.CMakeScriptType,
            label: CMakeTaskProvider.CMakeSourceStr + ": " + taskName,
            command: commandType,
            targets: buildTargets,
            preset: preset,
            options: options
        };
        const task = new vscode.Task(definition, vscode.TaskScope.Workspace, taskName, CMakeTaskProvider.CMakeSourceStr,
            new vscode.CustomExecution(async (resolvedDefinition: vscode.TaskDefinition): Promise<vscode.Pseudoterminal> =>
                // When the task is executed, this callback will run. Here, we setup for running the task.
                new CustomBuildTaskTerminal(resolvedDefinition.command, resolvedDefinition.targets, resolvedDefinition.preset, resolvedDefinition.options)
            ), []);
        task.group = commandType === CommandType.build ? vscode.TaskGroup.Build : undefined;
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

class CustomBuildTaskTerminal implements vscode.Pseudoterminal, proc.OutputConsumer {
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
            case CommandType.build:
                await this.runBuildTask();
                break;
            case CommandType.config:
                await this.runConfigTask();
                break;
            case CommandType.install:
                await this.runInstallTask();
                break;
            case CommandType.test:
                await this.runTestTask();
                break;
            case CommandType.clean:
                await this.runCleanTask();
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

    private async runBuildTask(): Promise<any> {
        let fullCommand: proc.BuildCommand | null;
        let cmakePath: string = "CMake.exe";
        let args: string[] = [];
        const cmakeTools: CMakeTools | undefined = getCMakeToolsForActiveFolder();
        const cmakeDriver: CMakeDriver | undefined = (await cmakeTools?.getCMakeDriverInstance()) || undefined;

        if (cmakeDriver) {
            if (!this.options) {
                this.options = {};
            }
            if (this.preset) {
                const buildPreset: preset.BuildPreset | undefined = await cmakeTools?.expandBuildPresetbyName(this.preset);
                if (buildPreset) {
                    fullCommand = await cmakeDriver.generateBuildCommandFromPreset(buildPreset, this.targets);
                    if (fullCommand) {
                        cmakePath = fullCommand.command;
                        args = fullCommand.args || [];
                        this.options.environment = EnvironmentUtils.merge([ fullCommand.build_env, this.options.environment], {preserveNull: true});
                    }
                }
            } else {
                fullCommand = await cmakeDriver.generateBuildCommandFromSettings(this.targets);
                if (fullCommand) {
                    cmakePath = fullCommand.command;
                    args = fullCommand.args ? fullCommand.args : [];
                    this.options.environment = EnvironmentUtils.merge([ fullCommand.build_env, this.options.environment]);
                }
            }
        } else {
            log.debug(localize("cmake.driver.not.found", 'CMake driver not found.'));
            this.writeEmitter.fire(localize("configure.failed", "Configure failed.") + endOfLine);
            this.closeEmitter.fire(-1);
            return;
        }
        this.writeEmitter.fire(localize("build.started", "Build task started....") + endOfLine);
        this.writeEmitter.fire(proc.buildCmdStr(cmakePath, args) + endOfLine);
        try {
            const result: proc.ExecutionResult = await proc.execute(cmakePath, args, this, this.options).result;
            if (result.retc) {
                this.writeEmitter.fire(localize("build.finished.with.error", "Build finished with error(s).") + endOfLine);
            } else if (result.stderr && !result.stdout) {
                this.writeEmitter.fire(localize("build.finished.with.warnings", "Build finished with warning(s).") + endOfLine);
            } else if (result.stdout && result.stdout.includes("warning")) {
                this.writeEmitter.fire(localize("build.finished.with.warnings", "Build finished with warning(s).") + endOfLine);
            } else {
                this.writeEmitter.fire(localize("build.finished.successfully", "Build finished successfully.") + endOfLine);
            }
            this.closeEmitter.fire(0);
        } catch {
            this.closeEmitter.fire(-1);
        }
    }

    private async runConfigTask(): Promise<any> {
        this.writeEmitter.fire(localize("config.started", "Config task started...") + endOfLine);
        let result: number | undefined | null;
        const cmakeTools: CMakeTools | undefined = getCMakeToolsForActiveFolder();
        const cmakeDriver: CMakeDriver | undefined = (await cmakeTools?.getCMakeDriverInstance()) || undefined;
        const cmakePath: string = cmakeDriver?.getCMakeCommand() || "CMake.exe";
        let args: string[] = [];
        if (this.preset) {
            const configPreset: preset.ConfigurePreset | undefined = await cmakeTools?.expandConfigPresetbyName(this.preset);
            args = (cmakeDriver && configPreset) ? cmakeDriver.generateConfigArgsFromPreset(configPreset) : [];
            const execResult = await proc.execute(cmakePath, args, this, this.options).result;
            result = execResult?.retc;
        } else {
            args = cmakeDriver ? await cmakeDriver.generateConfigArgsFromSettings() : [];
            const execResult = await proc.execute(cmakePath, args, this, this.options).result;
            result = execResult?.retc;
        }
        this.closeEmitter.fire((result === undefined || result === null) ? -1 : result);
    }

    private async runInstallTask(): Promise<any> {
        this.writeEmitter.fire(localize("install.started", "Install task started...") + endOfLine);
        const result: number | undefined =  await vscode.commands.executeCommand('cmake.install');
        this.closeEmitter.fire(result ? result : -1);
    }

    private async runTestTask(): Promise<any> {
        this.writeEmitter.fire(localize("test.started", "Test task started...") + endOfLine);
        let result: number | undefined | null;
        const cmakeTools: CMakeTools | undefined = getCMakeToolsForActiveFolder();
        const cmakeDriver: CMakeDriver | undefined = (await cmakeTools?.getCMakeDriverInstance()) || undefined;
        const cmakePath: string = cmakeDriver?.getCMakeCommand() || "CMake.exe";
        let args: string[] = [];
        if (this.preset) {
            const testPreset: preset.TestPreset | undefined = await cmakeTools?.expandTestPresetbyName(this.preset);
            args = (cmakeDriver && testPreset) ? cmakeDriver.generateTestArgsFromPreset(testPreset) : [];
            const execResult = await proc.execute(cmakePath, args, this, this.options).result;
            result = execResult?.retc;
        } else {
            args = cmakeDriver ? await cmakeDriver.generateTestArgsFromSettings() : [];
            const execResult = await proc.execute(cmakePath, args, this, this.options).result;
            result = execResult?.retc;
        }
        this.closeEmitter.fire((result === undefined || result === null) ? -1 : result);
    }

    private async runCleanTask(): Promise<any> {
        this.writeEmitter.fire(localize("clean.started", "Clean task started...") + endOfLine);
        const result: number | undefined =  await vscode.commands.executeCommand('cmake.clean');
        this.closeEmitter.fire(result ? result : -1);
    }

    private async runCleanRebuildTask(): Promise<any> {
        this.writeEmitter.fire(localize("clean.rebuild.started", "Clean Rebuild task started...") + endOfLine);
        const result: number | undefined =  await vscode.commands.executeCommand('cmake.cleanRebuild');
        this.closeEmitter.fire(result ? result : -1);
    }
}
