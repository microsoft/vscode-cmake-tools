import { DirectoryContext } from '@cmt/workspace';
import * as vscode from 'vscode';
import { CMakeDriver } from '@cmt/drivers/drivers';
// import { OutputConsumer } from './proc';
import * as nls from 'vscode-nls';
import { WorkflowPreset, ConfigurePreset, BuildPreset, TestPreset, PackagePreset, getPresetByName, allConfigurePresets, allBuildPresets, allTestPresets, allPackagePresets } from './preset';
import * as proc from '@cmt/proc';
import { ProjectController } from './projectController';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

import * as logging from './logging';
import { ConfigureTrigger } from './cmakeProject';
const log = logging.createLogger('workflow');

// class WorkflowOutputLogger implements OutputConsumer {
//     output(line: string) {
//         log.info(line);
//     }
//     error(line: string) {
//         this.output(line);
//     }
// }

export class WorkflowDriver implements vscode.Disposable {
    /**
     * @param projectController
     */
    constructor(readonly ws: DirectoryContext, private readonly projectController?: ProjectController) {}

    dispose() {
    }

    public async runWorkflow(driver: CMakeDriver,
                             workflowPreset?: WorkflowPreset | null,
                             configurePreset?: ConfigurePreset | null,
                             buildPreset?: BuildPreset | null,
                             testPreset?: TestPreset | null,
                             packagePreset?: PackagePreset | null,
                             consumer?: proc.OutputConsumer): Promise<number> {
        if (driver.useCMakePresets && !driver.workflowPreset) {
            log.error(localize('workflow.preset.not.set', 'Workflow preset is not set'));
            return -3;
        }
        const oldConfigurePreset = configurePreset;
        const oldBuildPreset = buildPreset;
        const oldTestPreset = testPreset;
        const oldPackagePreset = packagePreset;

        if (workflowPreset?.steps[0].type !== "configure") {
            log.error(localize('workflow.does.not.start.configure.step', 'The workflow does not start with a configure step.'));
            return -3;
        }

        const prj = await this.projectController?.getProjectForFolder(driver.workspaceFolder);
        if (!prj) {
            log.error(localize('no.project.found', 'No project found for folder {0}', driver.workspaceFolder));
            return -2;
        }

        let newConfigurePreset: ConfigurePreset | null = null;
        let newBuildPreset: BuildPreset | null = null;
        let newTestPreset: TestPreset | null = null ;
        let newPackagePreset: PackagePreset | null = null;
        for (const step of workflowPreset.steps) {
            switch (step.type) {
                case "configure":
                    newConfigurePreset = getPresetByName(allConfigurePresets(driver.workspaceFolder), step.name);
                    if (!newConfigurePreset) {
                        log.error(localize('workflow.configure.preset.does.not.exist', `The workflow step references a non existing configure preset: '${step.name}'`));
                        return -3;
                    }

                    if (step.name !== workflowPreset.steps[0].name) {
                        log.error(localize('workflow.has.subsequent.configure.preset', `The workflow preset has another configure besides the first step: '${step.name}'`));
                        return -3;
                    }

                    if (newConfigurePreset.name !== oldConfigurePreset?.name) {
                        await prj.setConfigurePreset(newConfigurePreset.name);
                    }

                    log.info(localize('workflow.configuring', `Configuring project with the '${newConfigurePreset.name}' configure preset of the workflow.`));
                    await prj.configureInternal(ConfigureTrigger.workflow);

                    break;

                case "build":
                    newBuildPreset = getPresetByName(allBuildPresets(driver.workspaceFolder), step.name);
                    if (!newBuildPreset) {
                        log.error(localize('workflow.build.preset.does.not.exist', `The workflow step references a non existing build preset: '${step.name}'`));
                        return -3;
                    }

                    if (newBuildPreset.name !== oldBuildPreset?.name) {
                        await prj.setBuildPreset(step.name);
                    }

                    log.info(localize('workflow.building', `Building project with the '${step.name}' build preset of the workflow step.`));
                    await prj.runBuild();

                    break;

                case "test":
                    newTestPreset = getPresetByName(allTestPresets(driver.workspaceFolder), step.name);
                    if (!newTestPreset) {
                        log.error(localize('workflow.test.preset.does.not.exist', `The workflow step references a non existing test preset: '${step.name}'`));
                        return -3;
                    }

                    if (newTestPreset.name !== oldTestPreset?.name) {
                        await prj.setTestPreset(step.name);
                    }

                    log.info(localize('workflow.running.ctest', `Running ctest for the '${step.name}' test preset of the workflow step.`));
                    await prj.ctest();
 
                    break;

                case "package":
                    newPackagePreset = getPresetByName(allPackagePresets(driver.workspaceFolder), step.name);
                    if (!newPackagePreset) {
                        log.error(localize('workflow.package.preset.does.not.exist', `The workflow step references a non existing package preset: '${step.name}'`));
                        return -3;
                    }

                    if (newPackagePreset.name !== oldPackagePreset?.name) {
                        await prj.setPackagePreset(step.name);
                    }

                    log.info(localize('workflow.packaging', `Packaging the project with the '${step.name}' package preset of the workflow step.`));
                    await prj.cpack();

                    break;
            }
        };


        if (newConfigurePreset?.name !== oldConfigurePreset?.name && oldConfigurePreset) {
            await prj.setConfigurePreset(oldConfigurePreset?.name);
            log.info(localize('workflow.restore.configuring', `Workflow finished. Restore the original '${oldConfigurePreset?.name}' configure preset and reconfigure.`));
            await prj.configureInternal(ConfigureTrigger.workflow);
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

