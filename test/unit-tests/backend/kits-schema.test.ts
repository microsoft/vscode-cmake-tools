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

// Walk up from `__dirname` to locate `schemas/kits-schema.json`. This keeps the
// test invariant under both invocation modes: `yarn backendTests` runs ts-node
// directly from `test/unit-tests/backend/`, while `yarn unitTests` runs the
// compiled file from `out/test/unit-tests/backend/` — the two modes have
// different relative depths to the repo root.
function findSchemaPath(): string {
    let dir = __dirname;
    while (dir !== path.dirname(dir)) {
        const candidate = path.join(dir, 'schemas', 'kits-schema.json');
        if (fs.existsSync(candidate)) {
            return candidate;
        }
        dir = path.dirname(dir);
    }
    throw new Error(`Could not locate schemas/kits-schema.json walking up from ${__dirname}`);
}

const SCHEMA_PATH = findSchemaPath();

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
