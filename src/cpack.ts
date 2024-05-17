import { DirectoryContext } from '@cmt/workspace';
import * as vscode from 'vscode';
import { CMakeDriver } from '@cmt/drivers/drivers';
import { OutputConsumer } from './proc';
import * as nls from 'vscode-nls';
import { PackagePreset } from './preset';
import { expandString } from './expand';
import * as proc from '@cmt/proc';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

import * as logging from './logging';
const log = logging.createLogger('cpack');

class CPackOutputLogger implements OutputConsumer {
    output(line: string) {
        log.info(line);
    }
    error(line: string) {
        this.output(line);
    }
}

export class CPackDriver implements vscode.Disposable {
    constructor(readonly ws: DirectoryContext) {}

    // TODO: evaluate whether files like CPackSourceConfig.cmake or CPackConfig.cmake should have any impact on the package presets functionality
    // same as CTestTestfile.cmake looks to have on test presets. Remove if not necessary and also review testingEnabled in ctest.ts
    // (it is set/unset according to some logic but never queried).
    private _packagingEnabled: boolean = false;
    get packagingEnabled(): boolean {
        return this._packagingEnabled;
    }
    set packagingEnabled(v: boolean) {
        this._packagingEnabled = v;
        this.packagingEnabledEmitter.fire(v);
    }

    private readonly packagingEnabledEmitter = new vscode.EventEmitter<boolean>();
    readonly onPackagingEnabledChanged = this.packagingEnabledEmitter.event;

    dispose() {
        this.packagingEnabledEmitter.dispose();
    }

    private async getCPackArgs(driver: CMakeDriver, packagePreset?: PackagePreset): Promise<string[] | undefined> {
        let cpackArgs: string[] = [];
        if (!packagePreset && driver.packagePreset) {
            packagePreset = driver.packagePreset;
        }
        if (!driver.useCMakePresets || !packagePreset) {
            return undefined;
        }

        // Note: in CMake Tools, we don't run cmake or cpack with --preset argument. We generate the equivalent command line from all the properties
        cpackArgs = [];
        if (packagePreset.vendorName) {
            cpackArgs.push("--vendor", `${packagePreset.vendorName}`);
        }
        if (packagePreset.generators?.length) {
            cpackArgs.push("-G", `${packagePreset.generators.join(";")}`);
        }
        if (packagePreset.configurations?.length) {
            cpackArgs.push("-C", `${packagePreset.configurations.join(";")}`);
        }
        if (packagePreset.configFile) {
            cpackArgs.push("--config", `${packagePreset.configFile}`);
        }
        if (packagePreset.output?.debug) {
            cpackArgs.push("--debug");
        }
        if (packagePreset.output?.verbose) {
            cpackArgs.push("--verbose");
        }
        if (packagePreset.packageName) {
            cpackArgs.push("-P", `${packagePreset.packageName}`);
        }
        if (packagePreset.packageVersion) {
            cpackArgs.push("-R", `${packagePreset.packageVersion}`);
        }
        if (packagePreset.packageDirectory) {
            cpackArgs.push("-B", `${packagePreset.packageDirectory}`);
        }

        if (packagePreset.variables) {
            for (const varName in packagePreset.variables) {
                cpackArgs.push(`-D ${varName}=${packagePreset.variables[varName]}`);
            }
        }

        const opts = driver.expansionOptions;
        const args = [];
        for (const value of this.ws.config.cpackArgs) {
            args.push(await expandString(value, opts));
        }

        cpackArgs = cpackArgs.concat(args);
        return cpackArgs;
    }

    public async runCPack(driver: CMakeDriver, packagePreset?: PackagePreset, consumer?: proc.OutputConsumer): Promise<number> {
        const cpackpath = await this.ws.getCPackPath(driver.cmakePathFromPreset);
        if (cpackpath === null) {
            log.info(localize('cpack.path.not.set', 'CPath path is not set'));
            return -2;
        }

        let cpackArgs: string[];
        if (driver.useCMakePresets && !driver.packagePreset) {
            log.error(localize('package.preset.not.set', 'Package preset is not set'));
            return -3;
        } else {
            const opts = driver.expansionOptions;
            const args = [];
            for (const value of this.ws.config.cpackArgs) {
                args.push(await expandString(value, opts));
            }

            const configuration = driver.currentBuildType;
            const configs: string = packagePreset?.configurations?.join(";") || configuration;
            const presetArgs = await this.getCPackArgs(driver, packagePreset) || [];
            cpackArgs = [`-C`, configs].concat(presetArgs).concat(args);
        }

        const child = driver.executeCommand(
            cpackpath,
            cpackArgs,
            (consumer ? consumer : new CPackOutputLogger()),
            { environment: await driver.getCPackCommandEnvironment(), cwd: driver.binaryDir });
        const res = await child.result;
        if (res.retc === null) {
            log.info(localize('cpack.run.terminated', 'CPack run was terminated'));
            return -1;
        } else {
            log.info(localize('cpack.finished.with.code', 'CPack finished with return code {0}', res.retc));
        }

        return res.retc;
    }
}

