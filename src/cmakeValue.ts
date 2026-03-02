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
 * Checks if the given value is a string.
 */
function isString(x: unknown): x is string {
    return Object.prototype.toString.call(x) === "[object String]";
}

/**
 * Converts a given value to a CMake-compatible value.
 *
 * **Semicolon Handling:**
 * - **String values**: Passed through verbatim. CMake itself decides whether to
 *   treat embedded `;` as list separators (this matches CMake conventions and
 *   how CMake Presets cache variables behave). Users who genuinely need a
 *   literal `;` inside a single list element can pre-escape it as `\;` in JSON.
 * - **Array values**: Elements are joined with `;` to form a proper CMake list.
 *   Use this when you want a declarative, JSON-native way to express a list
 *   (e.g., `LLVM_ENABLE_PROJECTS`).
 *
 * @param value The value to convert. Can be:
 *   - `boolean`: Converts to CMake BOOL ("TRUE" or "FALSE")
 *   - `string`: Converts to STRING, passed through unchanged
 *   - `number`: Converts to STRING
 *   - `string[]`: Joins elements with `;` to form a CMake list
 *   - `CMakeValue`: Passes through unchanged
 * @returns A CMakeValue object with the appropriate type and value.
 * @throws An error if the input value is invalid or cannot be converted.
 *
 * @example
 * // String with semicolons — passed through (CMake sees a list)
 * cmakeify("clang;lld")
 * // Returns: { type: 'STRING', value: 'clang;lld' }
 * // Produces: -DVAR:STRING=clang;lld (a proper CMake list)
 *
 * @example
 * // Array — joined with semicolons (also a CMake list)
 * cmakeify(["clang", "lld"])
 * // Returns: { type: 'STRING', value: 'clang;lld' }
 * // Produces: -DVAR:STRING=clang;lld
 *
 * @example
 * // Boolean — emitted as CMake BOOL
 * cmakeify(true)
 * // Returns: { type: 'BOOL', value: 'TRUE' }
 * // Produces: -DVAR:BOOL=TRUE
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
        // String values are passed through verbatim; CMake treats `;` as a list
        // separator natively. Users who need a literal `;` can pre-escape as `\;`.
        ret.value = value;
    } else if (typeof value === 'number') {
        ret.type = 'STRING';
        ret.value = value.toString();
    } else if (value instanceof Array) {
        ret.type = 'STRING';
        // Array values are joined with semicolons to form CMake lists.
        ret.value = value.join(';');
    } else if (Object.getOwnPropertyNames(value).filter(e => e === 'type' || e === 'value').length === 2) {
        ret.type = value.type;
        ret.value = value.value;
    } else {
        // Note: This error message is not localized because this module must remain
        // free of vscode-nls dependencies to support import in backend unit tests.
        // This error is rare (only occurs with malformed input) and primarily aids debugging.
        throw new Error(`Invalid value to convert to cmake value: ${JSON.stringify(value)}`);
    }
    return ret;
}
