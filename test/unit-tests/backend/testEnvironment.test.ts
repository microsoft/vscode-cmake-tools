import { expect } from 'chai';

/**
 * Mirror of the pure parsing logic from CTestDriver.testEnvironment().
 * Parses CTest ENVIRONMENT property values (string or string[]) into a { KEY: VALUE } map.
 * CTest JSON v1 stores a single environment variable as a plain string, multiple as an array.
 */
function parseTestEnvironment(envEntries: string | string[]): { [key: string]: string } {
    const env: { [key: string]: string } = {};
    const entries = Array.isArray(envEntries) ? envEntries : [envEntries];
    for (const entry of entries) {
        const eqIndex = entry.indexOf('=');
        if (eqIndex !== -1) {
            const name = entry.substring(0, eqIndex);
            const value = entry.substring(eqIndex + 1);
            env[name] = value;
        }
    }
    return env;
}

/**
 * Mirror of CTestDriver.replaceValueInObject().
 * Recursively replaces string values exactly matching `str` with `replace`.
 */
function replaceValueInObject<T>(obj: any, str: string, replace: any): T {
    if (typeof obj === 'string' && obj === str) {
        return replace;
    } else if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            obj[i] = replaceValueInObject(obj[i], str, replace);
        }
    } else if (typeof obj === 'object' && obj !== null) {
        for (const key of Object.keys(obj)) {
            obj[key] = replaceValueInObject(obj[key], str, replace);
        }
    }
    return obj;
}

suite('[CTest test environment parsing]', () => {
    test('Parse basic KEY=VALUE entries', () => {
        const result = parseTestEnvironment(['A=B', 'C=D']);
        expect(result).to.deep.equal({ A: 'B', C: 'D' });
    });

    test('Parse entries with values containing equals signs', () => {
        const result = parseTestEnvironment(['PATH=/usr/bin:/usr/local/bin', 'FLAGS=-O2 -DFOO=BAR']);
        expect(result).to.deep.equal({
            PATH: '/usr/bin:/usr/local/bin',
            FLAGS: '-O2 -DFOO=BAR'
        });
    });

    test('Parse LD_LIBRARY_PATH entry', () => {
        const result = parseTestEnvironment(['LD_LIBRARY_PATH=/some/lib:/other/lib']);
        expect(result).to.deep.equal({ LD_LIBRARY_PATH: '/some/lib:/other/lib' });
    });

    test('Skip entries without equals sign', () => {
        const result = parseTestEnvironment(['VALID=value', 'NOEQUALSSIGN', 'ALSO_VALID=123']);
        expect(result).to.deep.equal({ VALID: 'value', ALSO_VALID: '123' });
    });

    test('Handle empty array', () => {
        const result = parseTestEnvironment([]);
        expect(result).to.deep.equal({});
    });

    test('Handle entry with empty value', () => {
        const result = parseTestEnvironment(['KEY=']);
        expect(result).to.deep.equal({ KEY: '' });
    });

    test('Handle entry with empty key', () => {
        const result = parseTestEnvironment(['=value']);
        expect(result).to.deep.equal({ '': 'value' });
    });

    test('Parse single string value (CTest JSON v1 single-entry format)', () => {
        const result = parseTestEnvironment('MY_VAR=hello_world');
        expect(result).to.deep.equal({ MY_VAR: 'hello_world' });
    });
});

suite('[replaceValueInObject]', () => {
    test('Replace string placeholder at top level', () => {
        const obj = { environment: '${cmake.testEnvironment}' };
        const replacement = [{ name: 'A', value: 'B' }];
        const result = replaceValueInObject(obj, '${cmake.testEnvironment}', replacement);
        expect(result).to.deep.equal({ environment: [{ name: 'A', value: 'B' }] });
    });

    test('Replace placeholder nested in object', () => {
        const obj = {
            name: 'test',
            config: {
                program: '/path/to/test',
                environment: '${cmake.testEnvironment}'
            }
        };
        const replacement = [{ name: 'X', value: 'Y' }, { name: 'Z', value: 'W' }];
        const result = replaceValueInObject(obj, '${cmake.testEnvironment}', replacement);
        expect(result).to.deep.equal({
            name: 'test',
            config: {
                program: '/path/to/test',
                environment: [{ name: 'X', value: 'Y' }, { name: 'Z', value: 'W' }]
            }
        });
    });

    test('Do not replace partial string matches', () => {
        const obj = { value: 'prefix${cmake.testEnvironment}suffix' };
        const replacement = [{ name: 'A', value: 'B' }];
        const result = replaceValueInObject(obj, '${cmake.testEnvironment}', replacement);
        expect(result).to.deep.equal({ value: 'prefix${cmake.testEnvironment}suffix' });
    });

    test('Replace placeholder in array element', () => {
        const obj = { items: ['keep', '${cmake.testEnvironment}', 'also-keep'] };
        const replacement = [{ name: 'A', value: 'B' }];
        const result = replaceValueInObject(obj, '${cmake.testEnvironment}', replacement);
        expect(result).to.deep.equal({ items: ['keep', [{ name: 'A', value: 'B' }], 'also-keep'] });
    });

    test('Handle empty replacement array', () => {
        const obj = { environment: '${cmake.testEnvironment}' };
        const result = replaceValueInObject(obj, '${cmake.testEnvironment}', []);
        expect(result).to.deep.equal({ environment: [] });
    });

    test('Leave unrelated strings untouched', () => {
        const obj = { program: '${cmake.testProgram}', environment: '${cmake.testEnvironment}' };
        const replacement = [{ name: 'A', value: 'B' }];
        const result = replaceValueInObject(obj, '${cmake.testEnvironment}', replacement);
        expect(result).to.deep.equal({
            program: '${cmake.testProgram}',
            environment: [{ name: 'A', value: 'B' }]
        });
    });
});
