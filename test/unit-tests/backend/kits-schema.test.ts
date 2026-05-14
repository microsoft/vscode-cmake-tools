import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import Ajv, { ValidateFunction } from 'ajv';

/**
 * Tests for `schemas/kits-schema.json`, the JSON schema that validates
 * `cmake-kits.json` / `cmake-tools-kits.json` files.
 *
 * Ajv compilation of this schema (via `loadSchema` in `src/schema.ts`) is what
 * #4927 broke when the schema dropped support for boolean values. These tests
 * pin the accepted shape of `cmakeSettings` so future schema edits cannot
 * silently re-break it.
 *
 * The schema is loaded directly from disk and compiled with the same Ajv
 * options as `src/schema.ts:loadSchema`, keeping the test independent of the
 * heavier integration-test harness.
 */

const SCHEMA_PATH = path.resolve(__dirname, '..', '..', '..', 'schemas', 'kits-schema.json');

function loadKitsSchemaValidator(): ValidateFunction {
    const schemaData = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    return new Ajv({ allErrors: true }).compile(schemaData);
}

suite('[kits-schema.json]', () => {
    let validate: ValidateFunction;

    suiteSetup(() => {
        validate = loadKitsSchemaValidator();
    });

    test('Empty kit list is valid', () => {
        expect(validate([])).to.equal(true);
    });

    test('Minimal kit with no cmakeSettings is valid', () => {
        expect(
            validate([{ name: 'Test Kit', compilers: {} }]),
            JSON.stringify(validate.errors)
        ).to.equal(true);
    });

    test('cmakeSettings accepts string values', () => {
        expect(
            validate([{ name: 'k', compilers: {}, cmakeSettings: { CMAKE_CXX_STANDARD: '20' } }]),
            JSON.stringify(validate.errors)
        ).to.equal(true);
    });

    test('cmakeSettings accepts boolean values (regression #4927)', () => {
        expect(
            validate([{ name: 'k', compilers: {}, cmakeSettings: { BUILD_TESTING: true, BUILD_FUZZING: false } }]),
            JSON.stringify(validate.errors)
        ).to.equal(true);
    });

    test('cmakeSettings accepts number values', () => {
        expect(
            validate([{ name: 'k', compilers: {}, cmakeSettings: { MY_INT: 42 } }]),
            JSON.stringify(validate.errors)
        ).to.equal(true);
    });

    test('cmakeSettings accepts string-array values (regression #4503/PR #4823)', () => {
        expect(
            validate([{ name: 'k', compilers: {}, cmakeSettings: { LLVM_ENABLE_PROJECTS: ['clang', 'lld'] } }]),
            JSON.stringify(validate.errors)
        ).to.equal(true);
    });

    test('cmakeSettings accepts a mix of all supported value types', () => {
        expect(
            validate([{
                name: 'k', compilers: {}, cmakeSettings: {
                    CMAKE_CXX_STANDARD: '20',
                    BUILD_TESTING: true,
                    MY_INT: 42,
                    LLVM_ENABLE_PROJECTS: ['clang', 'lld']
                }
            }]),
            JSON.stringify(validate.errors)
        ).to.equal(true);
    });

    test('cmakeSettings rejects null values', () => {
        expect(validate([{ name: 'k', compilers: {}, cmakeSettings: { FOO: null } }])).to.equal(false);
    });

    test('cmakeSettings rejects object values', () => {
        expect(validate([{ name: 'k', compilers: {}, cmakeSettings: { FOO: { bar: 'baz' } } }])).to.equal(false);
    });
});
