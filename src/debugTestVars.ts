/**
 * Resolves CMake test variable placeholders in a debug configuration.
 *
 * The following variables are supported:
 * - `${cmake.testProgram}` - Resolves to the path of the test executable
 * - `${cmake.testArgs}` - Resolves to the test arguments
 * - `${cmake.testWorkingDirectory}` - Resolves to the test working directory
 */

export interface TestInfo {
    program: string;
    args: string[];
    workingDirectory: string;
}

/**
 * Recursively resolves test variables in a value.
 */
function resolveValue(value: any, testInfo: TestInfo): any {
    if (typeof value === 'string') {
        return value
            .replace(/\$\{cmake\.testProgram\}/g, testInfo.program)
            .replace(/\$\{cmake\.testWorkingDirectory\}/g, testInfo.workingDirectory);
    }
    if (Array.isArray(value)) {
        const result: any[] = [];
        for (const item of value) {
            if (typeof item === 'string' && item === '${cmake.testArgs}') {
                // Expand ${cmake.testArgs} into individual array elements
                result.push(...testInfo.args);
            } else {
                result.push(resolveValue(item, testInfo));
            }
        }
        return result;
    }
    if (value !== null && typeof value === 'object') {
        const result: { [key: string]: any } = {};
        for (const key of Object.keys(value)) {
            result[key] = resolveValue(value[key], testInfo);
        }
        return result;
    }
    return value;
}

/**
 * Resolves cmake.testProgram, cmake.testArgs, and cmake.testWorkingDirectory
 * variables in a debug configuration object.
 */
export function resolveTestVariables(config: any, testInfo: TestInfo): any {
    return resolveValue(config, testInfo);
}
