import * as telemetry from "@cmt/telemetry";

export enum DebugOrigin {
    originatedFromLaunchConfiguration = "launchConfiguration",
    originatedFromCommand = "command"
}

export function logCMakeDebuggerTelemetry(origin: string, debugType: string) {
    telemetry.logEvent("cmakeDebugger", {
        origin,
        debugType
    });
}
