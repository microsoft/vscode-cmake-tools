/**
 * Pure helpers for selecting the CMake executable bundled with a specific Visual Studio instance.
 * Kept free of the `vscode` API (only depends on `path`) so the path derivation and the override
 * decision can be unit-tested directly (see test/unit-tests/backend/vs-instance-cmake.test.ts).
 */
import * as path from 'path';

/**
 * Derive the path to the CMake executable bundled with a Visual Studio installation.
 */
export function vsBundledCMakePath(vsInstallationPath: string): string {
    return path.join(vsInstallationPath, 'Common7', 'IDE', 'CommonExtensions', 'Microsoft', 'CMake', 'CMake', 'bin', 'cmake.exe');
}

export interface PinnedVsInstanceCMakeContext {
    /** `process.platform`. */
    platform: NodeJS.Platform;
    /** Whether the project is using CMake Presets. */
    useCMakePresets: boolean;
    /** The active configure preset's `cmakeExecutable`, if any (an explicit user pin). */
    presetCMakeExecutable: string | undefined;
    /** The raw `cmake.cmakePath` setting value (default `"cmake"`). */
    rawCMakePath: string;
    /** Install path of the VS instance pinned via `vsInstanceVersion`, if one was resolved. */
    vsInstallPath: string | undefined;
}

/**
 * Whether CMake discovery should be overridden with the CMake bundled inside the Visual Studio
 * instance that was pinned via the `vsInstanceVersion` vendor field.
 *
 * This is only appropriate on Windows, in presets mode, when a VS instance was pinned, and when the
 * user has NOT pinned CMake themselves — neither through the preset's `cmakeExecutable` nor through
 * an explicit `cmake.cmakePath` setting (i.e. it is still the default `"cmake"`/`"auto"`). In every
 * other case the normal resolution order (PATH → Program Files → latest VS) is preserved.
 *
 * The existence of the bundled executable is checked separately by the caller so this stays pure.
 */
export function shouldUsePinnedVsInstanceCMake(ctx: PinnedVsInstanceCMakeContext): boolean {
    return ctx.platform === 'win32'
        && ctx.useCMakePresets
        && !ctx.presetCMakeExecutable
        && (ctx.rawCMakePath === 'cmake' || ctx.rawCMakePath === 'auto')
        && !!ctx.vsInstallPath;
}
