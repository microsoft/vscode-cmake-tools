import { Condition, evaluateCondition, getArchitecture, getToolset } from '../../src/preset';
import { expect } from '@test/util';

suite('Preset tests', () => {
    test('Parse architecture', () => {
        expect(getArchitecture({ name: 'test', architecture: 'x86' })).to.eq('x86');
        expect(getArchitecture({ name: 'test', architecture: 'amd64' })).to.eq('amd64');
        expect(getArchitecture({ name: 'test', architecture: { value: 'arm', strategy: 'set' } })).to.eq('arm');
        expect(getArchitecture({ name: 'test', architecture: { value: 'arm64', strategy: 'external' } })).to.eq('arm64');
        expect(getArchitecture({ name: 'test' })).to.eq('x86');
        expect(getArchitecture({ name: 'test', architecture: 'bogus' })).to.eq('bogus');
    });

    test('Parse toolset', () => {
        let toolset = getToolset({ name: 'test', toolset: 'v141' });
        expect(toolset).to.not.contain.keys('name');
        expect(toolset.version).to.eq('14.16');

        toolset = getToolset({ name: 'test', toolset: 'v142' });
        expect(toolset).to.not.contain.keys('name');
        expect(toolset.version).to.eq('14.29');

        toolset = getToolset({ name: 'test', toolset: { value: 'v140', strategy: 'set' } });
        expect(toolset).to.not.contain.keys('name');
        expect(toolset.version).to.eq('14.0');

        toolset = getToolset({ name: 'test', toolset: { value: 'v143', strategy: 'external' } });
        expect(toolset.name).to.eq('v143');
        expect(toolset).to.not.contain.keys('version');

        toolset = getToolset({ name: 'test', toolset: 'host=x86' });
        expect(toolset.host).to.eq('x86');
        toolset = getToolset({ name: 'test', toolset: 'host=x64' });
        expect(toolset.host).to.eq('x64');
        toolset = getToolset({ name: 'test', toolset: 'host=x86,version=14.31' });
        expect(toolset.host).to.eq('x86');
        expect(toolset.version).to.eq('14.31');
        toolset = getToolset({ name: 'test', toolset: 'host=x64,version=14.0' });
        expect(toolset.host).to.eq('x64');
        expect(toolset.version).to.eq('14.0');
        toolset = getToolset({ name: 'test', toolset: 'host=x64,version=14.31.12345' });
        expect(toolset.host).to.eq('x64');
        expect(toolset.version).to.eq('14.31.12345');
        toolset = getToolset({ name: 'test', toolset: 'v143,host=arm,version=14.31.12345' });
        expect(toolset.host).to.eq('arm');
        expect(toolset.version).to.eq('14.31.12345');
        toolset = getToolset({ name: 'test', toolset: 'v141,host=arm64,version=14.31.12345' }); // bogus, but testing the override
        expect(toolset.host).to.eq('arm64');
        expect(toolset.version).to.eq('14.31.12345');
        toolset = getToolset({ name: 'test', toolset: 'v143,version=14.31.12345,host=x64,cuda=hey,vctargetspath=nope' });
        expect(toolset.host).to.eq('x64');
        expect(toolset.version).to.eq('14.31.12345');
        expect(toolset.cuda).to.eq('hey');
        expect(toolset.VCTargetsPath).to.eq('nope');
    });

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
