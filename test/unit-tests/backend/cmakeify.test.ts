import { expect } from 'chai';

/**
 * Mirrored CMakeValue interface for standalone testing without vscode dependency.
 * This matches the interface from @cmt/util.
 */
interface CMakeValue {
    type: ('UNKNOWN' | 'BOOL' | 'STRING' | 'FILEPATH' | 'PATH' | '');
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
function replaceAll(str: string, needle: string, what: string) {
    const pattern = escapeStringForRegex(needle);
    const re = new RegExp(pattern, 'g');
    return str.replace(re, what);
}

/**
 * Check if a value is a string
 */
function isString(value: unknown): value is string {
    return typeof value === 'string';
}

/**
 * Mirrored cmakeify function for standalone testing.
 * This matches the logic from src/util.ts cmakeify() function.
 */
function cmakeify(value: (string | boolean | number | string[] | CMakeValue)): CMakeValue {
    const ret: CMakeValue = {
        type: 'UNKNOWN',
        value: ''
    };
    if (value === true || value === false) {
        ret.type = 'BOOL';
        ret.value = value ? 'TRUE' : 'FALSE';
    } else if (isString(value)) {
        ret.type = 'STRING';
        ret.value = replaceAll(value, ';', '\\;');
    } else if (typeof value === 'number') {
        ret.type = 'STRING';
        ret.value = value.toString();
    } else if (value instanceof Array) {
        ret.type = 'STRING';
        ret.value = value.join(';');
    } else if (Object.getOwnPropertyNames(value).filter(e => e === 'type' || e === 'value').length === 2) {
        ret.type = value.type;
        ret.value = value.value;
    } else {
        throw new Error(`Invalid value to convert to cmake value: ${JSON.stringify(value)}`);
    }
    return ret;
}

suite('[cmakeify]', () => {

    test('Boolean true converts to BOOL TRUE', () => {
        const result = cmakeify(true);
        expect(result.type).to.equal('BOOL');
        expect(result.value).to.equal('TRUE');
    });

    test('Boolean false converts to BOOL FALSE', () => {
        const result = cmakeify(false);
        expect(result.type).to.equal('BOOL');
        expect(result.value).to.equal('FALSE');
    });

    test('Simple string converts to STRING', () => {
        const result = cmakeify('hello');
        expect(result.type).to.equal('STRING');
        expect(result.value).to.equal('hello');
    });

    test('String with semicolon is escaped', () => {
        const result = cmakeify('clang;lld');
        expect(result.type).to.equal('STRING');
        expect(result.value).to.equal('clang\\;lld');
    });

    test('Number converts to STRING', () => {
        const result = cmakeify(42);
        expect(result.type).to.equal('STRING');
        expect(result.value).to.equal('42');
    });

    test('String array joins with semicolons without escaping', () => {
        const result = cmakeify(['clang', 'lld']);
        expect(result.type).to.equal('STRING');
        expect(result.value).to.equal('clang;lld');
    });

    test('String array with multiple elements creates CMake list', () => {
        const result = cmakeify(['clang', 'lld', 'compiler-rt', 'libcxx']);
        expect(result.type).to.equal('STRING');
        expect(result.value).to.equal('clang;lld;compiler-rt;libcxx');
    });

    test('Empty array produces empty string', () => {
        const result = cmakeify([]);
        expect(result.type).to.equal('STRING');
        expect(result.value).to.equal('');
    });

    test('Single element array produces single value', () => {
        const result = cmakeify(['clang']);
        expect(result.type).to.equal('STRING');
        expect(result.value).to.equal('clang');
    });

    test('CMakeValue passthrough preserves type and value', () => {
        const input: CMakeValue = { type: 'FILEPATH', value: '/path/to/file' };
        const result = cmakeify(input);
        expect(result.type).to.equal('FILEPATH');
        expect(result.value).to.equal('/path/to/file');
    });

    test('LLVM_ENABLE_PROJECTS use case - array notation avoids escaping', () => {
        // This is the main use case from issue #4503
        const result = cmakeify(['clang', 'lld']);
        expect(result.type).to.equal('STRING');
        // Array notation should NOT escape semicolons - they are joined directly
        expect(result.value).to.equal('clang;lld');
        // This would produce: -DLLVM_ENABLE_PROJECTS:STRING=clang;lld
    });

    test('LLVM_ENABLE_PROJECTS use case - string notation escapes semicolons', () => {
        // When using string notation, semicolons are escaped
        const result = cmakeify('clang;lld');
        expect(result.type).to.equal('STRING');
        // String notation DOES escape semicolons
        expect(result.value).to.equal('clang\\;lld');
        // This would produce: -DLLVM_ENABLE_PROJECTS:STRING=clang\;lld
    });
});
