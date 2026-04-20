import { expect } from 'chai';
import {
    Parser,
    ContextKeyExpr,
    ContextKeyFalseExpr,
    ContextKeyTrueExpr,
    validateWhenClauses,
    expressionsAreEqualWithConstantSubstitution,
    setConstant,
    isFalsyOrWhitespace,
    implies,
    IContext
} from '@cmt/contextKeyExpr';

/**
 * Tests for the context key expression parser and evaluator from src/contextKeyExpr.ts.
 *
 * This module (2900+ lines) is recycled from VS Code and has zero tests in this
 * repository. It is a pure-logic module with only a vscode-nls dependency (no vscode
 * dependency), making it safe to import directly in backend tests.
 *
 * These tests cover:
 * - Parser: parsing when-clause strings into expression ASTs
 * - Expression evaluation against context maps
 * - Serialization roundtrips
 * - Error handling for malformed expressions
 * - Utility functions: validateWhenClauses, isFalsyOrWhitespace, implies
 */

/** Helper to create a simple IContext from a key-value map */
function createContext(values: Record<string, any>): IContext {
    return {
        getValue<T>(key: string): T | undefined {
            return values[key] as T | undefined;
        }
    };
}

suite('[contextKeyExpr Parser]', () => {
    let parser: InstanceType<typeof Parser>;

    setup(() => {
        parser = new Parser();
    });

    test('Parse simple key (defined check)', () => {
        const expr = parser.parse('myKey');
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.equal('myKey');
    });

    test('Parse equality expression', () => {
        const expr = parser.parse('resourceScheme == file');
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.equal("resourceScheme == 'file'");
    });

    test('Parse inequality expression', () => {
        const expr = parser.parse('editorLangId != markdown');
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.equal("editorLangId != 'markdown'");
    });

    test('Parse negation', () => {
        const expr = parser.parse('!inDebugMode');
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.equal('!inDebugMode');
    });

    test('Parse AND expression', () => {
        const expr = parser.parse('editorFocus && textInputFocus');
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.equal('editorFocus && textInputFocus');
    });

    test('Parse OR expression', () => {
        const expr = parser.parse('isLinux || isMac');
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.equal('isLinux || isMac');
    });

    test('Parse combined AND/OR with correct precedence (AND binds tighter)', () => {
        const expr = parser.parse('a && b || c && d');
        expect(expr).to.not.be.undefined;
        // AND binds tighter than OR => (a && b) || (c && d)
        expect(expr!.serialize()).to.equal('a && b || c && d');
    });

    test('Parse parenthesized expression', () => {
        const expr = parser.parse('(a || b) && c');
        expect(expr).to.not.be.undefined;
        // Parenthesized OR with AND
        const serialized = expr!.serialize();
        expect(serialized).to.contain('&&');
        expect(serialized).to.contain('||');
    });

    test('Parse true literal', () => {
        const expr = parser.parse('true');
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.equal('true');
    });

    test('Parse false literal', () => {
        const expr = parser.parse('false');
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.equal('false');
    });

    test('Parse !true yields false', () => {
        const expr = parser.parse('!true');
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.equal('false');
    });

    test('Parse !false yields true', () => {
        const expr = parser.parse('!false');
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.equal('true');
    });

    test('Parse regex expression', () => {
        const expr = parser.parse('resourceFileName =~ /docker/');
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.contain('=~');
    });

    test('Parse greater than expression', () => {
        const expr = parser.parse('listItemCount > 0');
        expect(expr).to.not.be.undefined;
        // Serialized form uses > operator
        expect(expr!.serialize()).to.contain('>');
    });

    test('Parse less than expression', () => {
        const expr = parser.parse('listItemCount < 10');
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.contain('<');
    });

    test('Parse greater-or-equal expression', () => {
        const expr = parser.parse('count >= 5');
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.contain('>=');
    });

    test('Parse less-or-equal expression', () => {
        const expr = parser.parse('count <= 5');
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.contain('<=');
    });

    test('Parse in expression', () => {
        const expr = parser.parse('item in collection');
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.equal("item in 'collection'");
    });

    test('Parse not-in expression', () => {
        const expr = parser.parse('item not in collection');
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.contain('not in');
    });

    test('Parse quoted string value', () => {
        const expr = parser.parse("resourceScheme == 'untitled'");
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.equal("resourceScheme == 'untitled'");
    });

    test('Empty string produces parsing error', () => {
        const expr = parser.parse('');
        expect(expr).to.be.undefined;
        expect(parser.parsingErrors.length).to.be.greaterThan(0);
    });

    test('No lexing or parsing errors for valid expression', () => {
        parser.parse('foo == bar && baz');
        expect(parser.lexingErrors.length).to.equal(0);
        expect(parser.parsingErrors.length).to.equal(0);
    });
});

suite('[contextKeyExpr Evaluation]', () => {

    test('Defined key evaluates to true when key is present', () => {
        const expr = ContextKeyExpr.has('myKey');
        const ctx = createContext({ myKey: true });
        expect(expr.evaluate(ctx)).to.be.true;
    });

    test('Defined key evaluates to false when key is absent', () => {
        const expr = ContextKeyExpr.has('myKey');
        const ctx = createContext({});
        expect(expr.evaluate(ctx)).to.be.false;
    });

    test('Equality evaluates correctly', () => {
        const expr = ContextKeyExpr.equals('lang', 'cpp');
        expect(expr.evaluate(createContext({ lang: 'cpp' }))).to.be.true;
        expect(expr.evaluate(createContext({ lang: 'python' }))).to.be.false;
    });

    test('Not-equals evaluates correctly', () => {
        const expr = ContextKeyExpr.notEquals('lang', 'cpp');
        expect(expr.evaluate(createContext({ lang: 'python' }))).to.be.true;
        expect(expr.evaluate(createContext({ lang: 'cpp' }))).to.be.false;
    });

    test('AND expression: both must be true', () => {
        const expr = ContextKeyExpr.and(
            ContextKeyExpr.has('a'),
            ContextKeyExpr.has('b')
        );
        expect(expr).to.not.be.undefined;
        expect(expr!.evaluate(createContext({ a: true, b: true }))).to.be.true;
        expect(expr!.evaluate(createContext({ a: true }))).to.be.false;
    });

    test('OR expression: at least one must be true', () => {
        const expr = ContextKeyExpr.or(
            ContextKeyExpr.has('a'),
            ContextKeyExpr.has('b')
        );
        expect(expr).to.not.be.undefined;
        expect(expr!.evaluate(createContext({ a: true }))).to.be.true;
        expect(expr!.evaluate(createContext({ b: true }))).to.be.true;
        expect(expr!.evaluate(createContext({}))).to.be.false;
    });

    test('NOT expression inverts defined check', () => {
        const expr = ContextKeyExpr.not('myKey');
        expect(expr.evaluate(createContext({}))).to.be.true;
        expect(expr.evaluate(createContext({ myKey: true }))).to.be.false;
    });

    test('Greater-than comparison', () => {
        const expr = ContextKeyExpr.greater('count', 5);
        expect(expr.evaluate(createContext({ count: 10 }))).to.be.true;
        expect(expr.evaluate(createContext({ count: 5 }))).to.be.false;
        expect(expr.evaluate(createContext({ count: 3 }))).to.be.false;
    });

    test('Greater-or-equal comparison', () => {
        const expr = ContextKeyExpr.greaterEquals('count', 5);
        expect(expr.evaluate(createContext({ count: 5 }))).to.be.true;
        expect(expr.evaluate(createContext({ count: 4 }))).to.be.false;
    });

    test('Smaller-than comparison', () => {
        const expr = ContextKeyExpr.smaller('count', 5);
        expect(expr.evaluate(createContext({ count: 3 }))).to.be.true;
        expect(expr.evaluate(createContext({ count: 5 }))).to.be.false;
    });

    test('Smaller-or-equal comparison', () => {
        const expr = ContextKeyExpr.smallerEquals('count', 5);
        expect(expr.evaluate(createContext({ count: 5 }))).to.be.true;
        expect(expr.evaluate(createContext({ count: 6 }))).to.be.false;
    });

    test('Regex expression matches', () => {
        const expr = ContextKeyExpr.regex('fileName', /docker/i);
        expect(expr.evaluate(createContext({ fileName: 'Dockerfile' }))).to.be.true;
        expect(expr.evaluate(createContext({ fileName: 'README.md' }))).to.be.false;
    });

    test('In expression checks set membership', () => {
        const expr = ContextKeyExpr.in('item', 'myList');
        const ctx = createContext({ item: 'apple', myList: ['apple', 'banana'] });
        expect(expr.evaluate(ctx)).to.be.true;

        const ctx2 = createContext({ item: 'cherry', myList: ['apple', 'banana'] });
        expect(expr.evaluate(ctx2)).to.be.false;
    });

    test('True expression always evaluates to true', () => {
        expect(ContextKeyExpr.true().evaluate(createContext({}))).to.be.true;
    });

    test('False expression always evaluates to false', () => {
        expect(ContextKeyExpr.false().evaluate(createContext({}))).to.be.false;
    });

    test('Complex cmake-tools when-clause evaluates correctly', () => {
        // Simulates: cmake:enableFullFeatureSet && !cmake:isBuilding
        const parser = new Parser();
        const expr = parser.parse('cmake:enableFullFeatureSet && !cmake:isBuilding');
        expect(expr).to.not.be.undefined;

        const ctx1 = createContext({
            'cmake:enableFullFeatureSet': true,
            'cmake:isBuilding': false
        });
        expect(expr!.evaluate(ctx1)).to.be.true;

        const ctx2 = createContext({
            'cmake:enableFullFeatureSet': true,
            'cmake:isBuilding': true
        });
        expect(expr!.evaluate(ctx2)).to.be.false;
    });
});

suite('[contextKeyExpr Serialization]', () => {

    test('Roundtrip: parse then serialize simple expression', () => {
        const parser = new Parser();
        const expr = parser.parse('myKey');
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.equal('myKey');
    });

    test('Roundtrip: parse then serialize equality', () => {
        const parser = new Parser();
        const expr = parser.parse("lang == 'cpp'");
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.equal("lang == 'cpp'");
    });

    test('Roundtrip: parse then serialize AND', () => {
        const parser = new Parser();
        const expr = parser.parse('a && b');
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.equal('a && b');
    });

    test('Roundtrip: parse then serialize OR', () => {
        const parser = new Parser();
        const expr = parser.parse('a || b');
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.equal('a || b');
    });

    test('Negate produces inverse', () => {
        const parser = new Parser();
        const expr = parser.parse('foo');
        expect(expr).to.not.be.undefined;
        const neg = expr!.negate();
        expect(neg.serialize()).to.equal('!foo');
    });

    test('Double negate returns to original', () => {
        const parser = new Parser();
        const expr = parser.parse('foo');
        expect(expr).to.not.be.undefined;
        const neg = expr!.negate().negate();
        expect(neg.serialize()).to.equal('foo');
    });

    test('keys() returns referenced keys', () => {
        const parser = new Parser();
        const expr = parser.parse('foo && bar == baz');
        expect(expr).to.not.be.undefined;
        const keys = expr!.keys();
        expect(keys).to.include('foo');
        expect(keys).to.include('bar');
    });

    test('Deserialize via ContextKeyExpr.deserialize', () => {
        const expr = ContextKeyExpr.deserialize('a && b');
        expect(expr).to.not.be.undefined;
        expect(expr!.serialize()).to.equal('a && b');
    });

    test('Deserialize null returns undefined', () => {
        expect(ContextKeyExpr.deserialize(null)).to.be.undefined;
    });

    test('Deserialize undefined returns undefined', () => {
        expect(ContextKeyExpr.deserialize(undefined)).to.be.undefined;
    });
});

suite('[contextKeyExpr Utility Functions]', () => {

    test('isFalsyOrWhitespace: empty string', () => {
        expect(isFalsyOrWhitespace('')).to.be.true;
    });

    test('isFalsyOrWhitespace: whitespace only', () => {
        expect(isFalsyOrWhitespace('   ')).to.be.true;
    });

    test('isFalsyOrWhitespace: undefined', () => {
        expect(isFalsyOrWhitespace(undefined)).to.be.true;
    });

    test('isFalsyOrWhitespace: non-empty string', () => {
        expect(isFalsyOrWhitespace('hello')).to.be.false;
    });

    test('isFalsyOrWhitespace: string with spaces around content', () => {
        expect(isFalsyOrWhitespace(' hello ')).to.be.false;
    });

    test('validateWhenClauses: valid clause returns empty errors', () => {
        const result = validateWhenClauses(['foo == bar']);
        expect(result[0]).to.have.lengthOf(0);
    });

    test('validateWhenClauses: empty string clause returns error', () => {
        const result = validateWhenClauses(['']);
        expect(result[0]).to.have.length.greaterThan(0);
    });

    test('validateWhenClauses: multiple clauses validated independently', () => {
        const result = validateWhenClauses(['foo', '', 'bar == baz']);
        expect(result[0]).to.have.lengthOf(0); // valid
        expect(result[1]).to.have.length.greaterThan(0); // empty = error
        expect(result[2]).to.have.lengthOf(0); // valid
    });

    test('expressionsAreEqualWithConstantSubstitution: same expressions', () => {
        const a = ContextKeyExpr.has('foo');
        const b = ContextKeyExpr.has('foo');
        expect(expressionsAreEqualWithConstantSubstitution(a, b)).to.be.true;
    });

    test('expressionsAreEqualWithConstantSubstitution: different expressions', () => {
        const a = ContextKeyExpr.has('foo');
        const b = ContextKeyExpr.has('bar');
        expect(expressionsAreEqualWithConstantSubstitution(a, b)).to.be.false;
    });

    test('expressionsAreEqualWithConstantSubstitution: both null/undefined', () => {
        expect(expressionsAreEqualWithConstantSubstitution(null, undefined)).to.be.true;
    });

    test('expressionsAreEqualWithConstantSubstitution: one null', () => {
        const a = ContextKeyExpr.has('foo');
        expect(expressionsAreEqualWithConstantSubstitution(a, null)).to.be.false;
    });

    test('implies: false implies anything', () => {
        const p = ContextKeyExpr.false();
        const q = ContextKeyExpr.has('anything');
        expect(implies(p, q)).to.be.true;
    });

    test('implies: anything implies true', () => {
        const p = ContextKeyExpr.has('something');
        const q = ContextKeyExpr.true();
        expect(implies(p, q)).to.be.true;
    });

    test('implies: unrelated expressions do not imply', () => {
        const p = ContextKeyExpr.has('a');
        const q = ContextKeyExpr.has('b');
        expect(implies(p, q)).to.be.false;
    });

    test('setConstant and constant substitution', () => {
        setConstant('testConst', true);
        const parser = new Parser();
        const expr = parser.parse('testConst');
        expect(expr).to.not.be.undefined;
        const substituted = expr!.substituteConstants();
        // After setting testConst to true, substitution should yield true
        expect(substituted).to.not.be.undefined;
        expect(substituted!.serialize()).to.equal('true');
    });
});

suite('[contextKeyExpr Expression Equality]', () => {

    test('Same defined expressions are equal', () => {
        const a = ContextKeyExpr.has('foo');
        const b = ContextKeyExpr.has('foo');
        expect(a.equals(b)).to.be.true;
    });

    test('Different defined expressions are not equal', () => {
        const a = ContextKeyExpr.has('foo');
        const b = ContextKeyExpr.has('bar');
        expect(a.equals(b)).to.be.false;
    });

    test('Equals with same key/value are equal', () => {
        const a = ContextKeyExpr.equals('key', 'value');
        const b = ContextKeyExpr.equals('key', 'value');
        expect(a.equals(b)).to.be.true;
    });

    test('Equals with different values are not equal', () => {
        const a = ContextKeyExpr.equals('key', 'val1');
        const b = ContextKeyExpr.equals('key', 'val2');
        expect(a.equals(b)).to.be.false;
    });

    test('True and False singletons', () => {
        expect(ContextKeyTrueExpr.INSTANCE.equals(ContextKeyTrueExpr.INSTANCE)).to.be.true;
        expect(ContextKeyFalseExpr.INSTANCE.equals(ContextKeyFalseExpr.INSTANCE)).to.be.true;
        expect(ContextKeyTrueExpr.INSTANCE.equals(ContextKeyFalseExpr.INSTANCE)).to.be.false;
    });
});
