import { Condition, evaluateCondition } from '../../src/preset';
import { expect } from '@test/util';

suite('Preset tests', () => {
    test('Evaluate condition objects', () => {
        let condition: Condition = { type: 'const', value: true };
        expect(evaluateCondition(condition)).to.eql(true);
        condition = { type: 'const', value: false };
        expect(evaluateCondition(condition)).to.eql(false);

        condition = { type: 'notEquals', lhs: 'blah', rhs: 'blah' };
        expect(evaluateCondition(condition)).to.eql(false);
        condition = { type: 'notEquals', lhs: 'blah', rhs: 'halb' };
        expect(evaluateCondition(condition)).to.eql(true);

        condition = { type: 'inList', string: 'apple', list: ['orange', 'banana', 'apple'] };
        expect(evaluateCondition(condition)).to.eql(true);
        condition = { type: 'inList', string: 'pear', list: ['orange', 'banana', 'apple'] };
        expect(evaluateCondition(condition)).to.eql(false);

        condition = { type: 'matches', string: 'vs123code', regex: String.raw`\w+\d{3}code` };
        expect(evaluateCondition(condition)).to.eql(true);
        condition = { type: 'matches', string: 'vs123code', regex: String.raw`\w+\d{4}code` };
        expect(evaluateCondition(condition)).to.eql(false);

        condition = {
            type: 'allOf', conditions: [
                { type: 'const', value: true },
                { type: 'equals', lhs: 'foo', rhs: 'foo' }
            ]
        };
        expect(evaluateCondition(condition)).to.eql(true);

        condition.type = 'anyOf';
        expect(evaluateCondition(condition)).to.eql(true);

        condition = {
            type: 'allOf', conditions: [
                { type: 'const', value: false },
                { type: 'equals', lhs: 'foo', rhs: 'foo' }
            ]
        };
        expect(evaluateCondition(condition)).to.eql(false);

        condition.type = 'anyOf';
        expect(evaluateCondition(condition)).to.eql(true);

        condition = {
            type: 'anyOf', conditions: [
                { type: 'const', value: false },
                { type: 'equals', lhs: 'foo', rhs: 'oof' }
            ]
        };
        expect(evaluateCondition(condition)).to.eql(false);

        const notCondition: Condition = { type: 'not', condition: condition };
        expect(evaluateCondition(notCondition)).to.eql(true);

        // Force TypeScript to ignore invalid type field.
        // In practice, it's possible the preset condition can be an invalid Condition object
        // since there are no type checks when parsing the raw json (see presetsController.parsePresetsFile)
        // @ts-ignore
        let badCondition: Condition = { type: 'oops' }!;
        expect(() => evaluateCondition(badCondition)).to.throw();

        badCondition = { type: 'equals', lhs: 'lhs' };
        expect(() => evaluateCondition(badCondition)).to.throw();
    });
});
