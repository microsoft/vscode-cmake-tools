/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { CMakeDriver } from './drivers/cmakeDriver';
import * as proc from './proc';
import * as nls from 'vscode-nls';
import { Environment } from './environmentVariables';
import * as logging from './logging';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
const log = logging.createLogger('TaskProvider');

let allTargetName: string = "all";
const endOfLine: string = "\r\n";

interface CMakeTaskDefinition extends vscode.TaskDefinition {
    type: string;
    label: string;
    command: string; // Command is either "build", "configure", "install", or "test".
    options?: { cwd?: string };
    targets?: string[]; // only in "build" command
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
    private cmakeDriver?: CMakeDriver;
    private defaultTargets: string[] = [allTargetName];

    constructor() {
    }

    public updateCMakeDriver(cmakeDriver: CMakeDriver) {
        this.cmakeDriver = cmakeDriver;
        allTargetName = this.cmakeDriver.allTargetName;
    }

    public updateDefaultTargets(defaultTargets?: string[]) {
        this.defaultTargets = (defaultTargets && defaultTargets.length > 0) ? defaultTargets :
            this.cmakeDriver ? [this.cmakeDriver.allTargetName] : [allTargetName];
    }

    public async provideTasks(): Promise<CMakeTask[]> {
        const result: CMakeTask[] = [];
        result.push(await this.provideTask(CommandType.build));
        result.push(await this.provideTask(CommandType.config));
        result.push(await this.provideTask(CommandType.install));
        result.push(await this.provideTask(CommandType.test));
        result.push(await this.provideTask(CommandType.clean));
        result.push(await this.provideTask(CommandType.cleanRebuild));
        return result;
    }

    public async provideTask(commandType: CommandType): Promise<CMakeTask> {
        const taskName: string = localizeCommandType(commandType);
        const definition: CMakeTaskDefinition = {
            type: CMakeTaskProvider.CMakeScriptType,
            label: CMakeTaskProvider.CMakeSourceStr + ": " + taskName,
            command: commandType,
            targets: (commandType === CommandType.build) ? this.defaultTargets : undefined
        };
        const task = new vscode.Task(definition, vscode.TaskScope.Workspace, taskName, CMakeTaskProvider.CMakeSourceStr,
            new vscode.CustomExecution(async (resolvedDefinition: vscode.TaskDefinition): Promise<vscode.Pseudoterminal> =>
                // When the task is executed, this callback will run. Here, we setup for running the task.
                new CustomBuildTaskTerminal(resolvedDefinition.command, this.defaultTargets, resolvedDefinition.targets, resolvedDefinition.options, this.cmakeDriver)
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
                    new CustomBuildTaskTerminal(resolvedDefinition.command, this.defaultTargets, resolvedDefinition.targets, resolvedDefinition.options, this.cmakeDriver)
                ), []); // TODO: add problem matcher
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

    constructor(private command: string, private defaultTargets: string[], private definedTargets?: string[], private options: { cwd?: string ; environment?: Environment } = {}, private cmakeDriver?: CMakeDriver) {
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
        let command: proc.BuildCommand | null;
        let cmakePath: string = "CMake.EXE";
        let args: string[] = [];

        if (this.cmakeDriver) {
            if (await this.cmakeDriver.checkNeedsReconfigure()) {
                const result: number | undefined =  await vscode.commands.executeCommand('cmake.configure');
                if (result !== 0) {
                    this.writeEmitter.fire(localize("configure.finished.with.error", "Configure finished with error(s).") + endOfLine);
                    this.closeEmitter.fire(result ? result : -1);
                    return;
                }
            }
            command = await this.cmakeDriver.getCMakeBuildCommand(this.definedTargets ? this.definedTargets : this.defaultTargets);
            if (command) {
                cmakePath = command.command;
                args = command.args ? command.args : [];
                this.options.environment = command.build_env;
            }
        } else {
            log.debug(localize("cmake.driver.not.found", 'CMake driver not found.'));
            this.writeEmitter.fire(localize("configure.failed", "Configure failed.") + endOfLine);
            this.closeEmitter.fire(-1);
            return;
        }
        this.writeEmitter.fire(localize("build.started", "Build Started...") + endOfLine);
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
        this.writeEmitter.fire(localize("config.started", "Config Started...") + endOfLine);
        const result: number | undefined =  await vscode.commands.executeCommand('cmake.configure');
        this.closeEmitter.fire(result ? result : -1);
    }

    private async runInstallTask(): Promise<any> {
        this.writeEmitter.fire(localize("install.started", "Install Started...") + endOfLine);
        const result: number | undefined =  await vscode.commands.executeCommand('cmake.install');
        this.closeEmitter.fire(result ? result : -1);
    }

    private async runTestTask(): Promise<any> {
        this.writeEmitter.fire(localize("test.started", "Test Started...") + endOfLine);
        const result: number | undefined =  await vscode.commands.executeCommand('cmake.ctest');
        this.closeEmitter.fire(result ? result : -1);
    }

    private async runCleanTask(): Promise<any> {
        this.writeEmitter.fire(localize("clean.started", "Clean Started...") + endOfLine);
        const result: number | undefined =  await vscode.commands.executeCommand('cmake.clean');
        this.closeEmitter.fire(result ? result : -1);
    }

    private async runCleanRebuildTask(): Promise<any> {
        this.writeEmitter.fire(localize("clean.rebuild.started", "Clean Rebuild Started...") + endOfLine);
        const result: number | undefined =  await vscode.commands.executeCommand('cmake.cleanRebuild');
        this.closeEmitter.fire(result ? result : -1);
    }
}
