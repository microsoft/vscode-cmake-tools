import { DirectoryContext } from '@cmt/workspace';
import * as vscode from 'vscode';
import { CMakeDriver } from '@cmt/drivers/drivers';
// import { OutputConsumer } from './proc';
import * as nls from 'vscode-nls';
import { WorkflowPreset, ConfigurePreset, BuildPreset, TestPreset, PackagePreset, getPresetByName, allConfigurePresets, allBuildPresets, allTestPresets, allPackagePresets } from './preset';
import * as proc from '@cmt/proc';

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
     */
    constructor(readonly ws: DirectoryContext) {}

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

        if (!workflowPreset?.steps[0].name) {
            log.error(localize('workflow.configure.preset.not.exists', 'The configure preset of the workflow does not exist'));
            return -3;
        }

        const newConfigurePreset = getPresetByName(allConfigurePresets(driver.workspaceFolder), workflowPreset?.steps[0].name);

        if (newConfigurePreset?.name !== oldConfigurePreset?.name) {
            await driver.setConfigurePreset(newConfigurePreset);
        }
        await driver.configure(ConfigureTrigger.workflow, [], consumer);

        let newBuildPreset: BuildPreset | null = null;
        let newTestPreset: TestPreset | null = null ;
        let newPackagePreset: PackagePreset | null = null;
        for (const step of workflowPreset.steps) {
            switch (step.type) {
                case "build":
                    newBuildPreset = getPresetByName(allBuildPresets(driver.workspaceFolder), step.name);
                    if (newBuildPreset?.name !== oldBuildPreset?.name) {
                        await driver.setBuildPreset(newBuildPreset);
                    }
                    await driver.build(); // targets??? save old, specify which to build now, restore later?
                    break;
                case "test":
                    newTestPreset = getPresetByName(allTestPresets(driver.workspaceFolder), step.name);
                    if (newTestPreset?.name !== oldTestPreset?.name) {
                        await driver.setTestPreset(newTestPreset);
                    }
                    await vscode.commands.executeCommand("cmake.ctest"); // how else ctest from driver other than execute command?
                    break;
                case "package":
                    newPackagePreset = getPresetByName(allPackagePresets(driver.workspaceFolder), step.name);
                    if (newPackagePreset?.name !== oldPackagePreset?.name) {
                        await driver.setPackagePreset(newPackagePreset);
                    }
                    await vscode.commands.executeCommand("cmake.cpack"); // how else cpack from driver other than execute command?
                    break;
            }
        };


        if (newConfigurePreset?.name !== oldConfigurePreset?.name) {
            await driver.setConfigurePreset(oldConfigurePreset || null);
            await driver.configure(ConfigureTrigger.workflow, [], consumer);
        }

        if (newBuildPreset?.name !== oldBuildPreset?.name) {
            await driver.setBuildPreset(oldBuildPreset || null);
        }

        if (newTestPreset?.name !== oldTestPreset?.name) {
            await driver.setTestPreset(oldTestPreset || null);
        }

        if (newPackagePreset?.name !== oldPackagePreset?.name) {
            await driver.setPackagePreset(oldPackagePreset || null);
        }

        return 0;
    }
}

