/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { CMakeDriver } from './drivers/driver';
import * as proc from './proc';
import * as nls from 'vscode-nls';
import { Environment } from './environmentVariables';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

interface CMakeTaskDefinition extends vscode.TaskDefinition {
    type: string;
    label: string;
    command: string; // Command is either "build", "install", or "test".
    options?: { cwd?: string };
    targets?: string[];
}

enum CommandType {
    build = "build",
    install = "install",
    test = "test",
    config = "configure"
}

const localizeCommandType = (cmd: CommandType): string => (cmd === CommandType.build) ? localize("build", "build") :
    (cmd === CommandType.install) ? localize("install", "install") : (cmd === CommandType.test) ? localize("test", "test") :
        (cmd === CommandType.config) ? localize("configure", "configure") : "";
export class CMakeTask extends vscode.Task {
    detail?: string;
}

export class CMakeTaskProvider implements vscode.TaskProvider {
    static CMakeScriptType: string = 'cmake';
    static CMakeSourceStr: string = "CMake";
    static allTargetName: string = "all";
    private cmakeDriver?: CMakeDriver;
    private defaultTargets: string[] = [CMakeTaskProvider.allTargetName];

    constructor() {
    }

    public updateCMakeDriver(cmakeDriver: CMakeDriver) {
        this.cmakeDriver = cmakeDriver;
        if (CMakeTaskProvider.allTargetName === "all") {
            CMakeTaskProvider.allTargetName = this.cmakeDriver.allTargetName;
        }
    }

    public updateDefaultTargets(defaultTargets?: string[]) {
        this.defaultTargets = (defaultTargets && defaultTargets.length > 0) ? defaultTargets :
            this.cmakeDriver ? [this.cmakeDriver.allTargetName] : [CMakeTaskProvider.allTargetName];
    }

    public async provideTasks(): Promise<CMakeTask[]> {
        // Create a CMake build task
        const result: CMakeTask[] = [];
        this.updateDefaultTargets();
        // Provide build task.
        const taskName: string = localizeCommandType(CommandType.build);
        const definition: CMakeTaskDefinition = {
            type: CMakeTaskProvider.CMakeScriptType,
            label: CMakeTaskProvider.CMakeSourceStr + ": " + taskName,
            command: CommandType.build,
            targets: this.defaultTargets
        };
        const task = new vscode.Task(definition, vscode.TaskScope.Workspace, taskName, CMakeTaskProvider.CMakeSourceStr,
            new vscode.CustomExecution(async (resolvedDefinition: vscode.TaskDefinition): Promise<vscode.Pseudoterminal> =>
                // When the task is executed, this callback will run. Here, we setup for running the task.
                new CustomBuildTaskTerminal(resolvedDefinition.command, this.defaultTargets, resolvedDefinition.targets, resolvedDefinition.options, this.cmakeDriver)
            ), []);
        task.group = vscode.TaskGroup.Build;
        task.detail = localize('cmake.template.task', 'CMake template {0} task', taskName);
        result.push(task);
        return result;
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
    private endOfLine: string = "\r\n";

    constructor(private command: string, private defaultTargets: string[], private definedTargets?: string[], private options: { cwd?: string ; environment?: Environment } = {}, private cmakeDriver?: CMakeDriver) {
    }

    output(line: string): void {
        this.writeEmitter.fire(line + this.endOfLine);
    }

    error(error: string): void {
        this.writeEmitter.fire(error + this.endOfLine);
    }

    async open(_initialDimensions: vscode.TerminalDimensions | undefined): Promise<void> {
        // At this point we can start using the terminal.
        this.writeEmitter.fire(localize("starting.build", "Starting build...") + this.endOfLine);
        await this.doBuild();
    }

    close(): void {
        // The terminal has been closed. Shutdown the build.
    }

    private async doBuild(): Promise<any> {
        if (this.command !== CommandType.build) {
            this.writeEmitter.fire(localize("not.a.build.command", '{0} is not a recognized build command.', `"${this.command}"`) + this.endOfLine);
            this.closeEmitter.fire(-1);
            return;
        }
        let buildCommand: proc.BuildCommand | null;
        let cmakePath: string = "CMake.EXE";
        let args: string[] = [];

        if (this.cmakeDriver) {
            buildCommand = await this.cmakeDriver.getCMakeBuildCommand(this.definedTargets ? this.definedTargets : this.defaultTargets);
            if (buildCommand) {
                cmakePath = buildCommand.command;
                args = buildCommand.args ? buildCommand.args : [];
                this.options.environment = buildCommand.build_env;
            }
        }

        this.writeEmitter.fire(proc.buildCmdStr(cmakePath, args) + this.endOfLine);
        try {
            const result: proc.ExecutionResult = await proc.execute(cmakePath, args, this, this.options).result;
            const dot: string = ".";
            if (result.retc) {
                this.writeEmitter.fire(localize("build.finished.with.error", "Build finished with error(s)") + dot + this.endOfLine);
            } else if (result.stderr && !result.stdout) {
                this.writeEmitter.fire(localize("build.finished.with.warnings", "Build finished with warning(s)") + dot + this.endOfLine);
            } else if (result.stdout && result.stdout.includes("warning")) {
                this.writeEmitter.fire(localize("build.finished.with.warnings", "Build finished with warning(s)") + dot + this.endOfLine);
            } else {
                this.writeEmitter.fire(localize("build.finished.successfully", "Build finished successfully.") + this.endOfLine);
            }
            this.closeEmitter.fire(0);
        } catch {
            this.closeEmitter.fire(-1);
        }
    }
}
