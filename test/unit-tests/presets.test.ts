import { Condition, evaluateCondition } from '../../src/preset';
import { expect } from '@test/util';

suite('Preset tests', () => {
  test('Evaluate condition objects', () => {
    let condition: Condition = { type: 'const', value: true };
    expect(evaluateCondition(condition)).to.eql(true);

    condition = { type: 'notEquals', lhs: 'blah', rhs: 'blah'};
    expect(evaluateCondition(condition)).to.eql(false);

    condition = { type: 'inList', string: 'apple', list: [ 'orange', 'banana', 'apple']};
    expect(evaluateCondition(condition)).to.eql(true);

    condition = { type: 'matches', string: 'vs123code', regex: String.raw`\w+\d{3}code`};
    expect(evaluateCondition(condition)).to.eql(true);

    condition = { type: 'allOf', conditions: [
      { type: 'const', value: true },
      { type: 'equals', lhs: 'foo', rhs: 'foo' }
    ]};
    expect(evaluateCondition(condition)).to.eql(true);

    condition.type = 'anyOf';
    expect(evaluateCondition(condition)).to.eql(true);

    condition = { type: 'allOf', conditions: [
      { type: 'const', value: false },
      { type: 'equals', lhs: 'foo', rhs: 'foo' }
    ]};
    expect(evaluateCondition(condition)).to.eql(false);

    condition.type = 'anyOf';
    expect(evaluateCondition(condition)).to.eql(true);
  });
});
