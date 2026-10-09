/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface CTestExecutableTarget {
    name: string;
    path: string;
    isInstallTarget?: boolean;
}

export interface CTestBuildTargetResolution {
    targets: string[];
    unresolvedPrograms: string[];
}

export function executableTargetNamesByPath(executableTargets: CTestExecutableTarget[], normalizePath: (path: string) => string): Map<string, string> {
    const execPathToName = new Map<string, string>();
    for (const target of executableTargets) {
        if (!target.isInstallTarget) {
            execPathToName.set(normalizePath(target.path), target.name);
        }
    }
    return execPathToName;
}

export function resolveTestBuildTargets(testPrograms: Iterable<string>, executableTargets: CTestExecutableTarget[], normalizePath: (path: string) => string): CTestBuildTargetResolution {
    const execPathToName = executableTargetNamesByPath(executableTargets, normalizePath);
    const targets = new Set<string>();
    const unresolvedPrograms: string[] = [];

    for (const program of testPrograms) {
        const targetName = execPathToName.get(normalizePath(program));
        if (targetName) {
            targets.add(targetName);
        } else {
            unresolvedPrograms.push(program);
        }
    }

    return {
        targets: [...targets],
        unresolvedPrograms
    };
}
