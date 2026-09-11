export interface VsInstanceCandidate {
    installationVersion: string;
    availableToolsets?: readonly string[];
    hasVcVars: boolean;
}

export interface VsInstanceRequirements {
    vendorVsVersion?: number;
    toolsetVersion?: string;
    vsGeneratorVersion?: number;
}

export function matchesVsInstance(candidate: VsInstanceCandidate, requirements: VsInstanceRequirements): boolean {
    const { vendorVsVersion, toolsetVersion, vsGeneratorVersion } = requirements;
    if (!candidate.hasVcVars) {
        return false;
    }
    if (vendorVsVersion && !candidate.installationVersion.startsWith(vendorVsVersion.toString())) {
        return false;
    }
    if (toolsetVersion) {
        return candidate.availableToolsets?.some(toolset => toolset.startsWith(toolsetVersion)) ?? false;
    }
    // An explicit vendor pin retains precedence over the generator's default version.
    return !!vendorVsVersion || !vsGeneratorVersion || candidate.installationVersion.startsWith(vsGeneratorVersion.toString());
}
