/**
 * Pure helpers for the build-target selector, kept free of the `vscode` API so the
 * selection/reset logic can be unit-tested directly (see
 * test/unit-tests/backend/build-target-selection.test.ts).
 */

/**
 * Discriminant returned by the target picker when the user chooses to build the targets defined by
 * the active build preset (the default state) rather than pinning a specific target. A unique
 * `Symbol` is used instead of a string so it can never collide with a real CMake target name (which
 * may contain underscores and other characters). It is never persisted.
 */
export const presetTargetsReset: unique symbol = Symbol('presetTargetsReset');

/**
 * Whether the active build preset declares explicit, non-empty targets. An empty `targets: []` is
 * treated as "no explicit targets" because CMake then builds the default target, so there is no
 * concrete target list to offer as a one-shot build.
 */
export function hasExplicitBuildPresetTargets(targets: string | string[] | undefined): boolean {
    return typeof targets === 'string' ? targets.length > 0 : Array.isArray(targets) && targets.length > 0;
}

/**
 * Whether the build-target picker should offer the "[Targets In Preset]" reset entry.
 *
 * Only meaningful in presets mode. When the build preset declares explicit targets, the entry is
 * always useful because it maps to those targets. When it does not, the reset is only safe for the
 * persisted default-target picker (`allowPresetReset`), which clears the stored target; the
 * one-shot build-target picker must not offer it, because with no preset targets it would fall back
 * to the pinned default target instead of the preset default.
 */
export function shouldOfferPresetTargetsReset(useCMakePresets: boolean, allowPresetReset: boolean, hasExplicitPresetTargets: boolean): boolean {
    return useCMakePresets && (allowPresetReset || hasExplicitPresetTargets);
}

/**
 * Resolve the effective build targets from the persisted default target. Mirrors the logic used by
 * `CMakeProject.getDefaultBuildTargets`, extracted here so it can be unit-tested.
 *
 * @param legacyPresetSentinel The localized "[Targets In Preset]" label, which older versions
 *   persisted as the default target; still recognized for backward compatibility.
 */
export function resolveDefaultBuildTargets(
    useCMakePresets: boolean,
    defaultTarget: string | null,
    legacyPresetSentinel: string,
    buildPresetTargets: string | string[] | undefined,
    allTargetName: string
): string[] | undefined {
    let targets: string | string[] | undefined = defaultTarget || undefined;
    if (useCMakePresets && (!defaultTarget || defaultTarget === legacyPresetSentinel)) {
        targets = buildPresetTargets;
    }
    if (!useCMakePresets && !defaultTarget) {
        targets = allTargetName;
    }
    return typeof targets === 'string' ? [targets] : targets;
}
