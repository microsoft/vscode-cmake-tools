import { expect } from 'chai';
import { cmakeify, CMakeValue } from '@cmt/cmakeValue';

/**
 * Tests for the cmakeify function that converts values to CMake cache variable format.
 *
 * This tests the REAL implementation from @cmt/cmakeValue (not a mirrored copy).
 * The cmakeValue module is pure TypeScript with no vscode dependencies, making it
 * safe to import in backend tests.
 *
 * Key behavior tested:
 * - String values have semicolons ESCAPED (`;` → `\;`) to prevent CMake list interpretation
 * - Array values are joined with semicolons WITHOUT escaping to form CMake lists
 */

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
