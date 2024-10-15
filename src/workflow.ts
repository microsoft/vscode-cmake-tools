import { DirectoryContext } from '@cmt/workspace';
import * as vscode from 'vscode';
import { CMakeDriver } from '@cmt/drivers/drivers';
import * as nls from 'vscode-nls';
import { ConfigureType } from '@cmt/cmakeProject';
import { WorkflowPreset, ConfigurePreset, BuildPreset, TestPreset, PackagePreset, getPresetByName, allConfigurePresets, allBuildPresets, allTestPresets, allPackagePresets } from '@cmt/presets/preset';
import * as proc from '@cmt/proc';
import { ProjectController } from '@cmt/projectController';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

import * as logging from '@cmt/logging';
import { ConfigureTrigger } from '@cmt/cmakeProject';
const log = logging.createLogger('workflow');

export class WorkflowDriver implements vscode.Disposable {
    /**
     * @param projectController
     */
    constructor(readonly ws: DirectoryContext, private readonly projectController?: ProjectController) {}

    dispose() {
    }

    // validatePresetsFile in presetsController is making sure the workflow presets are correct in structure,
    // so no validation needed here about that (unresolved referenced configure presets, configure step not being first, etc...)
    public async runWorkflow(driver: CMakeDriver,
        workflowPreset?: WorkflowPreset | null,
        configurePreset?: ConfigurePreset | null,
        buildPreset?: BuildPreset | null,
        testPreset?: TestPreset | null,
        packagePreset?: PackagePreset | null,
        _consumer?: proc.OutputConsumer): Promise<number> {
        if (driver.useCMakePresets && !driver.workflowPreset) {
            log.error(localize('workflow.preset.not.set', 'Workflow preset is not set'));
            return -3;
        }
        const oldConfigurePreset = configurePreset;
        const oldBuildPreset = buildPreset;
        const oldTestPreset = testPreset;
        const oldPackagePreset = packagePreset;

        const prj = await this.projectController?.getProjectForFolder(driver.workspaceFolder);
        if (!prj) {
            log.error(localize('no.project.found', 'No project found for folder {0}', driver.workspaceFolder));
            return -2;
        }

        let newConfigurePreset: ConfigurePreset | null = null;
        let newBuildPreset: BuildPreset | null = null;
        let newTestPreset: TestPreset | null = null ;
        let newPackagePreset: PackagePreset | null = null;
        const workflowSteps = workflowPreset?.steps || [];
        let cleanWorkflowConfigure: boolean = false;
        for (const step of workflowSteps) {
            switch (step.type) {
                case "configure":
                    newConfigurePreset = getPresetByName(allConfigurePresets(driver.workspaceFolder), step.name);
                    if (newConfigurePreset?.name !== oldConfigurePreset?.name) {
                        await prj.setConfigurePreset(newConfigurePreset?.name || null);
                        // If the workflow configure preset is different than the current project configure preset
                        // it is better to re-configure clean.
                        cleanWorkflowConfigure = true;
                    }

                    if (cleanWorkflowConfigure) {
                        log.info(localize('workflow.configuring.clean', 'Configuring clean project with the {0} configure preset of the workflow.', newConfigurePreset?.name));
                        await prj.configureInternal(ConfigureTrigger.workflow, [], ConfigureType.Clean);
                    } else {
                        log.info(localize('workflow.configuring', 'Configuring project with the {0} configure preset of the workflow.', newConfigurePreset?.name));
                        await prj.configureInternal(ConfigureTrigger.workflow);
                    }

                    break;

                case "build":
                    newBuildPreset = getPresetByName(allBuildPresets(driver.workspaceFolder), step.name);
                    if (newBuildPreset?.name !== oldBuildPreset?.name) {
                        await prj.setBuildPreset(step.name);
                    }

                    log.info(localize('workflow.building', 'Building project with the {0} build preset of the workflow step.', step.name));
                    await prj.runBuild();

                    break;

                case "test":
                    newTestPreset = getPresetByName(allTestPresets(driver.workspaceFolder), step.name);
                    if (newTestPreset?.name !== oldTestPreset?.name) {
                        await prj.setTestPreset(step.name);
                    }

                    log.info(localize('workflow.running.ctest', 'Running ctest for the {0} test preset of the workflow step.', step.name));
                    await prj.ctest(/*fromWorkflow = */ true);

                    break;

                case "package":
                    newPackagePreset = getPresetByName(allPackagePresets(driver.workspaceFolder), step.name);
                    if (newPackagePreset?.name !== oldPackagePreset?.name) {
                        await prj.setPackagePreset(step.name);
                    }

                    log.info(localize('workflow.packaging', 'Packaging the project with the {0} package preset of the workflow step.', step.name));
                    await prj.cpack(true /*fromWorkflow*/);

                    break;
            }
        };

        if (newConfigurePreset?.name !== oldConfigurePreset?.name && oldConfigurePreset) {
            await prj.setConfigurePreset(oldConfigurePreset?.name);
            log.info(localize('workflow.restore.configuring', 'Workflow finished. Restore the original {0} configure preset and reconfigure.', oldConfigurePreset?.name ?? ""));
            if (cleanWorkflowConfigure) {
                await prj.configureInternal(ConfigureTrigger.workflow, [], ConfigureType.Clean);
            } else {
                await prj.configureInternal(ConfigureTrigger.workflow);
            }
        }

        if (newBuildPreset?.name !== oldBuildPreset?.name && oldBuildPreset) {
            await prj.setBuildPreset(oldBuildPreset.name);
        }

        if (newTestPreset?.name !== oldTestPreset?.name && oldTestPreset) {
            await prj.setTestPreset(oldTestPreset.name);
        }

        if (newPackagePreset?.name !== oldPackagePreset?.name && oldPackagePreset) {
            await prj.setPackagePreset(oldPackagePreset.name);
        }

        return 0;
    }
}

