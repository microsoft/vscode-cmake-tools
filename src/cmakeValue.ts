/**
 * Pure utility functions for CMake value conversion.
 * This module has NO dependencies on 'vscode' or 'vscode-nls', making it safe
 * to import in backend tests that cannot load the vscode module.
 */

/**
 * Represents a CMake cache variable value with its type.
 */
export interface CMakeValue {
    type: ('UNKNOWN' | 'BOOL' | 'STRING' | 'FILEPATH' | 'PATH' | '');  // There are more types, but we don't care ATM
    value: string;
}

/**
 * Escape a string so it can be used as a regular expression
 */
function escapeStringForRegex(str: string): string {
    return str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, '\\$1');
}

/**
 * Replace all occurrences of `needle` in `str` with `what`
 */
function replaceAll(str: string, needle: string, what: string): string {
    const pattern = escapeStringForRegex(needle);
    const re = new RegExp(pattern, 'g');
    return str.replace(re, what);
}

/**
 * Checks if the given value is a string.
 */
function isString(x: unknown): x is string {
    return Object.prototype.toString.call(x) === "[object String]";
}

/**
 * Converts a given value to a CMake-compatible value.
 *
 * **Semicolon Handling:**
 * - **String values**: Semicolons are escaped (`;` → `\;`) to prevent CMake from
 *   interpreting them as list separators. Use this for single values that happen
 *   to contain semicolons.
 * - **Array values**: Elements are joined with semicolons WITHOUT escaping,
 *   producing a proper CMake list. Use this when you intentionally want a CMake
 *   list (e.g., `LLVM_ENABLE_PROJECTS`).
 *
 * @param value The value to convert. Can be:
 *   - `boolean`: Converts to CMake BOOL ("TRUE" or "FALSE")
 *   - `string`: Converts to STRING with semicolons escaped
 *   - `number`: Converts to STRING
 *   - `string[]`: Joins elements with `;` to form a CMake list (no escaping)
 *   - `CMakeValue`: Passes through unchanged
 * @returns A CMakeValue object with the appropriate type and value.
 * @throws An error if the input value is invalid or cannot be converted.
 *
 * @example
 * // String with semicolon - ESCAPED (for single values containing semicolons)
 * cmakeify("clang;lld")
 * // Returns: { type: 'STRING', value: 'clang\\;lld' }
 * // Produces: -DVAR:STRING=clang\;lld
 *
 * @example
 * // Array - NOT escaped (for CMake lists)
 * cmakeify(["clang", "lld"])
 * // Returns: { type: 'STRING', value: 'clang;lld' }
 * // Produces: -DVAR:STRING=clang;lld (a proper CMake list)
 */
export function cmakeify(value: (string | boolean | number | string[] | CMakeValue)): CMakeValue {
    const ret: CMakeValue = {
        type: 'UNKNOWN',
        value: ''
    };
    if (value === true || value === false) {
        ret.type = 'BOOL';
        ret.value = value ? 'TRUE' : 'FALSE';
    } else if (isString(value)) {
        ret.type = 'STRING';
        // String values have semicolons escaped to prevent CMake list interpretation
        ret.value = replaceAll(value, ';', '\\;');
    } else if (typeof value === 'number') {
        ret.type = 'STRING';
        ret.value = value.toString();
    } else if (value instanceof Array) {
        ret.type = 'STRING';
        // Array values are joined with semicolons WITHOUT escaping to form CMake lists
        ret.value = value.join(';');
    } else if (Object.getOwnPropertyNames(value).filter(e => e === 'type' || e === 'value').length === 2) {
        ret.type = value.type;
        ret.value = value.value;
    } else {
        throw new Error(`Invalid value to convert to cmake value: ${JSON.stringify(value)}`);
    }
    return ret;
}
