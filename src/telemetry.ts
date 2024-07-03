/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as util from './util';
import * as vscode from 'vscode';
import TelemetryReporter from '@vscode/extension-telemetry';
import { getExperimentationServiceAsync, IExperimentationService, IExperimentationTelemetry, TargetPopulation } from 'vscode-tas-client';

export type Properties = { [key: string]: string };
export type Measures = { [key: string]: number };

interface IPackageInfo {
    name: string;
    version: string;
    aiKey: string;
}

export class ExperimentationTelemetry implements IExperimentationTelemetry {
    private sharedProperties: Record<string, string> = {};

    constructor(private baseReporter: TelemetryReporter) {}

    sendTelemetryEvent(eventName: string, properties?: Record<string, string>, measurements?: Record<string, number>): void {
        this.baseReporter.sendTelemetryEvent(
            eventName,
            {
                ...this.sharedProperties,
                ...properties
            },
            measurements
        );
    }

    sendTelemetryErrorEvent(eventName: string, properties?: Record<string, string>, _measurements?: Record<string, number>): void {
        this.baseReporter.sendTelemetryErrorEvent(eventName, {
            ...this.sharedProperties,
            ...properties
        });
    }

    setSharedProperty(name: string, value: string): void {
        this.sharedProperties[name] = value;
    }

    postEvent(eventName: string, props: Map<string, string>): void {
        const event: Record<string, string> = {};
        for (const [key, value] of props) {
            event[key] = value;
        }
        this.sendTelemetryEvent(eventName, event);
    }

    dispose(): Promise<any> {
        return this.baseReporter.dispose();
    }
}

let initializationPromise: Promise<IExperimentationService> | undefined;
let experimentationTelemetry: ExperimentationTelemetry | undefined;

export function activate(extensionContext: vscode.ExtensionContext): void {
    try {
        if (extensionContext) {
            const packageInfo: IPackageInfo = getPackageInfo();
            if (packageInfo) {
                const targetPopulation: TargetPopulation = TargetPopulation.Public;
                experimentationTelemetry = new ExperimentationTelemetry(new TelemetryReporter(appInsightsKey));
                initializationPromise = getExperimentationServiceAsync(packageInfo.name, packageInfo.version, targetPopulation, experimentationTelemetry, extensionContext.globalState);
            }
        }
    } catch (e) {
        // Handle error with a try/catch, but do nothing for errors.
    }
}

export function sendOpenTelemetry(telemetryProperties: Properties): void {
    const targetPopulation: TargetPopulation = util.getCmakeToolsTargetPopulation();
    switch (targetPopulation) {
        case TargetPopulation.Public:
            telemetryProperties['targetPopulation'] = "Public";
            break;
        case TargetPopulation.Internal:
            telemetryProperties['targetPopulation'] = "Internal";
            break;
        case TargetPopulation.Insiders:
            telemetryProperties['targetPopulation'] = "Insiders";
            break;
        default:
            break;
    }
    logEvent('open', telemetryProperties);
}

export function getExperimentationService(): Promise<IExperimentationService | undefined> | undefined {
    return initializationPromise;
}

export async function deactivate(): Promise<void> {
    if (initializationPromise) {
        try {
            await initializationPromise;
        } catch (e) {
            // Continue even if we were not able to initialize the experimentation platform.
        }
    }
    if (experimentationTelemetry) {
        await experimentationTelemetry.dispose();
    }
}

export function logEvent(eventName: string, properties?: Properties, measures?: Measures): void {
    const sendTelemetry = () => {
        if (experimentationTelemetry) {
            experimentationTelemetry.sendTelemetryEvent(eventName, properties, measures);
        }
    };

    if (initializationPromise) {
        try {
            void initializationPromise.then(sendTelemetry);
            return;
        } catch (e) {
            // Send telemetry even if we were not able to initialize the experimentation platform.
        }
    }
    sendTelemetry();
}

const appInsightsKey: string = "AIF-d9b70cd4-b9f9-4d70-929b-a071c400b217";
function getPackageInfo(): IPackageInfo {
    const packageJSON: util.PackageJSON = util.thisExtensionPackage();
    return {
        name: `${packageJSON.publisher}.${packageJSON.name}`,
        version: packageJSON.version,
        aiKey: appInsightsKey
    };
}
