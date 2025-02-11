import * as telemetry from "@cmt/telemetry";

export enum DebugOrigin {
    originatedFromLaunchConfiguration = "launchConfiguration",
    originatedFromCommand = "command"
}

/**
 * Logs telemetry data for the CMake debugger.
 *
 * @param origin - The origin of the telemetry event.
 * @param debugType - The type of debugging event.
 */
export function logCMakeDebuggerTelemetry(origin: string, debugType: string) {
    telemetry.logEvent("cmakeDebugger", {
        origin,
        debugType
    });
}
