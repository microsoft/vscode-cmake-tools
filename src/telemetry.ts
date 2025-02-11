/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as util from '@cmt/util';
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

/**
 * Activates the telemetry service for the extension.
 * Initializes the experimentation service and telemetry reporter.
 * @param extensionContext The extension context provided by VS Code.
 */
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

/**
 * Sends telemetry data when the extension is opened.
 * Adds the target population to the telemetry properties and logs the event.
 * @param telemetryProperties The properties to include in the telemetry event.
 */
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

/**
 * Gets the experimentation service instance.
 * @returns A promise that resolves to the experimentation service instance, or undefined if not initialized.
 */
export function getExperimentationService(): Promise<IExperimentationService | undefined> | undefined {
    return initializationPromise;
}

/**
 * Deactivates the telemetry service for the extension.
 * Waits for the initialization promise to resolve and disposes of the telemetry reporter.
 */
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

/**
 * Logs a telemetry event with the specified name, properties, and measures.
 * @param eventName The name of the event to log.
 * @param properties Optional properties to include in the telemetry event.
 * @param measures Optional measures to include in the telemetry event.
 */
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

const appInsightsKey: string =
    "0c6ae279ed8443289764825290e4f9e2-1a736e7c-1324-4338-be46-fc2a58ae4d14-7255";

/**
 * Retrieves package information for the extension.
 * This includes the name, version, and Application Insights key.
 * @returns An object containing the package information.
 */
function getPackageInfo(): IPackageInfo {
    const packageJSON: util.PackageJSON = util.thisExtensionPackage();
    return {
        name: `${packageJSON.publisher}.${packageJSON.name}`,
        version: packageJSON.version,
        aiKey: appInsightsKey
    };
}
