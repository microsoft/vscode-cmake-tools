/**
 * Utilities for discovering install component names from generated
 * `cmake_install.cmake` scripts.
 *
 * CMake does not expose install component names through the File API, so the
 * only reliable source is the generated install scripts, which contain
 * `CMAKE_INSTALL_COMPONENT STREQUAL "<name>"` guards for every component
 * (including FILES-based installs that the File API omits).
 *
 * This module is intentionally free of any `vscode` dependency so that the
 * parsing logic can be unit tested directly.
 */

const componentRegex = /CMAKE_INSTALL_COMPONENT STREQUAL "([^"]+)"/g;

/**
 * Extract the unique, sorted install component names referenced in the given
 * `cmake_install.cmake` script contents.
 *
 * @param scriptContents The textual contents of one or more
 * `cmake_install.cmake` scripts.
 * @returns The de-duplicated component names, sorted alphabetically.
 */
export function parseInstallComponents(scriptContents: string[]): string[] {
    const components = new Set<string>();
    for (const contents of scriptContents) {
        // Reset lastIndex since the regex is defined with the global flag.
        componentRegex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = componentRegex.exec(contents)) !== null) {
            components.add(match[1]);
        }
    }
    return [...components].sort((a, b) => a.localeCompare(b));
}
