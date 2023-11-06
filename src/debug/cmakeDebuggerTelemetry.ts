import * as telemetry from "@cmt/telemetry";

export const originatedFromLaunchConfiguration: string = "launchConfiguration";

export function logCMakeDebuggerTelemetry(origin: string, debugType: string) {
    telemetry.logEvent("cmakeDebugger", {
        origin,
        debugType
    });
}
