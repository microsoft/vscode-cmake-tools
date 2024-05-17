/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { CMakeDriver } from './drivers/drivers';
import * as proc from './proc';
import * as nls from 'vscode-nls';
import { Environment, EnvironmentUtils } from './environmentVariables';
import * as logging from './logging';
import { extensionManager, getActiveProject } from './extension';
import { CMakeProject, ConfigureTrigger } from './cmakeProject';
import * as preset from '@cmt/preset';
import { UseCMakePresets } from './config';
import * as telemetry from '@cmt/telemetry';
import * as util from '@cmt/util';
import * as expand from '@cmt/expand';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
const log = logging.createLogger('TaskProvider');

const endOfLine: string = "\r\n";

export interface CMakeTaskDefinition extends vscode.TaskDefinition {
    type: string;
    label: string;
    command: string; // Command is either "build", "configure", "install", "test", "package" or "workflow".
    targets?: string[]; // only in "build" command
    preset?: string;
    options?: { cwd?: string ; environment?: Environment };
}

export class CMakeTask extends vscode.Task {
    detail?: string;
    isDefault?: boolean;
    isTemplate?: boolean;
}

export interface TaskMenu extends vscode.QuickPickItem {
    task: CMakeTask;
}

export enum CommandType {
    build = "build",
    config = "configure",
    install = "install",
    test = "test",
    package = "package",
    workflow = "workflow",
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
        case CommandType.package: {
            return localize("package", "package");
        }
        case CommandType.workflow: {
            return localize("workflow", "workflow");
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
        case CommandType.install:
            result = resolve ? await vscode.commands.executeCommand("cmake.activeBuildPresetName", []) as string :
                "${command:cmake.activeBuildPresetName}";
            break;
        case CommandType.clean:
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
        case CommandType.package:
            result = resolve ? await vscode.commands.executeCommand("cmake.activePackagePresetName", []) as string :
                "${command:cmake.activePackagePresetName}";
            break;
        case CommandType.workflow:
            result = resolve ? await vscode.commands.executeCommand("cmake.activeWorkflowPresetName", []) as string :
                "${command:cmake.activeWorkflowPresetName}";
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
        const project: CMakeProject | undefined = getActiveProject();
        const targets: string[] | undefined = await project?.getDefaultBuildTargets() || ["all"];
        if (extensionManager?.workspaceHasAtLeastOneProject()) {
            result.push(await CMakeTaskProvider.provideTask(CommandType.config, project?.useCMakePresets));
            result.push(await CMakeTaskProvider.provideTask(CommandType.build, project?.useCMakePresets, targets));
            result.push(await CMakeTaskProvider.provideTask(CommandType.install, project?.useCMakePresets));
            result.push(await CMakeTaskProvider.provideTask(CommandType.test, project?.useCMakePresets));
            result.push(await CMakeTaskProvider.provideTask(CommandType.package, project?.useCMakePresets));
            result.push(await CMakeTaskProvider.provideTask(CommandType.workflow, project?.useCMakePresets));
            result.push(await CMakeTaskProvider.provideTask(CommandType.clean, project?.useCMakePresets));
            result.push(await CMakeTaskProvider.provideTask(CommandType.cleanRebuild, project?.useCMakePresets, targets));
        }

        return result;
    }

    public static async provideTask(commandType: CommandType, useCMakePresets?: boolean, targets?: string[], presetName?: string): Promise<CMakeTask> {
        const taskName: string = localizeCommandType(commandType);
        let buildTargets: string[] | undefined;
        let preset: string | undefined;
        if (commandType === CommandType.build || commandType === CommandType.cleanRebuild) {
            buildTargets = targets;
        }
        if (presetName) {
            preset = presetName;
        } else if (useCMakePresets) {
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

    public static async resolveInternalTask(task: CMakeTask): Promise<CMakeTask | undefined> {
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
        return task;
    }

    public static async findBuildTask(presetName?: string, targets?: string[], expansionOptions?: expand.ExpansionOptions): Promise<CMakeTask | undefined> {
        // Fetch all CMake task from `tasks.json` files.
        const allTasks: vscode.Task[] = await vscode.tasks.fetchTasks({ type: CMakeTaskProvider.CMakeScriptType });

        const tasks: (CMakeTask | undefined)[] = await Promise.all(allTasks.map(async (task: any) => {
            if (!task.definition.label || !task.group || (task.group && task.group.id !== vscode.TaskGroup.Build.id)) {
                return undefined;
            }

            let taskTargets: string[];
            if (expansionOptions && task.definition.targets) {
                taskTargets = await expand.expandStrings(task.definition.targets, expansionOptions);
                if (task.definition.options?.cwd) {
                    task.definition.options.cwd = await expand.expandString(task.definition.options.cwd, expansionOptions);
                }
            } else {
                taskTargets = task.definition.targets;
            }

            const definition: CMakeTaskDefinition = {
                type: task.definition.type,
                label: task.definition.label,
                command: task.definition.command,
                targets: taskTargets || targets,
                preset: task.definition.preset,
                options: task.definition.options
            };

            const buildTask: CMakeTask = new vscode.Task(definition, vscode.TaskScope.Workspace, task.definition.label, CMakeTaskProvider.CMakeSourceStr);
            buildTask.detail = task.detail;
            if (task.group.isDefault) {
                buildTask.isDefault = true;
            }
            return buildTask;
        }));

        const buildTasks: CMakeTask[] = tasks.filter((task) => task !== undefined) as CMakeTask[];

        // No CMake Task is found.
        if (buildTasks.length === 0) {
            return undefined;
        }

        // Find tasks with a target that matches the input preset's target or the input targets
        let matchingTargetTasks: CMakeTask[];

        if (presetName) {
            matchingTargetTasks = buildTasks.filter(task => task.definition.preset === presetName);
        } else {
            matchingTargetTasks = buildTasks.filter(task => {
                const taskTargets: string[] = task.definition.targets || [];
                const inputTargets: string[] = targets || [];
                return taskTargets.length === inputTargets.length && taskTargets.every((item, index) => item === inputTargets[index]);
            });
        }

        if (matchingTargetTasks.length > 0) {
            // One task is found.
            if (matchingTargetTasks.length === 1) {
                return matchingTargetTasks[0];
            } else {
                // Search for the matching default task.
                const defaultTask: CMakeTask[] = matchingTargetTasks.filter(task => task.isDefault);
                if (defaultTask.length >= 1) {
                    return defaultTask[0];
                } else {
                    // If there is no default task, matchingTargetTasks is a mixture of template and defined tasks.
                    // If there is only one task, that task is a template, so return the template.
                    // If there are only two tasks, the first one is always a template, and the second one is the defined task that we are searching for.
                    // But if there are more than two tasks, it means that there are multiple defiend tasks and none are set as default. So ask the user to choose one later.
                    if (matchingTargetTasks.length === 1 || matchingTargetTasks.length === 2) {
                        return matchingTargetTasks[matchingTargetTasks.length - 1];
                    }
                }
            }
        }

        // Fetch CMake task from from task provider
        matchingTargetTasks.push(await CMakeTaskProvider.provideTask(CommandType.build, undefined, targets, presetName));
        const items: TaskMenu[] = matchingTargetTasks.map<TaskMenu>(task => ({ label: task.name, task: task, description: task.detail}));
        // Ask the user to pick a task.
        const selection = await vscode.window.showQuickPick(items, { placeHolder: localize('select.build.task', 'Select a build task') });
        return selection?.task;
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
            case CommandType.package:
                await this.runPackageTask();
                break;
            case CommandType.workflow:
                await this.runWorkflowTask();
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

    private _process: proc.Subprocess | undefined = undefined;
    async close(): Promise<void> {
        if (this._process) {
            if (this._process.child) {
                await util.termProc(this._process.child);
            }
            this._process = undefined;
        }
    }

    private async correctTargets(project: CMakeProject, commandType: CommandType): Promise<string[]> {
        let targets: string[] = this.targets;
        const targetIsDefined: boolean = this.targets && this.targets.length > 0 ;
        const shouldIgnore: boolean = commandType !== CommandType.build;

        if (shouldIgnore && targetIsDefined) {
            this.writeEmitter.fire(localize("target.is.ignored", "The defined targets in this task are being ignored.") + endOfLine);
        }

        if (commandType === CommandType.install) {
            targets = ['install'];
        } else if (commandType === CommandType.clean) {
            targets = ['clean'];
        } else if (!shouldIgnore && !targetIsDefined && !project.useCMakePresets) {
            targets = [await project.buildTargetName() || await project.allTargetName];
        }
        return targets;
    }

    private async isTaskCompatibleWithPresets(project: CMakeProject): Promise<boolean> {
        const useCMakePresets: boolean = project.useCMakePresets;
        const presetDefined: boolean = this.preset !== undefined && this.preset !== null;
        const isNotCompatible = !useCMakePresets && presetDefined;
        if (!isNotCompatible) {
            return true;
        }
        const change: string = localize('enable.cmake.presets', "Enable CMakePresets");
        const ignore: string = localize('dismiss', "Dismiss");
        /** We don't want to await on this error message,
         * because if the user decides to change the settings, the task needs to re-run for the new settings to be effective.
         **/
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

    private getActiveProject(): CMakeProject | undefined {
        const project: CMakeProject | undefined = getActiveProject();
        if (!project) {
            log.debug(localize("cmake.tools.not.found", 'CMake Tools not found.'));
            this.writeEmitter.fire(localize("task.failed", "Task failed.") + endOfLine);
            this.closeEmitter.fire(-1);
        }
        return project;
    }

    private async runConfigTask(): Promise<any> {
        this.writeEmitter.fire(localize("config.started", "Config task started...") + endOfLine);
        const project: CMakeProject | undefined = this.getActiveProject();
        if (!project || !await this.isTaskCompatibleWithPresets(project)) {
            return;
        }
        telemetry.logEvent("task", {taskType: "configure", useCMakePresets: String(project.useCMakePresets)});
        await this.correctTargets(project, CommandType.config);
        const cmakeDriver: CMakeDriver | undefined = (await project?.getCMakeDriverInstance()) || undefined;
        if (cmakeDriver) {
            if (project.useCMakePresets && cmakeDriver.config.configureOnEdit) {
                log.debug(localize("configure.on.edit", 'When running configure tasks using presets, setting configureOnEdit to true can potentially overwrite the task configurations.'));
            }

            this.preset = await this.resolvePresetName(this.preset, project.useCMakePresets, CommandType.config);
            const configPreset: preset.ConfigurePreset | undefined = await project?.expandConfigPresetbyName(this.preset);
            const result = await cmakeDriver.configure(ConfigureTrigger.taskProvider, [], this, undefined, false, false, configPreset, this.options);
            if (result === undefined || result === null) {
                this.writeEmitter.fire(localize('configure.terminated', 'Configure was terminated') + endOfLine);
                this.closeEmitter.fire(-1);
            } else {
                this.writeEmitter.fire(localize('configure.finished.with.code', 'Configure finished with return code {0}', result.result) + endOfLine);
                this.closeEmitter.fire(result.result);
            }
        } else {
            log.debug(localize("cmake.driver.not.found", 'CMake driver not found.'));
            this.writeEmitter.fire(localize("configure.failed", "Configure failed.") + endOfLine);
            this.closeEmitter.fire(-1);
        }
    }

    private async runBuildTask(commandType: CommandType, doCloseEmitter: boolean = true, generateLog: boolean = true, project?: CMakeProject): Promise<number> {
        let targets = this.targets;
        const taskName: string = localizeCommandType(commandType);
        let fullCommand: proc.BuildCommand | null;
        let args: string[] = [];

        if (!project) {
            project = this.getActiveProject();
            if (!project || !await this.isTaskCompatibleWithPresets(project)) {
                return -1;
            }
        }
        if (generateLog) {
            telemetry.logEvent("task", {taskType: commandType, useCMakePresets: String(project.useCMakePresets)});
        }
        targets = await this.correctTargets(project, commandType);
        const cmakeDriver: CMakeDriver | undefined = (await project?.getCMakeDriverInstance()) || undefined;
        let cmakePath: string;
        if (cmakeDriver) {
            cmakePath = cmakeDriver.getCMakeCommand();

            if (!this.options) {
                this.options = {};
            }
            this.preset = await this.resolvePresetName(this.preset, project.useCMakePresets, CommandType.build);
            if (this.preset) {
                const buildPreset: preset.BuildPreset | undefined = await project?.expandBuildPresetbyName(this.preset);
                if (!buildPreset) {
                    log.debug(localize("build.preset.not.found", 'Build preset not found.'));
                    this.writeEmitter.fire(localize("build.no.preset.failed", "Build preset {0} not found. {1} failed.", this.preset, taskName) + endOfLine);
                    if (doCloseEmitter) {
                        this.closeEmitter.fire(-1);
                    }
                    return -1;
                }
                fullCommand = await cmakeDriver.generateBuildCommandFromPreset(buildPreset, targets);
                if (fullCommand) {
                    cmakePath = fullCommand.command;
                    args = fullCommand.args || [];
                    this.options.environment = EnvironmentUtils.merge([fullCommand.build_env, this.options.environment], {preserveNull: true});
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
            this.writeEmitter.fire(localize("build.failed", "{0} failed.", taskName) + endOfLine);
            if (doCloseEmitter) {
                this.closeEmitter.fire(-1);
            }
            return -1;
        }
        this.writeEmitter.fire(localize("build.started", "{0} task started....", taskName) + endOfLine);
        this.writeEmitter.fire(proc.buildCmdStr(cmakePath, args) + endOfLine);
        try {
            this._process = proc.execute(cmakePath, args, this, this.options);
            const result: proc.ExecutionResult = await this._process.result;
            this._process = undefined;
            if (result.retc) {
                this.writeEmitter.fire(localize("build.finished.with.error", "{0} finished with error(s).", taskName) + endOfLine);
            } else if (result.stderr || (result.stdout && result.stdout.includes(": warning"))) {
                this.writeEmitter.fire(localize("build.finished.with.warnings", "{0} finished with warning(s).", taskName) + endOfLine);
            } else {
                this.writeEmitter.fire(localize("build.finished.successfully", "{0} finished successfully.", taskName) + endOfLine);
            }
            if (doCloseEmitter) {
                this.closeEmitter.fire(result.retc ?? 0);
            }
            return result.retc ?? 0;
        } catch {
            this.writeEmitter.fire(localize("build.finished.with.error", "{0} finished with error(s).", taskName) + endOfLine);
            if (doCloseEmitter) {
                this.closeEmitter.fire(-1);
            }
            return -1;
        }
    }

    private async runTestTask(): Promise<any> {
        this.writeEmitter.fire(localize("test.started", "Test task started...") + endOfLine);

        const project: CMakeProject | undefined = this.getActiveProject();
        if (!project || !await this.isTaskCompatibleWithPresets(project)) {
            return;
        }
        telemetry.logEvent("task", {taskType: "test", useCMakePresets: String(project.useCMakePresets)});
        await this.correctTargets(project, CommandType.test);
        const cmakeDriver: CMakeDriver | undefined = (await project?.getCMakeDriverInstance()) || undefined;

        if (cmakeDriver) {
            let testPreset: preset.TestPreset | undefined;
            this.preset = await this.resolvePresetName(this.preset, project.useCMakePresets, CommandType.test);
            if (this.preset) {
                testPreset = await project?.expandTestPresetbyName(this.preset);
                if (!testPreset) {
                    log.debug(localize("test.preset.not.found", 'Test preset not found.'));
                    this.writeEmitter.fire(localize("ctest.failed", "Test preset {0} not found. Test failed.", this.preset) + endOfLine);
                    this.closeEmitter.fire(-1);
                    return;
                }
            }
            const result: number | undefined = cmakeDriver ? await project?.runCTestCustomized(cmakeDriver, testPreset, this) : undefined;
            if (result === undefined) {
                this.writeEmitter.fire(localize('ctest.run.terminated', 'CTest run was terminated') + endOfLine);
                this.closeEmitter.fire(-1);
            } else {
                this.writeEmitter.fire(localize('ctest.finished', 'CTest finished') + endOfLine);
                this.closeEmitter.fire(0);
            }
        }  else {
            log.debug(localize("cmake.driver.not.found", 'CMake driver not found.'));
            this.writeEmitter.fire(localize("test.failed", "CTest run failed.") + endOfLine);
            this.closeEmitter.fire(-1);
        }
    }

    private async runPackageTask(): Promise<any> {
        this.writeEmitter.fire(localize("package.started", "Package task started...") + endOfLine);

        const project: CMakeProject | undefined = this.getActiveProject();
        if (!project || !await this.isTaskCompatibleWithPresets(project)) {
            return;
        }
        telemetry.logEvent("task", {taskType: "package", useCMakePresets: String(project.useCMakePresets)});
        await this.correctTargets(project, CommandType.package);
        const cmakeDriver: CMakeDriver | undefined = (await project?.getCMakeDriverInstance()) || undefined;

        if (cmakeDriver) {
            let packagePreset: preset.PackagePreset | undefined;
            this.preset = await this.resolvePresetName(this.preset, project.useCMakePresets, CommandType.package);
            if (this.preset) {
                packagePreset = await project?.expandPackagePresetbyName(this.preset);
                if (!packagePreset) {
                    log.debug(localize("package.preset.not.found", 'Package preset not found.'));
                    this.writeEmitter.fire(localize("cpack.failed", "Package preset {0} not found. CPack failed.", this.preset) + endOfLine);
                    this.closeEmitter.fire(-1);
                    return;
                }
            }
            const result: number | undefined = cmakeDriver ? await project?.runCPack(cmakeDriver, packagePreset, this) : undefined;
            if (result === undefined) {
                this.writeEmitter.fire(localize('cpack.run.terminated', 'CPack run was terminated') + endOfLine);
                this.closeEmitter.fire(-1);
            } else {
                this.writeEmitter.fire(localize('cpack.finished', 'CPack finished') + endOfLine);
                this.closeEmitter.fire(0);
            }
        }  else {
            log.debug(localize("cmake.driver.not.found", 'CMake driver not found.'));
            this.writeEmitter.fire(localize("cpack.failed", "CPack run failed.") + endOfLine);
            this.closeEmitter.fire(-1);
        }
    }

    private async runWorkflowTask(): Promise<any> {
        this.writeEmitter.fire(localize("workflow.started", "Workflow task started...") + endOfLine);

        const project: CMakeProject | undefined = this.getActiveProject();
        if (!project || !await this.isTaskCompatibleWithPresets(project)) {
            return;
        }
        telemetry.logEvent("task", {taskType: "workflow", useCMakePresets: String(project.useCMakePresets)});
        await this.correctTargets(project, CommandType.workflow); // ?????
        const cmakeDriver: CMakeDriver | undefined = (await project?.getCMakeDriverInstance()) || undefined;

        if (cmakeDriver) {
            let workflowPreset: preset.WorkflowPreset | undefined;
            this.preset = await this.resolvePresetName(this.preset, project.useCMakePresets, CommandType.workflow);
            if (this.preset) {
                workflowPreset = await project?.expandWorkflowPresetbyName(this.preset);
                if (!workflowPreset) {
                    log.debug(localize("workflow.preset.not.found", 'Workflow preset not found.'));
                    this.writeEmitter.fire(localize("workflow.failed", "Workflow preset {0} not found. Workflow failed.", this.preset) + endOfLine);
                    this.closeEmitter.fire(-1);
                    return;
                }
            }
            const result: number | undefined = cmakeDriver ? await project?.runWorkflow(cmakeDriver, workflowPreset, this) : undefined;
            if (result === undefined) {
                this.writeEmitter.fire(localize('workflow.run.terminated', 'Workflow run was terminated') + endOfLine);
                this.closeEmitter.fire(-1);
            } else {
                this.writeEmitter.fire(localize('workflow.finished', 'Workflow finished') + endOfLine);
                this.closeEmitter.fire(0);
            }
        }  else {
            log.debug(localize("cmake.driver.not.found", 'CMake driver not found.'));
            this.writeEmitter.fire(localize("workflow.failed", "Workflow run failed.") + endOfLine);
            this.closeEmitter.fire(-1);
        }
    }

    private async runCleanRebuildTask(): Promise<any> {
        const project: CMakeProject | undefined = this.getActiveProject();
        if (!project || !await this.isTaskCompatibleWithPresets(project)) {
            return;
        }
        telemetry.logEvent("task", {taskType: "cleanRebuild", useCMakePresets: String(project.useCMakePresets)});
        const cleanResult = await this.runBuildTask(CommandType.clean, false, false, project);
        if (cleanResult === 0) {
            await this.runBuildTask(CommandType.build, true, false, project);
        } else {
            this.closeEmitter.fire(cleanResult);
        }
    }
}

export const cmakeTaskProvider: CMakeTaskProvider = new CMakeTaskProvider();
