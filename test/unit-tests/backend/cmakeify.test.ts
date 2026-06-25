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
 * - Booleans become CMake BOOL TRUE/FALSE
 * - String values are passed through verbatim (semicolons keep their natural
 *   CMake list-separator semantics — see issue #4934)
 * - Array values are joined with semicolons to form CMake lists (issue #4503)
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

    test('String with semicolon is passed through verbatim (#4934)', () => {
        // Regression test for #4934: previously the value was escaped to
        // "clang\\;lld" which broke CMAKE_PREFIX_PATH and similar list cache vars.
        const result = cmakeify('clang;lld');
        expect(result.type).to.equal('STRING');
        expect(result.value).to.equal('clang;lld');
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

    test('LLVM_ENABLE_PROJECTS use case - array notation forms CMake list (#4503)', () => {
        const result = cmakeify(['clang', 'lld']);
        expect(result.type).to.equal('STRING');
        expect(result.value).to.equal('clang;lld');
        // Produces: -DLLVM_ENABLE_PROJECTS:STRING=clang;lld
    });

    test('LLVM_ENABLE_PROJECTS use case - string notation also forms CMake list (#4503/#4934)', () => {
        // After the fix, the string notation behaves the same as the array
        // notation for `;`-separated lists.
        const result = cmakeify('clang;lld');
        expect(result.type).to.equal('STRING');
        expect(result.value).to.equal('clang;lld');
        // Produces: -DLLVM_ENABLE_PROJECTS:STRING=clang;lld
    });

    test('CMAKE_PREFIX_PATH semicolon list is passed through cleanly (#4934)', () => {
        const result = cmakeify('C:/work/vcpkg/packages/zlib_x64-windows;C:/work/vcpkg/packages/curl_x64-windows');
        expect(result.type).to.equal('STRING');
        // No `\;` injected — CMake will parse this as a two-element list.
        expect(result.value).to.equal('C:/work/vcpkg/packages/zlib_x64-windows;C:/work/vcpkg/packages/curl_x64-windows');
        expect(result.value).to.not.include('\\;');
    });

    test('Pre-escaped semicolon round-trips for users who want a literal `;` in one element', () => {
        // Users who genuinely want a literal `;` inside a single list element
        // can pre-escape with `\;` in JSON; we no longer transform the string.
        const result = cmakeify('value\\;with\\;semicolons');
        expect(result.type).to.equal('STRING');
        expect(result.value).to.equal('value\\;with\\;semicolons');
    });

    test('BUILD_TESTING boolean kit setting emits BOOL (#4927)', () => {
        // Regression test for #4927: booleans were rejected by the JSON schema
        // after PR #4823. The runtime path always handled booleans correctly —
        // this test pins the BOOL/TRUE shape that the configure command uses.
        const result = cmakeify(true);
        expect(result.type).to.equal('BOOL');
        expect(result.value).to.equal('TRUE');
        // Produces: -DBUILD_TESTING:BOOL=TRUE
    });
});
