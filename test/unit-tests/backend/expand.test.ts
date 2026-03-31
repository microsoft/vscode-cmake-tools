import { expect } from 'chai';

/**
 * Tests for the pure utility functions in src/expand.ts.
 *
 * The copilot-instructions.md explicitly states: "Variable expansion:
 * src/expand.ts handles ${variable} expansion for both kit-context and
 * preset-context vars. Changes here need unit tests."
 *
 * These functions are mirrored here because expand.ts transitively depends
 * on 'vscode', which cannot be imported in backend tests.
 */

// --- Mirror of expand.substituteAll ---
function substituteAll(input: string, subs: Map<string, string>) {
    let finalString = input;
    let didReplacement = false;
    subs.forEach((value, key) => {
        if (value !== key) {
            const pattern = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(pattern, 'g');
            finalString = finalString.replace(re, value);
            didReplacement = true;
        }
    });
    return { result: finalString, didReplacement };
}

// --- Mirror of expand.getParentEnvSubstitutions ---
// (simplified: no fixPaths, which is Windows-only path normalization)
function getParentEnvSubstitutions(input: string, subs: Map<string, string>, penvOverride?: Record<string, string | undefined | null>): Map<string, string> {
    const parentEnvRegex = /\$penv\{(.+?)\}/g;
    let mat: RegExpExecArray | null;
    while ((mat = parentEnvRegex.exec(input)) !== null) {
        const full = mat[0];
        const varName = mat[1];
        const replacementValue = penvOverride ? penvOverride[varName] : process.env[varName];
        const replacement = (replacementValue === null || replacementValue === undefined) ? '' : replacementValue;
        subs.set(full, replacement);
    }
    return subs;
}

// --- Mirror of expand.errorHandlerHelper ---
interface ExpansionErrorHandler {
    errorList: [string, string][];
    tempErrorList: [string, string][];
}

function errorHandlerHelper(presetName: string, errorHandler?: ExpansionErrorHandler) {
    if (errorHandler) {
        for (const error of errorHandler.tempErrorList || []) {
            errorHandler.errorList.push([error[0], `'${error[1]}' in preset '${presetName}'`]);
        }
        errorHandler.tempErrorList = [];
    }
}

suite('[substituteAll]', () => {

    test('Simple variable substitution', () => {
        const subs = new Map<string, string>();
        subs.set('${workspaceFolder}', '/home/user/project');
        const result = substituteAll('build in ${workspaceFolder}/out', subs);
        expect(result.result).to.equal('build in /home/user/project/out');
        expect(result.didReplacement).to.be.true;
    });

    test('Multiple substitutions in one string', () => {
        const subs = new Map<string, string>();
        subs.set('${sourceDir}', '/src');
        subs.set('${buildType}', 'Release');
        const result = substituteAll('${sourceDir}/build/${buildType}', subs);
        expect(result.result).to.equal('/src/build/Release');
        expect(result.didReplacement).to.be.true;
    });

    test('No substitution when map is empty', () => {
        const subs = new Map<string, string>();
        const result = substituteAll('no vars here', subs);
        expect(result.result).to.equal('no vars here');
        expect(result.didReplacement).to.be.false;
    });

    test('No substitution when value equals key (self-reference guard)', () => {
        const subs = new Map<string, string>();
        subs.set('${x}', '${x}');
        const result = substituteAll('value is ${x}', subs);
        expect(result.result).to.equal('value is ${x}');
        expect(result.didReplacement).to.be.false;
    });

    test('Substitution with empty replacement', () => {
        const subs = new Map<string, string>();
        subs.set('${optional}', '');
        const result = substituteAll('prefix${optional}suffix', subs);
        expect(result.result).to.equal('prefixsuffix');
        expect(result.didReplacement).to.be.true;
    });

    test('Repeated variable in same string', () => {
        const subs = new Map<string, string>();
        subs.set('${name}', 'cmake');
        const result = substituteAll('${name} uses ${name}', subs);
        expect(result.result).to.equal('cmake uses cmake');
        expect(result.didReplacement).to.be.true;
    });

    test('Special regex characters in key are escaped properly', () => {
        const subs = new Map<string, string>();
        subs.set('${env:PATH}', '/usr/bin');
        const result = substituteAll('path is ${env:PATH}', subs);
        expect(result.result).to.equal('path is /usr/bin');
        expect(result.didReplacement).to.be.true;
    });

    test('Input with no matching variables is unchanged', () => {
        const subs = new Map<string, string>();
        subs.set('${a}', 'A');
        const result = substituteAll('no match for ${b}', subs);
        expect(result.result).to.equal('no match for ${b}');
        expect(result.didReplacement).to.be.true; // didReplacement is true because value !== key, even if no match
    });

    test('Empty input string', () => {
        const subs = new Map<string, string>();
        subs.set('${x}', 'y');
        const result = substituteAll('', subs);
        expect(result.result).to.equal('');
        expect(result.didReplacement).to.be.true;
    });

    test('Dollar sign in replacement value', () => {
        const subs = new Map<string, string>();
        subs.set('${price}', '$100');
        const result = substituteAll('cost: ${price}', subs);
        expect(result.result).to.equal('cost: $100');
        expect(result.didReplacement).to.be.true;
    });
});

suite('[getParentEnvSubstitutions]', () => {

    test('Extracts $penv{VAR} from input with override', () => {
        const subs = new Map<string, string>();
        const penvOverride: Record<string, string | undefined> = { HOME: '/home/testuser' };
        getParentEnvSubstitutions('$penv{HOME}/project', subs, penvOverride);
        expect(subs.get('$penv{HOME}')).to.equal('/home/testuser');
    });

    test('Multiple $penv references', () => {
        const subs = new Map<string, string>();
        const penvOverride: Record<string, string | undefined> = {
            HOME: '/home/user',
            PATH: '/usr/bin:/usr/local/bin'
        };
        getParentEnvSubstitutions('$penv{HOME}/bin:$penv{PATH}', subs, penvOverride);
        expect(subs.get('$penv{HOME}')).to.equal('/home/user');
        expect(subs.get('$penv{PATH}')).to.equal('/usr/bin:/usr/local/bin');
    });

    test('Missing env var in override produces empty string', () => {
        const subs = new Map<string, string>();
        const penvOverride: Record<string, string | undefined> = {};
        getParentEnvSubstitutions('$penv{NONEXISTENT}', subs, penvOverride);
        expect(subs.get('$penv{NONEXISTENT}')).to.equal('');
    });

    test('Null env var value produces empty string', () => {
        const subs = new Map<string, string>();
        const penvOverride: Record<string, string | undefined | null> = { NULLVAR: null };
        getParentEnvSubstitutions('$penv{NULLVAR}', subs, penvOverride);
        expect(subs.get('$penv{NULLVAR}')).to.equal('');
    });

    test('No $penv references leaves subs unchanged', () => {
        const subs = new Map<string, string>();
        subs.set('existing', 'value');
        const penvOverride: Record<string, string | undefined> = { HOME: '/home/user' };
        getParentEnvSubstitutions('no penv here', subs, penvOverride);
        expect(subs.size).to.equal(1);
        expect(subs.get('existing')).to.equal('value');
    });

    test('Falls back to process.env when no override', () => {
        const subs = new Map<string, string>();
        // PATH should always be defined on any OS
        getParentEnvSubstitutions('$penv{PATH}', subs, undefined);
        const pathValue = subs.get('$penv{PATH}');
        // Should match process.env.PATH (or empty if somehow undefined)
        expect(pathValue).to.equal(process.env.PATH || '');
    });

    test('Preserves existing entries in subs map', () => {
        const subs = new Map<string, string>();
        subs.set('${workspaceFolder}', '/project');
        const penvOverride: Record<string, string | undefined> = { HOME: '/home/user' };
        getParentEnvSubstitutions('$penv{HOME}', subs, penvOverride);
        expect(subs.get('${workspaceFolder}')).to.equal('/project');
        expect(subs.get('$penv{HOME}')).to.equal('/home/user');
        expect(subs.size).to.equal(2);
    });
});

suite('[errorHandlerHelper]', () => {

    test('Transfers temp errors to error list with preset context', () => {
        const handler: ExpansionErrorHandler = {
            errorList: [],
            tempErrorList: [['Invalid variable reference', '${badVar} in config']]
        };
        errorHandlerHelper('myPreset', handler);
        expect(handler.errorList).to.have.lengthOf(1);
        expect(handler.errorList[0][0]).to.equal('Invalid variable reference');
        expect(handler.errorList[0][1]).to.equal("'${badVar} in config' in preset 'myPreset'");
        expect(handler.tempErrorList).to.have.lengthOf(0);
    });

    test('Multiple temp errors are all transferred', () => {
        const handler: ExpansionErrorHandler = {
            errorList: [],
            tempErrorList: [
                ['Error 1', 'value1'],
                ['Error 2', 'value2'],
                ['Error 3', 'value3']
            ]
        };
        errorHandlerHelper('preset-A', handler);
        expect(handler.errorList).to.have.lengthOf(3);
        expect(handler.errorList[0][1]).to.contain("in preset 'preset-A'");
        expect(handler.errorList[2][1]).to.contain("in preset 'preset-A'");
        expect(handler.tempErrorList).to.have.lengthOf(0);
    });

    test('Empty temp error list does nothing', () => {
        const handler: ExpansionErrorHandler = {
            errorList: [['existing', 'error']],
            tempErrorList: []
        };
        errorHandlerHelper('preset-B', handler);
        expect(handler.errorList).to.have.lengthOf(1);
        expect(handler.errorList[0]).to.deep.equal(['existing', 'error']);
    });

    test('Undefined handler does nothing (no crash)', () => {
        // Should not throw when errorHandler is undefined
        expect(() => errorHandlerHelper('preset-C', undefined)).to.not.throw();
    });

    test('Preserves existing errors in errorList', () => {
        const handler: ExpansionErrorHandler = {
            errorList: [['previous', 'error']],
            tempErrorList: [['new', 'temp error']]
        };
        errorHandlerHelper('preset-D', handler);
        expect(handler.errorList).to.have.lengthOf(2);
        expect(handler.errorList[0]).to.deep.equal(['previous', 'error']);
        expect(handler.errorList[1][0]).to.equal('new');
        expect(handler.errorList[1][1]).to.contain("in preset 'preset-D'");
    });

    test('Clears tempErrorList after transfer', () => {
        const handler: ExpansionErrorHandler = {
            errorList: [],
            tempErrorList: [['err', 'val']]
        };
        errorHandlerHelper('p1', handler);
        expect(handler.tempErrorList).to.have.lengthOf(0);

        // Calling again should not re-transfer
        errorHandlerHelper('p2', handler);
        expect(handler.errorList).to.have.lengthOf(1);
    });
});
