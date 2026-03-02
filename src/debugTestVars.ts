/**
 * Resolve cmake test variables in debug launch configuration values.
 * Handles ${cmake.testProgram}, ${cmake.testArgs}, and ${cmake.testWorkingDirectory}.
 *
 * This module is kept free of vscode dependencies so it can be tested
 * in backend (pure Node) unit tests.
 */

export interface TestInfo {
    program: string;
    args: string[];
    workingDirectory: string;
}

/**
 * Recursively resolve cmake test variable placeholders in a value.
 *
 * - Strings: `${cmake.testProgram}` and `${cmake.testWorkingDirectory}` are
 *   replaced inline.
 * - Arrays: an element equal to `${cmake.testArgs}` is expanded into the
 *   individual test arguments.
 * - Objects: each property value is resolved recursively.
 * - Other types are returned as-is.
 */
export function resolveTestVariables(value: any, testInfo: TestInfo): any {
    if (typeof value === 'string') {
        return value
            .replace(/\$\{cmake\.testProgram\}/g, testInfo.program)
            .replace(/\$\{cmake\.testWorkingDirectory\}/g, testInfo.workingDirectory);
    }
    if (Array.isArray(value)) {
        const result: any[] = [];
        for (const item of value) {
            if (typeof item === 'string' && item.trim() === '${cmake.testArgs}') {
                // Expand ${cmake.testArgs} into individual array elements
                result.push(...testInfo.args);
            } else {
                result.push(resolveTestVariables(item, testInfo));
            }
        }
        return result;
    }
    if (typeof value === 'object' && value !== null) {
        const result: any = {};
        for (const key of Object.keys(value)) {
            result[key] = resolveTestVariables(value[key], testInfo);
        }
        return result;
    }
    return value;
}
