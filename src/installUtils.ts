/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Parse install component names from cmake_install.cmake file content.
 * Extracts component names from `if(CMAKE_INSTALL_COMPONENT STREQUAL "<name>")` blocks.
 */
export function parseInstallComponentsFromContent(content: string): string[] {
    const regex = /if\(CMAKE_INSTALL_COMPONENT\s+STREQUAL\s+"([^"]+)"/g;
    const components = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
        components.add(match[1]);
    }
    return Array.from(components).sort();
}

/**
 * Check whether cmake --install output indicates a permission/access error.
 * Used to provide an actionable hint to the user.
 */
export function containsPermissionError(output: string): boolean {
    const lower = output.toLowerCase();
    return lower.includes('permission') || lower.includes('access is denied') || lower.includes('cannot create directory');
}
